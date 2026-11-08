# Repository rules

> This file is the single source of truth for how everyone (humans and AI agents) works in this repository. `AGENTS.md` only points here. Change the rules here, through a reviewed PR.

These rules apply to every agent (and every human) working in this repository. They are not optional: if a change does not follow this workflow, it does not get merged.

## Repository layout

| Folder          | Owner       | Label             |
|-----------------|-------------|-------------------|
| `games/team-1/` | Team 1      | `team-1`          |
| `games/team-2/` | Team 2      | `team-2`          |
| `games/team-3/` | Team 3      | `team-3`          |
| `games/team-4/` | Team 4      | `team-4`          |
| `course/`       | Instructors | `team-instructor` |
| `server/`       | Platform    | `platform`        |
| `tooling/`      | Platform    | `platform`        |

Work inside your own team's folder. Changes to another team's folder or to the shared folders need an issue that says why, on a line of its own (`Cross-team: <why>`), and a review from someone on the owning team.

**`team-instructor` is reserved for the instructors.** Only the GitHub accounts in [`.github/instructors.json`](.github/instructors.json) may use it: the label, a PR title written `type(team-instructor): ...`, and `team-instructor` under *Team* in a PR. Everybody else, AI agents included, uses their own team label. To change files under `course/` from another team, use your team's label (or `platform`) and add a line `Cross-team: <why>` to the issue. The account is what is checked, not who typed: an instructor's AI-assisted work is fine.

- The `instructor gate` check runs on every pull request (it blocks the merge once the rulesets require it) and comments on issues. `pnpm check:instructor --kind pr|issue --number <n>` runs it by hand.
- `pnpm workflow:classify` refuses the `team-instructor` label to any other account. Agents never work around it (for example with `--actor`): they stop and ask which label to use.
- The instructors review everything under `course/` and any change to the list (`.github/CODEOWNERS`; binding once an admin imports the `main` ruleset).

## Tech stack

Everyone uses the same stack. Don't introduce alternatives without an issue that explains why.

- **Frontend:** **Vite + TypeScript**, one app per team in `games/team-N/` (start from `server/template/`).
- **Multiplayer:** Colyseus 0.18 on the server, `@colyseus/sdk` in the clients. Colyseus 0.18 changed many APIs, so read [server/CLAUDE.md](server/CLAUDE.md) before writing Colyseus code.
- **Hosting:** Railway.
- **Language:** TypeScript everywhere. The commands for install, lint, typecheck and tests are in [server/CLAUDE.md](server/CLAUDE.md).

## Branches

| Branch | Purpose | Deploys to | Receives pull requests from |
|--------|---------|------------|-----------------------------|
| `main` | What is live: finished work from all teams | Railway production | `feature/team-N`, `platform/*` branches |
| `feature/team-N` | Team N's integration branch | not deployed | Team N's work branches (`team-N/<issue>-…`) |

```
team-N/<issue>-<description>  →  feature/team-N  →  main
        (work branch)           (team review)     (CI green, deployed)
```

Every PR is merged with a **merge commit**, never squashed or rebased. Each contributor's own commits stay in the history under their name, so everyone's work is visible, and a team branch merged into `main` keeps the same history on both sides, so the next sync doesn't conflict. The rulesets allow only merge commits.

