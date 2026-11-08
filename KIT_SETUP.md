# Admin checklist

Everything an admin does to run a hackathon from this kit, in order. Start the week before the event: the teams arrive to a repository where the platform, the checks and one live game per team already work.

Each step names who can do it:

- **GitHub admin**: admin on the hackathon repository (owner of the organization or account that holds it).
- **Railway owner**: owner of the Railway workspace and project.
- **Instructors**: the people in `.github/instructors.json`.

Commands use `OWNER/REPO` for the new repository. Run them from a clone, logged in with `gh auth login` as the GitHub admin.

## 1. Before you start

- [ ] Decide who owns the repository. Use a GitHub **organization**: it gives teams per group, and the repository never has to move. Moving a repository mid-event breaks links and access. A personal account works, but has no teams.
- [ ] Check the plan. Rulesets and auto-merge, which the pipeline and every block in CLAUDE.md rely on, work on a **private** repository only on a paid plan (GitHub Pro for a personal account, Team for an organization; schools can get Team free through GitHub Education). On a free plan, make the repository public.
- [ ] Name the GitHub admin and the Railway owner, at least two people each, so one absence doesn't block a deploy.
- [ ] Decide who pays for Railway, and on which plan. Requiring two-factor authentication for the workspace needs the Pro plan.
- [ ] Create the meeting room (for example Google Meet) and the team project boards' owner.
- [ ] Rehearse the pipeline once in a throwaway repository ([KIT_REHEARSAL.md](KIT_REHEARSAL.md)), unless nothing in the pipeline, the rulesets or Railway changed since the last rehearsal.

## 2. Create the repository *(GitHub admin)*

- [ ] On GitHub, **Use this template**, in the organization from step 1. Public repositories get secret scanning for free; private ones need a paid plan for it.
- [ ] Clone it, then check it works locally: `pnpm install`, `pnpm check:setup` and `pnpm test` all pass. [GETTING_STARTED.md](GETTING_STARTED.md) lists the tools.
- [ ] Fill in the placeholders and push to `main` (before the rulesets exist, so a direct push still works):

  | File | Set |
  |---|---|
  | `kit.json` | `repo` (`OWNER/REPO`) and `railwayProject` (the Railway project name) |
  | `.github/instructors.json` and `.github/CODEOWNERS` | the instructors' GitHub logins, the same in both (a test checks it) |
  | `course/teams.json` | the roster: instructors, and each student's login, name, nickname and team |
  | `course/README.md` | `MEET_URL` (the meeting room) and each `BOARD_URL` (the team project boards) |
  | `README.md` | the "Use this template" badge, which points at the kit's own repository |

  Then search for leftovers: `git grep -nE "OWNER/REPO|MEET_URL|BOARD_URL|instructor-login|student-login|muneeebnaveeed/hackathon-kit"`.
- [ ] Create the branches. A template copies only `main`, which production deploys; each team merges into its own `feature/team-N`:

  ```bash
  git push origin main:feature/team-1 main:feature/team-2 main:feature/team-3 main:feature/team-4
  ```

## 3. Repository settings *(GitHub admin)*

- [ ] **General.** Issues and Projects on, Wiki and Discussions off. Pull requests: **merge commits only**, squash and rebase off. A squash merge credits the whole PR to its author and hides everyone else's commits, and the evaluation reads who did what from the commits; merge commits also keep a team branch's history the same on `main`, so the next sync doesn't conflict. **Always suggest updating pull request branches** on. **Allow auto-merge** on: it still waits for the review and checks the rulesets require. **Automatically delete head branches** on, so merged work branches go away; the `feature/team-N` ruleset in step 7 stops it deleting the team branches.

  ```bash
  gh api -X PATCH repos/OWNER/REPO \
    -F has_issues=true -F has_projects=true -F has_wiki=false -F has_discussions=false \
    -F allow_merge_commit=true -F allow_squash_merge=false -F allow_rebase_merge=false \
    -F allow_update_branch=true -F allow_auto_merge=true -F delete_branch_on_merge=true
  ```
- [ ] **Actions.** Workflow permissions read-only by default (each workflow asks for what it needs), and Actions may not create or approve pull requests (no workflow needs it):

  ```bash
  gh api -X PUT repos/OWNER/REPO/actions/permissions/workflow \
    -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false
  ```

  Keep **Require approval for all outside collaborators** for workflows from forks.
