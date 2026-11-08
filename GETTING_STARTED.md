# Getting started

This guide takes you from a fresh machine to your first merged pull request. It works the same on macOS, Windows and Linux.

The rules for working in this repo are in [CLAUDE.md](CLAUDE.md). The course rules (meetings, tracking, evaluation) are in [course/README.md](course/README.md).

## 1. Install the tools

You need four things. Nothing else: no Docker, no version manager.

| Tool | Version | How |
|---|---|---|
| Git | any recent | [git-scm.com](https://git-scm.com/downloads) |
| Node.js | 22.21.1 or a later 22.x (pinned in `.nvmrc`) | [nodejs.org](https://nodejs.org/en/download), or `nvm install` / `fnm use --install-if-missing` if you already use nvm or fnm |
| pnpm | 10.28.0 (pinned in `package.json`) | `corepack enable`, or `npm install -g pnpm@10.28.0` |
| VS Code | any recent | [code.visualstudio.com](https://code.visualstudio.com/) (recommended, not required) |

Also install the GitHub CLI (`gh`) and run `gh auth login`. It's the easiest way to open issues and PRs, and later platform scripts use it.

## 2. First run

```bash
git clone https://github.com/OWNER/REPO.git
cd REPO
pnpm install
pnpm check:setup
pnpm dev
```

- `pnpm install` stops with a clear message if your Node version is wrong. It also switches on the repo's git hooks: your commits get their `Refs #<issue>` added from the branch name and are checked, and pushes run the quick checks.
- Run `git config commit.template .gitmessage` once. Your commit editor then starts with the required message format (`type(scope): subject` plus `Refs #<issue>`), which `pnpm check:commit` and CI check.
- `pnpm check:setup` checks your machine (Node and pnpm versions, dependencies, line endings, file names, free ports) and tells you how to fix anything that fails.
- `pnpm dev` runs the template game: open <http://localhost:5173>. You should see **Server OK**. Stop it with Ctrl+C.

Open the folder in VS Code and accept the recommended extensions (Biome, EditorConfig). Files are then formatted on save, the same way CI checks them.

## 3. Find your way around

| Folder | What's in it | Owner (label) |
|---|---|---|
| `games/team-N/` | Your team's game | Team N (`team-N`) |
| `server/` | The shared multiplayer platform: server host, netcode contract, template game | Platform (`platform`) |
| `tooling/` | Workflow commands and checks (`pnpm pr:open`, `pnpm preflight`, ...), QA scripts, shared TypeScript config | Platform (`platform`) |
| `course/` | Course information | Instructors (`team-instructor`) |

Work only in your own team's folder. To change anything else, open an issue that explains why, with the owning team's label.

Every game is a package in one pnpm workspace and builds on the same platform: TypeScript, [Colyseus](https://colyseus.io) for real-time multiplayer, and Vite for the browser client. See [server/ARCHITECTURE.md](server/ARCHITECTURE.md) for how the pieces fit together.

## 4. Start your team's game

One person per team does this once, in its own issue and PR. Copy the template by hand:

```bash
git archive -o template.tar HEAD:server/template
tar -xf template.tar -C games/team-N
```

Then delete `template.tar` and, in `games/team-N/`:

1. In `package.json`, change `"name"` to `"@team-N/game"`.
2. In `shared/index.ts`, change `GAME_ID` to `"team-N"`.
3. In `index.html`, change the `<title>`.

Then from the repo root:

```bash
pnpm install
pnpm --filter @team-N/game dev
```

These commands work in Git Bash, PowerShell and macOS/Linux terminals. Only one game can run at a time locally, because every game uses ports 2567 and 5173.

## 5. Make your first change

Every change follows the same path: **issue → branch → commits → pull request → review → merge**. The full rules are in [CLAUDE.md](CLAUDE.md).

Code reaches production in two steps:

```
team-N/<issue>-<description>  →  feature/team-N  →  main
        (your work branch)       (team's branch)   (all teams, live)
```

- **Your work branch → `feature/team-N`:** one PR per issue, reviewed by a teammate.
- **`feature/team-N` → `main`:** when the team's work is ready and CI is green. The hourly pipeline opens this PR and a teammate approves it. Merging it deploys your game to production.
- Platform work (`platform/<issue>-…`) goes straight into `main`.

1. **Open an issue.** Title `[team-N] Short description`, one label (`team-N`), a goal and a "done when" checklist. Assign yourself.
2. **Create a branch** from your team's up-to-date `feature/team-N`, named after the label and the issue:

   ```bash
   git switch feature/team-N
   git pull
   git switch -c team-N/42-short-description
   ```

3. **Commit** small, focused changes in the imperative mood ("Add score display"), with `Refs #42` in the commit body. On a branch named `team-N/42-…` the commit hook adds `Refs #42` for you.
4. **Check before you push:**

   ```bash
   pnpm preflight
   ```

   It runs lint, typecheck, tests and the build, then checks your branch name, base branch and issue, folder ownership, commit messages, committed files, secrets and docs links, and says how to fix anything that fails. CI runs the same checks on your PR.

5. **Open a pull request into `feature/team-N`.** Title in the commit format, e.g. `feat(team-N): add score display`, the same label as the issue, `Closes #42` in the description, and every field of the PR template filled in. The *Summary* says why you made the change, not what changed.
6. **Wait for CI.** Each check (🧰 setup, 📝 config, 🧹 lint, 🔎 typecheck, 🧪 test, 📦 build) shows separately on the PR. All of them must be green.
7. **Get a review** from a teammate, fix any comments, then merge and delete the branch.
8. **Keep up to date.** After `feature/team-N` is merged into `main`, merge `main` back into `feature/team-N` before starting the next piece of work.

## 6. Working with AI agents

The course is AI first, so expect agents to do much of the work. Point them at the rules:

- **Claude Code** reads [CLAUDE.md](CLAUDE.md) automatically, plus [server/CLAUDE.md](server/CLAUDE.md) when it works in `server/`.
- **Other agents** (Codex and others) read `AGENTS.md`, which points to `CLAUDE.md`.
- Ask agents to run `pnpm preflight:quick` after each change and `pnpm preflight` before they say they're done, and to follow the issue → branch → PR workflow.
- Agents follow the same ownership rules as people: they work only in your team's folder.

## 7. Troubleshooting

| Problem | Fix |
|---|---|
| `pnpm install` says "Wrong Node.js version" | Install the Node version it names (see step 1), open a new terminal, and run it again. |
| A commit or push is refused with "does not follow the commit format" or a failing check | The hook says what's wrong and how to fix it. Fix it and try again; in an emergency, `git commit --no-verify` or `git push --no-verify` skips the hook once (CI still checks). |
| CI fails at "Install" with a lockfile error | Your `package.json` changed without the lockfile. Run `pnpm install` and commit `pnpm-lock.yaml`. |
| `pnpm dev` says a port is in use | Another dev server is still running. Stop it (Ctrl+C in its terminal), or run `pnpm check:setup` to see which port is taken. |
| Every file shows as changed on Windows | Line endings were converted to CRLF. Run `pnpm format`, and check that you pulled `.gitattributes`. |
| CI is red on only one OS | Often a file name that differs only by case, or a path written with `\`. Run `pnpm check:setup`, and use `path.join` in code. |
| Anything else | Run `pnpm check:setup` first. If it passes, ask in the course Meet or open an issue with the `platform` label. |
