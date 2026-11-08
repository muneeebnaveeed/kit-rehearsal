# Platform rules (`server/`)

`server/` is the shared multiplayer platform that every team's game builds on: the server host, the netcode contract and the template game. The workflow commands, checks and QA scripts are in `tooling/`, also owned by the platform team. It is owned by the **platform team** (label `platform`). The repo-wide rules in [`../CLAUDE.md`](../CLAUDE.md) apply here too; this file adds the platform rules.

## What lives here

| Package | Path | What it is |
|---|---|---|
| `@kit/core` | `server/core/` | Contract types (`shared`), the sim contract (`sim`), the Simulation and replay runner (`server`), and the client core (`client`) |
| `@kit/host` | `server/host/` | `startGameServer()` and `createGameRoom()`: the Colyseus + Express host, routes, logs and stats. Room test helpers in `@kit/host/testing` |
| `@kit/template` | `server/template/` | Reference game. Teams copy it to `games/team-N/` to start |
| `@kit/tooling` | `tooling/` (outside `server/`) | Shared TypeScript config (`tsconfig.base.json`), the workflow commands in `tooling/workflow/` and the QA scripts in `tooling/qa/` |

Docs for the platform live in `server/ARCHITECTURE.md` and `server/docs/`.

## Rules for teams

- Your game lives in `games/team-N/` and is its own package (`@team-N/game`). Import the platform only through package names: `@kit/core/shared`, `@kit/core/sim`, `@kit/core/server`, `@kit/core/client`, `@kit/host`, `@kit/host/testing`.
- Never import from another team's folder, and never import platform files by relative path (`../../server/...`).
- Need a platform change? Open an issue with the `platform` label that says what your team needs and why. Don't patch `server/` from a team PR.

## Rules for platform changes

- A platform change can break every game, so keep platform PRs small and focused.
- Changes to `server/core/src/shared/` (the contract) are breaking by default. Say in the PR which games are affected and how they migrate.
- `pnpm typecheck` and `pnpm test` run for every workspace package, so a platform PR is only green when every team's game still builds.
- Don't add a dependency to a platform package unless every game benefits. Game-specific dependencies belong in `games/team-N/package.json`.

## Writing a game (the game definition)

Building a client or a game? Read [`docs/CLIENT_GUIDE.md`](docs/CLIENT_GUIDE.md) first: connecting, join by code, reconnect, messages, routes, debugging.