1. **Work branch → `feature/team-N`.** One pull request per issue, reviewed by a teammate. Everything your team is building lands here first, so one team's unfinished work never breaks another team. The issue stays open until the promotion that carries it merges into `main`; then the "Close shipped issues" workflow closes it, so a closed issue means it is in production.
2. **`feature/team-N` → `main`.** A promotion: only when CI is green for the feature branch. Merging it deploys to production. The hourly pipeline opens it; a teammate approves. The CI/CD checks are owned by P1 and described in [server/ARCHITECTURE.md](server/ARCHITECTURE.md) as they are added.
3. **Stay current.** `feature/team-N` must not fall behind `main`, or your team misses platform fixes, git hooks and commands. The hourly pipeline opens a sync PR from `main` into every feature branch that is behind, with auto-merge on: a teammate approves it and GitHub merges it once CI is green. Such a PR only runs CI, not the Workflow checks, so its result never marks `main`'s commit as failing (`pnpm branches:sync` opens the same PR by hand). When the merge would conflict, the pipeline still opens the sync PR but leaves auto-merge off and says so on its run's summary page. Its head is `main`, which nobody may push to, so resolve the conflicts on a team branch: open a team issue with the line `Cross-team: brings main into feature/team-N` (the merge touches other owners' files), branch `team-N/<issue>-…` from `origin/feature/team-N`, run `git merge origin/main` (or `pnpm sync --base main`), fix the conflicts, commit, and open that branch as a PR into `feature/team-N`. Once it is merged, merge or close the sync PR.

Platform work (`server/`, CI, Railway) and instructor work (`course/`, workflow files) don't belong to a game team, so their branches (`platform/<issue>-…`, `team-instructor/<issue>-…`) open pull requests straight into `main`.

The rulesets in `.github/rulesets/` enforce these rules on GitHub: `main` and every `feature/team-N` only change through a reviewed PR with green checks, and nobody can bypass that.

## Deploying to Railway

Railway is where the game is hosted. **Nothing is deployed until the go-live checklist below is complete.** After that, only the rules below can change what is running.

There is one environment, `production`, and it deploys `main`: everything merged into `main` goes live. **Nothing reaches `main` by itself.** It changes only when a reviewed PR with green checks is merged, and the [blocks](#blocks) below make sure of it. Railway belongs to the platform team: teams don't create or change Railway services, variables or domains. Open a `platform` issue instead.

**One address, every team.** Production serves each game on `main` at the same time, each under its own path (`<address>/team-N`); a team whose game isn't on `main` yet is listed on the index as "not released yet". A gateway (`server/gateway/`, see [server/ARCHITECTURE.md](server/ARCHITECTURE.md)) is the only service with a public domain; every game is its own service on Railway's private network. Each service follows the environment's branch, so adding or updating a team's game is the normal path (`feature/team-N` into `main`), and a merged game redeploys only its own service. Games must work under a path: see [server/docs/CLIENT_GUIDE.md](server/docs/CLIENT_GUIDE.md).

### Rules

1. **Deploy only through the pipeline.** What runs on Railway is what was merged into `main` (see [Branches](#branches)). **Only `main` deploys**: no `feature/team-N` or other team branch is ever deployed. Nobody deploys from a laptop (`railway up`), from a work branch, or by editing a service in the Railway dashboard. No workflow, bot or script may push into `main` or merge into it without a person: the hourly pipeline only opens the sync and promotion PRs with auto-merge on, and GitHub merges each once someone approves and every required check passes.
2. **Gate before `main`.** A change reaches `main`, and so production, only when all of this is true:
   - CI and the Workflow checks are green on the PR.
   - Someone other than the author approved it (the `main` ruleset requires it).
   - For a promotion, the rollback in its *Impact* field still holds: redeploy the previous production deployment, then revert the merge commit.

   Railway services use Wait for CI (`checkSuites` in `.railway/railway.ts`), so a commit with a red check is never deployed.
3. **Check after every deploy.** The `production check` workflow runs on every push to `main` that changed something a service deploys: it waits until production runs the commit and opens every game through the gateway (`pnpm qa:smoke`), then publishes a GitHub release with the merged PR's notes. A red run means production is not healthy: roll back (rule 9).
4. **Infrastructure is code.** Services, domains, variables and replicas are defined in `.railway/railway.ts` and changed through a reviewed PR that includes the `railway config plan` output. Don't use `railway.json` or `railway.toml`: Railway deprecated them and stops reading them on 2026-12-01. Anything missing from the file is deleted on apply, so every new service must be added there. A team's game is added to the `GAMES` list, which also adds it to the gateway.
5. **Secrets stay out of the repository.** Keys, tokens and passwords live in Railway variables (sealed, for secrets). No workflow deploys, so GitHub Actions keeps one secret only: `PIPELINE_APP_KEY`, the private key of the GitHub App the hourly pipeline opens PRs as, so they start CI. Never commit them, paste them into an issue, PR or chat, or print them in logs. Only `.env.example` (names, no values) is committed.
6. **Local is not production.** A laptop never uses production's variables or data. `APP_ENV` says where the code runs (`local` or `development` on a laptop, `production` on Railway, where debug commands are off), and `/health` returns it together with the deployed SHA. The one exception: the platform team can turn the debug tools on for one hosted game (`debug: true` in `GAMES`, which sets `DEBUG_TOOLS=on`) for the event's testing. `APP_ENV` stays `production`, `/health` reports `debug: true`, and it must be off again for judging and demos, because debug commands change game state. A team asks for it in a `platform` issue.
7. **Every service has a `/health` endpoint.** It is Railway's health check. A deploy that is not healthy is not fixed by restarting it by hand: investigate, or roll back. Keep the endpoint fast and free of dependencies.
8. **Keep it small.** One replica per service. No new service, database or paid add-on without an issue that says why and who pays for it.
9. **Roll back first, then fix.** If production breaks, redeploy the last good deployment in Railway, revert the merge commit on `main` through a PR (`git revert -m 1 <merge commit>`), and tell the team. Then fix on the feature branch and promote again. Don't debug on production.

### Blocks

These are what stop an unreviewed or red change from reaching `main`, and so production. Two of them ship with the repository; the rest need a repository admin, because GitHub only lets admins create rulesets.

| Block | What it stops | Where | Status |
|---|---|---|---|
| `main` ruleset | Direct pushes, force pushes and deletion of `main`; merging without a review or with red CI; squash and rebase merges | `.github/rulesets/main.json` | Needs an admin to import it (see the README in that folder) |
| `feature` ruleset | Deleting or force-pushing `feature/team-N`; merging into it without a review or with red CI; squash and rebase merges | `.github/rulesets/feature.json` | Needs an admin to import it |
| Railway source branch | Production deploying anything but `main` | `.railway/railway.ts` | In `.railway/railway.ts`; applied by a Railway owner |
| Wait for CI | A commit with a red check being deployed | `checkSuites` in `.railway/railway.ts` | In `.railway/railway.ts`; applied by a Railway owner |
| Railway deployment approval | A production deploy started by a GitHub account that is not linked to a Railway project member | Railway holds the deploy until a project member clicks Approve. It is a safety net, not a gate: a linked member deploys without it. Keep the project's members few | Needs a Railway project owner |

Until the rulesets are imported, nothing technical stops a push to `main` or a merge of a red PR. Follow the rules as if it did.

### Go-live checklist

All of these are done before the first deploy. Items marked *(admin)* need the repository owner. The full admin checklist, in order, is [KIT_SETUP.md](KIT_SETUP.md); the Railway steps are in [server/docs/RAILWAY_SETUP.md](server/docs/RAILWAY_SETUP.md).

- [ ] CI and the Workflow checks pass on `main`.
- [ ] The `main` and `feature` rulesets from `.github/rulesets/` are imported, in that order *(admin)*.
- [ ] The pull request settings match the admin checklist (merge commits only, auto-merge allowed, head branches deleted after merge) *(admin)*.
- [ ] The Railway project is defined in `.railway/railway.ts`, production follows `main`, and the `railway config plan` output was reviewed.
- [ ] Wait for CI is on for every service.
- [ ] The Railway GitHub app is installed on the repository *(admin)*. No Railway token is needed in GitHub, because no workflow deploys.
- [ ] The Railway project's members are set: the platform team as Editors, everyone else Viewers, Owner only for the administrators *(Railway project owner)*.
- [ ] Variables are set in Railway, nothing secret is in the repository, and no laptop uses production's values.
- [ ] `/health` returns `env` and `sha` on every service.
- [ ] A rollback was rehearsed once in production, before any team's game was on `main` (on the template service).
- [ ] `server/docs/RAILWAY_SETUP.md` has the public address of every service, and a deploy was checked by hand once, as it describes.

## Workflow

Every change goes through the same path: **issue → branch → commits → pull request → review → merge.** No shortcuts.

### 1. Issue first

- Open an issue before writing any code. No issue, no branch, no PR.
- The issue must carry exactly one team label: `team-1`, `team-2`, `team-3`, `team-4`, `platform` or `team-instructor`. The label says which team owns the work.
- The title is a short summary with no team prefix, `Add login page`, not `[team-2] Add login page`: the label already names the team.
- Describe what is changing and why, and what "done" looks like.

### 2. Branch

- Never commit directly to `main` or a `feature/team-N` branch. They only change through merged pull requests.
- Branch from an up-to-date `feature/team-N` (platform and instructor work: from `main`).
- Name the branch after the team label and the issue: `<team-label>/<issue-number>-<short-description>`
  - Examples: `team-2/14-add-login-page`, `platform/8-ci-checks`, `team-instructor/20-add-team-instructor-rules`

### 3. Commits

- Keep each commit to one logical change.
- Use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): subject`, for example `feat(team-2): add login page`. Types: `feat`, `fix`, `docs`, `refactor`, `chore`, `ci`, `build`, `test`, `perf`. The scope is your team label.
- Write the subject in the imperative mood, lowercase, at most 72 characters, without a trailing period ("add login page", not "Added login page.").
- Reference the issue on its own line in the body, e.g. `Refs #14`.
- Do not commit secrets, credentials, build output or large binaries.
- Set up the commit template once: `git config commit.template .gitmessage`.

### 4. Pull request

- One pull request per issue.
- Fill in every field of the [pull request template](.github/pull_request_template.md) (`**Label**: value`). Don't delete or rename the labels. The *Summary* (and a bug's *Root cause*) says why, in 2 or 3 sentences, never what changed: the diff shows that.
- The PR must carry the same team label as its issue.
- The title follows [Conventional Commits](https://www.conventionalcommits.org/), like a commit subject, with the team label as the scope: `feat(team-2): add login page`. The type matches the PR template (`feat` for a feature, `fix` for a bug, `docs`, `refactor`, or `chore`/`ci`/`build`/`test`/`perf` for a chore; `chore` for promotion and sync PRs). Issue titles have no team in them (`Add login page`).
- The description links the issue with a closing keyword (`Closes #14`) and summarizes what changed and how it was tested.
- Set the base branch as described in [Branches](#branches): `feature/team-N` for a work branch, `main` for a feature branch (and for platform and instructor work), `feature/team-N` for a sync from `main`.
- Keep the PR focused. Unrelated changes go in their own issue and PR.

### 5. Review and merge

- At least one approving review is required before merging. Nobody approves their own PR.
- All checks must pass.
- Resolve every review comment before merging.
- Rebase on or merge in the base branch if your branch is behind, then merge.
- Delete the branch after it is merged.

## Templates, classification and checks

Issues, pull requests and commits follow templates. **A script chooses the type, a skill fills the template, a check validates the result.** Agents never pick the type, template, team label or base branch themselves.

| | Templates | Agent skill | Check |
|---|---|---|---|
| Issue | `.github/ISSUE_TEMPLATE/`: feature, bug, docs, chore, refactor | `fill-issue` | `pnpm check:issue` |
| Pull request | `.github/PULL_REQUEST_TEMPLATE/`: the same five, plus sync | `fill-pr` | `pnpm check:pr`, also run by CI |
| Commit | `.gitmessage` | `write-commit` | `pnpm check:commit`, also run by CI |

- `pnpm workflow:classify --kind issue|pr|commit` decides the type from the change set (uncommitted files, `--staged`, or `--base <ref>`), plus the team label, the template and the base branch. The same change always gives the same answer.
- If no rule decides, it exits 1 and lists the candidates. Pass `--type` after asking; it never guesses between feature, bug and refactor.
- A PR from `main` is a sync into a `feature/team-N` branch: pass `--target feature/team-N`.
- Issue and PR templates are `**Label**: value` fields, one per line with no blank line between them; a value may continue on the lines below (a list, a checklist). Every field is required, in order, and must be filled in. Write `None` if one does not apply. *Screenshots* needs a reason with it: `None, <why there is nothing to show>`.
- The skills live in `.claude/skills/`, which both Claude Code and VS Code Copilot (agent mode) load; `.vscode/settings.json` turns them on for Copilot. The rules and their rationale are in `tooling/workflow/`.

**Before opening a PR, run `pnpm preflight`; it must pass.** It runs lint, typecheck, tests and the build, then checks the branch (name, base, linked issue), folder ownership, commit messages, committed files, secrets, docs links, game config and simulation determinism, and says how to fix each failure. Agents run `pnpm preflight:quick` (lint, typecheck, ownership) after every change. CI runs the same checks on every PR. Files owned by another team are only allowed when the issue explains why on a line of its own: `Cross-team: <why>`.

The "PR rubric" workflow (`pnpm pr:rubric`) comments a score on every PR: tests changed with the code, concrete *How to test* steps, screenshots of client changes (an image, or `None, <reason>`), a short *Summary* without code names, under 1000 changed lines of code (tests and docs not counted), and a *Root cause* on bug fixes. It is advice, not a gate: it never fails and is not a required check. Sync and promotion PRs are skipped.

## Labels

The repo has only two kinds of labels; there are no type, size or priority labels. Every label is defined in `tooling/workflow/labels.json`, and `pnpm labels:sync` makes GitHub match it (dry run by default, `--apply` to change). Don't create labels by hand.

| Labels | Rule | Set by |
|---|---|---|
| `team-1` … `team-4`, `platform`, `team-instructor` | exactly one on every issue and PR | you |
| `stackpile`, `waiting-on.author`, `waiting-on.review`, `waiting-on.merge` | on open PRs only | the labeller |

The **labeller** (`pnpm labels:prs`, the "PR labels" workflow) relabels every PR on any PR, review or comment event, and every 10 minutes as a fallback. It only touches these four labels, and removes them when a PR is closed or merged:

- `stackpile`: the PR is stacked on another PR (its base isn't `main` or a `feature/team-N` branch). It merges after the PR below it.
- Exactly one waiting label, checked in this order:
  1. `waiting-on.author`: a reviewer requested changes, a review thread is unresolved, or the PR is a draft. The author pushes fixes, resolves the threads, or marks the PR ready.
  2. `waiting-on.review`: no approving review from someone other than the author yet. A teammate reviews it.
  3. `waiting-on.merge`: approved with nothing open. Whoever merges for the team merges it.

## Never

- Push directly to `main` or a `feature/team-N` branch.
- Force-push to any of those branches or to someone else's branch.
- Open a pull request from a team work branch straight into `main`.
- Merge a PR without a team label, a linked issue or an approving review.
- Rewrite history that others have already pulled.