- [ ] **Security.** Dependabot alerts on. On a public repository, secret scanning and push protection on.
- [ ] **Pipeline app.** The hourly pipeline (`.github/workflows/pipeline.yml`) opens the sync and promotion PRs. PRs opened with the built-in Actions token start no CI, so it opens them as a GitHub App, which gets a fresh one-hour token each run. Make the app once and reuse it for every event:
  1. Create it under the account or organization that owns the repository: Settings, Developer settings, GitHub Apps, **New GitHub App**. Any name (for example `kit-pipeline`) and homepage URL; turn **Webhook** off. Repository permissions: **Contents** read and write (auto-merge merges as the app; the rulesets still stop it pushing to `main` or a team branch), **Pull requests** read and write, **Issues** read and write. **Only on this account.**
  2. On the app's page, note the **Client ID** and **Generate a private key** (a `.pem` file downloads).
  3. **Install App**, on this repository only.
  4. Store the Client ID as the Actions variable `PIPELINE_APP_CLIENT_ID` and the whole `.pem` as the Actions secret `PIPELINE_APP_KEY`, then delete the file:

     ```bash
     gh variable set PIPELINE_APP_CLIENT_ID -R OWNER/REPO -b <client-id>
     gh secret set PIPELINE_APP_KEY -R OWNER/REPO < path/to/key.pem
     ```

  The key is the only secret the repository needs: no workflow deploys, so there is no Railway token in GitHub. A person can approve the app's PRs, since the app opened them.

## 4. People *(GitHub admin)*

- [ ] In the organization, create one team per group: `team-1` to `team-4`, `platform` and `instructors`.
- [ ] Give the repository roles: **Write** for students and the platform team (they push work branches and review), **Maintain** for the instructors. Write is the least that lets someone push a branch; nobody gets Admin except the GitHub admins.
- [ ] Instructors need at least Write for `CODEOWNERS` to count their approval on `course/`.
- [ ] Every participant accepts the invitation and runs `pnpm check:setup`, logged in with `gh auth login`.

## 5. Labels and boards *(GitHub admin)*

- [ ] Create the labels: `pnpm labels:sync --apply`.
- [ ] Create one project board per team and one for all teams, and turn on the board's **Auto-add** workflow filtered by the team label (`label:team-2`). Put their links in `course/README.md`.

## 6. Railway *(Railway owner, plus the GitHub admin for the app)*

The commands are in [server/docs/RAILWAY_SETUP.md](server/docs/RAILWAY_SETUP.md).

- [ ] Install the Railway GitHub app on this repository only *(GitHub admin)*.
- [ ] Create the project (named as `railwayProject` in `kit.json`). It has one environment, `production`, which Railway creates.
- [ ] `railway link`, `railway config plan` (read it: anything missing from `.railway/railway.ts` is deleted), `railway config apply`.
- [ ] With auto-merge, GitHub records the pipeline app as the one who merged a promotion. If Railway holds that deploy for approval (it does for an author it can't link to a member), a member clicks Approve; the rehearsal shows which.
- [ ] Give the `gateway` service a public domain, and nothing else.
- [ ] Members: the platform team as Editors, everyone else Viewers, Owner only for the administrators. Turn on **Require 2FA** if the plan allows it.
- [ ] Check `<address>/health` and `<address>/team-1/health` to `team-4`.
- [ ] Store the gateway's address as the repository variable `KIT_GATEWAY` (Settings, Secrets and variables, Actions, Variables). The production check reads it. Share it in the course channel too: `pnpm env:status`, `env:wait` and `qa:smoke` read the same `KIT_GATEWAY` locally.
- [ ] Rehearse a rollback once, before any team's game is on `main`: redeploy the template service's previous deployment.

## 7. Rulesets *(GitHub admin, last)*

Import them last: a required check that has never run on the repository blocks every merge. First make sure CI and the Workflow checks have run on `main` (they run on the pushes from step 2).

- [ ] Import `main.json`, then `feature.json` ([.github/rulesets/README.md](.github/rulesets/README.md)):

  ```bash
  for f in main feature; do gh api -X POST repos/OWNER/REPO/rulesets --input .github/rulesets/$f.json; done
  ```
- [ ] Check they hold: a direct push to `main` is refused, and so is deleting a team branch (`git push origin --delete feature/team-1`).
- [ ] After the first merge of a `feature/team-N` into `main`, check that the team branch still exists.

## 8. Go-live

- [ ] The go-live checklist in [CLAUDE.md](CLAUDE.md#go-live-checklist) is ticked.
- [ ] Every team's stub game answers at `/team-1` to `/team-4` through the gateway.
- [ ] One person per team has opened an issue, a branch and a PR with `pnpm issue:start` and `pnpm pr:open`, and the checks passed.
- [ ] Turn the pipeline on: set the repository variable `PIPELINE` to `on`, then run it once by hand (Actions, Hourly pipeline, Run workflow). Its summary says, per team, whether it opened a sync PR and a promotion PR, or why it skipped. From then on it runs every hour; any other value pauses it.
- [ ] Each team knows its job in the pipeline: someone from the team approves the hourly promotion PR after ticking its remaining checklist items. Merging it deploys the team's game, and a red Production check run means roll back first. They also approve the sync PRs from `main` into their branch (the `feature` ruleset needs one approval); a sync that would conflict opens without auto-merge, and the team resolves it on a team branch (CLAUDE.md, Branches, step 3).

## 9. After the event

- [ ] Approve the last promotions, then set `PIPELINE` to `off` and uninstall the pipeline app from the repository. Run the course reports (`course/README.md`, "Evaluation") and keep the student scores out of the repository.
- [ ] Archive the repository (Settings, General, Danger Zone) so it stays readable but nobody can push.
- [ ] Remove Railway members who no longer need access, and stop the production services once nobody plays the games any more.