- Put the rules in `games/team-N/shared/game.ts` as a `GameDefinition` from `@kit/core/sim`. See `server/template/shared/game.ts`.
- The definition and everything in `shared/` must stay browser-safe: import only `@colyseus/schema`, `zod`, `@kit/core/shared` and `@kit/core/sim`. Never `colyseus`, `@kit/host`, `@kit/core/server` or `node:*`. The client imports it to predict.
- Your state extends `BaseState` (`BaseState.extend({...}, "MyState")`). Don't write `tick`, `code`, `paused` or `seats` yourself; the room base owns them. Read `seats` if you need to know who is connected.
- Your config schema extends `RoomSettingsSchema`, and `config/game.json` sets `tickRate`, `patchRate`, `maxPlayers` and `reconnectSeconds` for your game.
- Register rooms in `room/index.ts` as factories: `{ game: (deps) => createGameRoom(myGame, deps) }`.
- Add game debug commands in `commands` (e.g. `spawn`, `tp`). Built-ins (`pause`, `step`, `timescale`, `seed`, `set`, `kick`) can't be overridden. All of them are recorded in replays and rejected in production, unless the platform team turned on `DEBUG_TOOLS` for that game for the event's testing (see "Debug tools on Railway" in [ARCHITECTURE.md](ARCHITECTURE.md#debug-tools-on-railway)). Client debug tools follow `debug` from `/health`, never the client's own env.
- Room tests import `boot` from `@kit/host/testing`, never from `@colyseus/testing` directly, and call `boot(config)` without a port: it picks a free one, so test runs on the same machine never collide.

## Determinism rules (all game code)

Replays only work if the simulation is deterministic:

- Use the room's `SeededRandom` (`@kit/core/shared`). Never `Math.random()` in simulation code.
- Advance the simulation only in fixed ticks. Never read wall-clock time (`Date.now()`, `performance.now()`) inside the simulation.
- Validate every client message with a zod schema before using it.
- Keep tuning values in `config/*.json`, validated by the game's config schema, so designers change numbers without touching code.

## Setting up a machine

The same steps work on macOS, Windows and Linux. You need only Node, pnpm and (recommended) VS Code. No Docker, no version manager required.

1. Install **Node 22.21.1** or a later 22.x (the exact pin is in `.nvmrc`). nvm and fnm users: `nvm install` or `fnm use --install-if-missing`. Otherwise download it from nodejs.org.
2. Install **pnpm 10.28.0** (pinned by `packageManager` in `package.json`): `corepack enable`, or `npm install -g pnpm@10.28.0`. pnpm 10 switches to the pinned version by itself.
3. Clone the repo and run `pnpm install`. It stops with a clear message if your Node version is wrong.
4. Run `pnpm check:setup`. It checks Node and pnpm versions, that dependencies match the lockfile, LF line endings, file names that differ only by case, and that ports 2567 and 5173 are free. Each failure says how to fix it.
5. Open the repo in VS Code and install the recommended extensions when asked (Biome, EditorConfig). Files are formatted with Biome on save.

Why these rules exist:

- `.gitattributes` keeps LF line endings in every checkout, including on Windows.
- File names that differ only by case (`Player.ts` / `player.ts`) work on macOS and Windows but break on Linux, which is what CI and Railway run.
- Scripts are written in TypeScript or plain Node.js, never bash, so they run on every OS.
- `.vscode/settings.json` and `.vscode/extensions.json` are shared. Keep personal VS Code settings in your user settings; the rest of `.vscode/` is ignored by git.

## Commands (repo root)

| Command | What it does |
|---|---|
| `pnpm install` | Install everything (checks your Node version first) and switch on the git hooks (see "Git hooks" below) |
| `pnpm check:setup` | Check this machine's setup and explain how to fix problems (`--json` for scripts) |
| `pnpm dev` | Run the template game: server on :2567, client on :5173 |
| `pnpm --filter @team-N/game dev` | Run your team's game |
| `pnpm lint` / `pnpm format` | Biome check / fix (Markdown is excluded) |
| `pnpm typecheck` | TypeScript across every package, `.railway`, `tooling/` and `course/tooling` |
| `pnpm test` | Vitest across every package |
| `pnpm build` | Build every game's client |
| `pnpm workflow:classify --kind issue\|pr\|commit` | Decide the type, team label, template and base branch for a change (`--json` for scripts; see "Templates, classification and checks" in `CLAUDE.md`) |
| `pnpm check:instructor --kind pr\|issue --number <n>` | Check that the `team-instructor` identity is only used by the accounts in `.github/instructors.json` |
| `pnpm check:issue` / `pnpm check:pr` / `pnpm check:commit` | Check an issue, a pull request or commit messages against their template or format |
| `pnpm preflight` | Everything a branch must pass before it becomes a PR (see "Preflight" below) |
| `pnpm preflight:quick` | Lint, typecheck and ownership in a few seconds. Agents run it after every change |
| `pnpm team:set <team>` | Save which team you are on, for `issue:start` and `pr:open` (see "Workflow commands" below) |
| `pnpm issue:start <n>` | Start work on issue `n`: check it is your team's, update your base branch, create the work branch, assign you |
| `pnpm pr:open` | Run `pnpm preflight`, then open the PR for the current work branch into your team's branch |
| `pnpm pr:ci-logs` | Download the logs of the checks failing on your PR and print the failing steps (see "Workflow commands" below) |
| `pnpm pr:comments` | Collect a PR's open review threads, reviews and discussion in one report |
| `pnpm pr:rubric --number <n>` | Score a PR on tests, How to test, screenshots, Summary, size (under 400 changed lines) and Root cause, with a tip for each miss (`--json`, `--comment`). Advice, not a gate: the "PR rubric" workflow posts it as one comment on every PR |
| `pnpm check:review` | Check a PR has an approving review from someone other than its author |
| `pnpm sync` | Merge your branch's base into it and report conflicts (see "Branch and environment commands" below) |
| `pnpm team:promote <N>` / `pnpm branches:sync` | Open the PR `feature/team-N` → `main` (a deploy), or `main` → each `feature/team-N` that is behind |
| `pnpm env:status` / `pnpm env:wait <sha>` | Compare the commit production runs with `main`, or wait until it runs a commit |
| `pnpm labels:sync` | Make the repo's GitHub labels match `tooling/workflow/labels.json` (dry run; `--apply` to change) |
| `pnpm labels:prs` | Update every PR's `stackpile` and `waiting-on.*` labels (`--dry-run`, `--number <n>`). The "PR labels" workflow runs it every 10 minutes |
| `pnpm qa:evidence [--json]` | Print changed test files, the latest QA results, and the scenarios and replay ids found in QA artifacts |

`qa:evidence` compares against `upstream/main` or `origin/main`, so keep your fork's main synced.

To record the latest Vitest counts for `qa:evidence`, run
`pnpm test --reporter=json --outputFile=.qa/last-test.json`.

Run `pnpm preflight` before opening a PR. It must pass.

## Preflight

`pnpm preflight` runs, in order: `check:setup`, lint, typecheck, test, build, then the checks below, and prints how to fix every failure. Every check also runs on its own, takes `--json`, and exits with 0 (OK), 1 (problems found), 2 (usage error) or 3 (environment problem, e.g. `gh` not logged in). The branch-level checks compare the current branch with the base the branch model expects; pass `--base <branch>` to override and `--offline` to skip GitHub lookups.

| Check | Fails when |
|---|---|
| `check:branch` | the branch isn't `<team-label>/<issue>-<description>`; it targets the wrong base (team work → `feature/team-N`; platform and instructor work → `main`; `feature/team-N` → `main`; `main` → `feature/team-N`); or its issue is missing, closed or has a different label |
| `check:ownership` | a work branch changes files another label owns (`tooling/ownership.json`). With a line `Cross-team: <why>` in the issue they are warnings instead |
| `check:commit` | a commit on the branch doesn't follow the commit format (see `CLAUDE.md`) |
| `check:files` | dependencies, build output, `.env` files or files over 1 MB are committed |
| `check:secrets` | an added line looks like a token, private key or hard-coded password |
| `check:docs` | a relative link or heading anchor in any Markdown file is broken |
| `check:config` | a game's `config/game.json` doesn't match the `*ConfigSchema` its `shared/index.ts` exports |
| `check:determinism` | simulation code (`room/`, `shared/`, the server core) calls `Math.random()`, `Date.now()`, `performance.now()` or `new Date()`. A line can opt out with `// determinism-ok: <reason>` |
| `check:contract` | never fails; warns when `server/core/src/shared/` changes, because every game depends on it |

The checks live in `tooling/workflow/` with the rest of the workflow toolkit: pure rules in `lib/`, a thin command per check, no runtime dependencies (`check:config` needs `pnpm install`, because it loads each game's schema).

## Workflow commands

These commands do the workflow in `CLAUDE.md` for you, so following it is the easiest path. They live in `tooling/workflow/` with the checks (pure rules in `lib/`, a thin command per script, no runtime dependencies), take `--json`, and use the same exit codes: 0 (OK), 1 (refused or problems found), 2 (usage error), 3 (environment problem, e.g. `gh` not logged in). Every command that changes something on GitHub takes `--dry-run`, which checks everything and prints what it would do.

### Your team

`issue:start` and `pr:open` need to know which team you are on. The first time you run one of them it asks (`team-1` to `team-4`, `platform` or `team-instructor`) and saves the answer in local git config, `kit.team`, which is per clone and never committed. Without a terminal (agents, CI) it never guesses: it stops with exit code 2 and asks for `--team`.

| Command | What it does |
|---|---|
| `pnpm team:set <team>` | Save or change your team. Without a team it asks (in a terminal only). `--show` prints the saved team (exit 1 when none is saved) |
| `--team <team>` on `issue:start` / `pr:open` | Use this team for one run. The saved team is not changed |

### `pnpm issue:start <n>`

Checks issue `n` is open and has exactly one team label, and that the label is your team. Then it fetches your team's base branch (`feature/team-N`; `main` for platform and instructors), fast-forwards your local copy of it when it can, creates `<label>/<n>-<slug>` from `origin/<base>`, and assigns you.

- It refuses another team's issue (`--team <label>` overrides for one run), a closed issue, a branch that already exists locally or on GitHub, and uncommitted changes.
- The slug comes from the issue title (lowercase words joined by `-`, at most 40 characters); `--slug <text>` sets it.
- `--dry-run` checks the issue and prints the plan without changing anything locally or on GitHub.

### `pnpm pr:open`

Opens the PR for the current work branch, in this order, and stops at the first refusal:

1. The branch is a work branch of your team, its issue is open and has your team's label, and it has no open PR yet. Another team's branch or issue label is refused; `--team <label>` overrides for one run.
2. `pnpm preflight` passes against your team's branch. If it fails, no PR is opened.
3. The change is classified like `pnpm workflow:classify --kind pr`: the type and the template. The PR gets your team label, the only label you set (see "Labels" in `CLAUDE.md`). If the classifier can't decide, pass `--type` after asking.
4. It drafts the title and the body. The title is Conventional Commits with your team as the scope, from the issue title, or from the oldest commit of that type when the issue title doesn't fit. The body follows the template's `**Label**: value` fields: `Closes #N`, the team, `pnpm preflight` under "How to test", `None` under "Screenshots" when no client files changed, and the changed Markdown files under "Pages affected". Fields it can't know come from options named after the label: `--summary` (always: why the change exists, in 2 or 3 sentences, never a list of what changed), `--root-cause`, `--impact`, `--behaviour-unchanged`, `--screenshots`, `--how-to-test`, `--pages-affected`. `--title` sets the title.
5. It ticks a checklist item only when it verified it: the issue, label, title, branch name and base from step 1, the folder, commit and file checks from preflight, and "up to date" from `git merge-base`. A cross-team change (an ownership warning) stays unticked, because only a person can say the issue explains why. "I tested the change" is ticked when "How to test" is the preflight that just passed; with your own `--how-to-test`, pass `--tested` once you have run those steps.
6. The `check:pr` rules run on the draft. Any problem, an empty field or an unticked item, means no PR is opened. The draft is saved in the git directory (`.git/kit/pr-body.md` in a normal clone; the command prints the path): finish it and run again with `--body-file`, or fix the cause.
7. It pushes the branch (`git push -u`, never forced) and runs `gh pr create`.

`--dry-run` runs steps 1 to 6 and prints the title, labels, body and the commands it would run.

### `pnpm pr:ci-logs`

Reads the checks of the current branch's PR (`--pr <n>` for another one). It judges each check by its latest run, so a check that failed and then passed is not reported. For every failing GitHub Actions job it downloads the log, without timestamps and colour codes, and prints each failed step: its command and its output up to the error. The logs and `summary.md` are saved in the git directory (`.git/kit/pr-<n>/ci/` in a normal clone). Exit code 1 means checks are failing. `--json` gives the same as data.

### `pnpm pr:comments`

Collects what reviewers said on the current branch's PR (`--pr <n>` for another one): the open review threads by file, the ones waiting on the author first, then the reviews and the discussion. Resolved threads are counted, not shown; `--all` shows them. Each thread ends with its link, to reply there. The report is saved as `.git/kit/pr-<n>/comments.md` in the git directory. Exit code 1 means threads are waiting on the author. `--json` gives the same as data.

### `pnpm check:review`

Passes when the PR has an approving review from someone other than its author. Each reviewer's latest decision counts: a later "changes requested" or a dismissal cancels an approval, and comments don't count. Open change requests from other reviewers are a warning. It reads the current branch's PR, or `--number <n>`.

## Branch and environment commands

These do the steps of [Branches](../CLAUDE.md#branches) and [Deploying to Railway](../CLAUDE.md#deploying-to-railway) for you. Like the checks, every one takes `--json` and exits with 0 (OK), 1 (problems found, or it refused), 2 (usage error) or 3 (environment problem: `git` or `gh` failed, or a URL is not set). Progress goes to stderr, so `--json` output on stdout stays parseable. The commands that open PRs fill the template, check the result with `check:pr`'s rules, and tick only the checklist items they verified themselves; tick the rest once you have checked them. **None of them merges anything**, and none rebases or force-pushes.

| Command | What it does | Refuses when |
|---|---|---|
| `pnpm sync` | Fetches the base of the current branch (team work: `feature/team-N`; platform and instructor work: `main`; `--base <branch>` to override) and merges `origin/<base>` into it. On a conflict it lists every conflicted file and leaves the merge for you to finish (`git add`, `git commit`) or undo (`git merge --abort`). It never resolves a conflict and never pushes. `--dry-run` predicts the conflicts without merging | you're on `main` or a `feature/team-N` (use `pnpm branches:sync`), there are uncommitted changes, or a merge is already in progress |
| `pnpm team:promote <N> --issue <n>` | Opens `feature/team-N` → `main` from the chore template, titled `chore(platform): merge feature/team-N into main`, labelled `platform` (like a sync, it merges every owner's files), with `Refs #n` and the PRs merged into the feature branch. `--auto-merge` turns on auto-merge. Warns when the feature branch is behind `main` or would conflict. `<N>` defaults to `--team`, then `git config kit.team` | the feature branch has nothing `main` lacks (merges of `main` alone don't count), a PR `feature/team-N` → `main` is already open, or issue `#n` is missing, closed or not labelled `platform` |
| `pnpm branches:sync [<N>...] --issue <n>` | Opens `main` → `feature/team-N` from the sync template for every feature branch that is behind `main` (or only teams `<N>...`), labelled `platform`, with `Refs #n`, the PRs it brings and whether it conflicts. Branches that are up to date or already have an open sync PR are skipped. `--auto-merge` turns on auto-merge for each PR that shows no conflicts; one that conflicts stays without it, because its head is `main` and the conflicts are resolved on a team branch | issue `#n` is missing or not labelled `platform` |
| `pnpm pipeline promote\|sync <team-N>` | One step of the hourly pipeline (`.github/workflows/pipeline.yml`): finds or opens the tracking issue (`Promotions from feature/team-N into main` or `Syncs from main into feature/team-N`, both labelled `platform`), runs `team:promote` or `branches:sync <N>` with it and `--auto-merge`, and writes what happened to the run's summary. A sync that conflicts is reported as opened without auto-merge, needing a person | (exit 1) the step failed for another reason than nothing new, a PR already open or a missing branch, which only skip the hour |
| `pnpm qa:smoke --sha <sha>` | With `--since <sha>`, passes at once when nothing a service deploys changed since that commit. Otherwise waits until production runs the commit, service by service (a service with nothing to redeploy may stay on an older one), then opens every game through the gateway: no page or console errors, and a room when the page has the template's lobby. `--env` (default `production`; `development` or `local` for a local stack), `--url` (default `$KIT_GATEWAY`), `--timeout <s>`, default 900 | (exit 1) a service never got there, reports the wrong `APP_ENV`, or a page failed |
| `pnpm env:status` | Reads production's `/health` and compares the `sha` it reports with `origin/main`. `--offline` skips the `git fetch` | (exit 1) production is unreachable, not `ok`, reports the wrong `APP_ENV` or runs another commit |
| `pnpm env:wait <sha>` | Polls production's `/health` until it reports the commit, e.g. after a merge (`--timeout <s>`, default 600, `--interval <s>`, default 10). Failed requests are retried, because a deploy restarts the service | (exit 1) the commit didn't arrive before the timeout, or the URL reports another `APP_ENV` |

`--dry-run` on `team:promote` and `branches:sync` does every check and prints the PRs it would open, without opening them. The issue (`--issue`) is required because every PR links one: the team's tracking issue for a promotion, or one platform issue that several syncs refer to.

The gateway's address isn't in the repository. Set `KIT_GATEWAY` (e.g. `https://<gateway>.up.railway.app`), or pass `--url`. Without it `env:status`, `env:wait` and `qa:smoke` exit with 3 and say what to set.

A deploy, step by step, every hour (`.github/workflows/pipeline.yml`): first the pipeline opens `main` → `feature/team-N` for every team branch that is behind, with auto-merge on unless the merge would conflict, and a teammate approves it; then it opens `feature/team-N` → `main` with auto-merge on for every team branch that is ahead; someone from the team ticks the remaining checklist items and approves; GitHub merges once CI is green, and Railway deploys `main` to production; the production check (`.github/workflows/production-check.yml`) waits until production runs it, opens every game and publishes a GitHub release with the PR's notes. `pnpm team:promote` still works by hand.

## Git hooks

`pnpm install` points git at the repository's hooks in `.githooks/` (`git config core.hooksPath .githooks`, via `tooling/install-hooks.mjs`), so every commit and push is checked, by people and by every coding agent alike: they all go through git. Nothing else to install.

| Hook | What it does |
|---|---|
| `commit-msg` | On a work branch (`<team-label>/<issue>-<description>`), adds `Refs #<issue>` to the message when it has no issue reference yet, in its own paragraph before any trailers. Then checks the message with the `check:commit` rules and refuses it with the reason and an example. Merge, revert and fixup messages pass untouched. It fills in the bare `Refs #` line from `.gitmessage`, works during a rebase reword, and never touches the diff `git commit -v` adds below the scissors line. |
| `pre-push` | Runs `pnpm preflight:quick` (lint, typecheck, ownership) and, on a work branch, `pnpm check:branch --offline`. These look at the working tree, so they only run when you push the commit you have checked out (not for tags, deletions or another branch), and a failure doesn't block the push while you have uncommitted changes, or when the checks can't run on this machine (exit code 3, e.g. a base branch that isn't fetched). It says so each time; CI checks the pushed commits. |

- Skip a hook once with `git commit --no-verify` or `git push --no-verify`. CI and the workflow checks still catch anything that was skipped.
- The hooks are Node scripts (no bash), so they run on macOS, Windows (Git Bash) and Linux.
- If you already use your own `core.hooksPath`, `pnpm install` leaves it alone and says how to switch to the repo's hooks. It does nothing in CI or outside a git checkout (a Railway build).
- The rules live in `tooling/workflow/lib/hooks.mjs`, with tests next to the other workflow checks.

## CI

Every pull request and every push to `main` runs the **CI** checks (`.github/workflows/ci.yml`) on Linux, one job per check so a PR shows exactly which one failed: 🧰 setup (`pnpm check:setup --ci`), 📝 config (`pnpm check:config`), 🧹 lint, 🔎 typecheck, 🧪 test and 📦 build, the same commands as above. Each job installs with `pnpm install --frozen-lockfile` through the shared `.github/actions/setup`. Only Linux runs, because every game deploys to Railway, which is Linux. A red check means the PR is not ready for review.

- It covers every package in the workspace, so a platform PR only passes when every team's game still builds.
- `--frozen-lockfile` fails when `pnpm-lock.yaml` is out of date: run `pnpm install` and commit the lockfile.
- Actions are pinned to commit SHAs. Update them through a platform PR.

A second workflow, **Workflow checks** (`.github/workflows/workflow-checks.yml`), runs `pnpm check:pr` and `pnpm check:commit` on every pull request: title, team label, branch and base names, template fields, linked issue, ticked checklist and the commit message format. It also runs the branch-level preflight checks (`check:branch`, `check:ownership`, `check:files`, `check:secrets`, `check:docs`, `check:determinism`, `check:contract`); `ci.yml` runs `check:config` after install. It reruns when the title or description is edited, so fix the text and the check turns green.

A third workflow, **Instructor gate** (`.github/workflows/instructor-gate.yml`), runs `pnpm check:instructor` on every pull request and on issues: the `team-instructor` label, title forms and *Team* section may only be used by the accounts in `.github/instructors.json`. On a PR the job `instructor gate` fails (it is the name the rulesets require); on an issue the job `instructor gate (issues)`, the only one allowed to write issues, leaves one comment and updates it to "resolved" once the issue is fixed. The workflow uses `pull_request_target`, so GitHub runs the copy of the file on the base branch and a PR cannot edit the gate that judges it, and the script and the list always come from `main`. That is only safe because no job checks out or runs the PR's code: do not add such a step. A PR into a branch that does not have the file yet (a `feature/team-N` that has not merged `main`) is not checked until it does. The instructors review changes to the workflow and the scripts (`.github/CODEOWNERS`).
