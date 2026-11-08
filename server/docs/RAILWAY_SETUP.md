# Railway setup

Railway is the only place the game is hosted. It deploys straight from the GitHub branches, and no GitHub Actions workflow deploys or applies anything. The rules are in "Deploying to Railway" in [CLAUDE.md](../../CLAUDE.md), the environment in [ARCHITECTURE.md](../ARCHITECTURE.md), and the config in [`.railway/railway.ts`](../../.railway/railway.ts). This page is for the people who set Railway up. The checklist to tick is [KIT_SETUP.md](../../KIT_SETUP.md).

## How a change reaches Railway

**Only `main` deploys, to the one environment, `production`.** No `feature/team-N` or other team branch is ever deployed to Railway. A reviewed PR into `main` (usually a promotion from `feature/team-N`) is what changes production.

| Merged into | Railway deploys | Environment |
|---|---|---|
| `main` | each game service whose files changed, once CI passed on the commit | production |

- **Wait for CI** is on: a deploy starts only after every GitHub check on the commit passed.
- A service redeploys only when its game folder or the platform it runs on changed (the watch paths in `.railway/railway.ts`). A commit that only touches Markdown or tests redeploys nothing.
- If the person who pushed to a connected branch has no linked Railway account, Railway does not deploy automatically: it creates a *deployment approval* and a project member has to click **Approve**. A project member whose GitHub account is linked deploys without it. So the approval is a safety net, not the gate. The gate for production is the review on the PR into `main` (the `main` ruleset), plus keeping the Railway project's members few.

## What you need

- Owner of the Railway project, and admin on `OWNER/REPO` for the GitHub items.
- The Railway CLI, logged in with `railway login` ([install](https://docs.railway.com/cli)).
- Node 22.21.1 (the pin in `.nvmrc`): the CLI runs `.railway/railway.ts` with `node --experimental-strip-types`.
- The Railway GitHub app installed on the repository, with access to this repository only. Railway asks for it when you create the first service from a GitHub source.

## One-time setup, in order

1. **Project.** Create the Railway project in the workspace that will pay for it (name it as `railwayProject` in `kit.json`). Two-factor enforcement for the workspace needs the Pro plan.
2. **Environment.** `production` exists by default, and it is the only one. Don't add others: the CLI refuses an environment `.railway/railway.ts` does not manage.
3. **Apply the config.** From an up-to-date `main`:
   ```bash
   railway link                         # pick the project and production
   railway config plan                  # read it
   railway config apply
   ```
   **Read the plan before you apply.** Anything missing from `.railway/railway.ts` is deleted, so a plan that deletes something you did not expect means stop. Paste the plan into the PR that changed the file.
4. **Public address.** Give a public domain to the `gateway` service, and to nothing else:
   ```bash
   railway domain --service gateway --port 8080
   ```
   The games stay private: they answer the gateway on Railway's private network, and the gateway serves each one at `<address>/<game>` (for example `<address>/team-2`). Do not give a game a domain of its own: players would bypass the gateway. `.railway/railway.ts` cannot declare Railway's generated domains, so check by hand that only the gateway has one (the service's Settings, Networking). Write the address in the table below.
5. **People.** Add the platform team as Editors (they can deploy and change settings), everyone else as Viewers (read only), and keep Owner for the administrators. Ask Editors to link their GitHub account in Railway. Turn on **Require 2FA** in the workspace's People settings if the plan allows it.
6. **Check it.** `curl https://<address>/health` (the gateway) must answer `ok` with the right `env` and the `sha` of its deployed commit. For every game, `curl https://<address>/<game>/health` must answer `ok` with the same `env` and the `sha` of that game's deployed commit. Then merge a harmless commit into `main` and watch Railway wait for CI before it deploys.
7. **Rehearse a rollback once, before any team's game is on `main`.** Open the `template` service's Deployments tab and redeploy the previous successful deployment. Real rollbacks are done the same way, before anything is fixed (see rule 9 in `CLAUDE.md`).

| Environment | Service | Address |
|---|---|---|
| production | `gateway` (public) | not set up yet |
| production | `template` (private) | `<production address>/template/`, not set up yet |

## Checking a deploy by hand

The `production check` workflow does this after every merge into `main` (`pnpm qa:smoke`). Do it by hand when that check can't run, for example before `KIT_GATEWAY` is set:

```bash
git rev-parse origin/main                             # the commit production should run
curl -s https://<production address>/<game>/health    # {"ok":true,"env":"production","sha":"<commit>", ...}
curl -s https://<production address>/health           # the gateway's own sha
```

Do it for every game, and for the gateway.

- The commits are the same: production runs it.
- They differ: a service only redeploys when its watch paths changed. List what changed since the deployed commit, in the service's own folder and the platform paths in `PLATFORM_WATCH` (`.railway/railway.ts`; the gateway also watches `server/gateway/`). If nothing there changed, production is current for that service:
  ```bash
  git diff --stat <sha from /health> origin/main -- <the paths in PLATFORM_WATCH> <the service's folder>
  ```

## What we do not use

- **Deploying team branches.** `feature/team-N` and every other team branch are never deployed to Railway, and there is no environment for them. A team sees its work running only after it reaches `main` (production); before that, it runs locally.
- **A GitHub Environment or Railway tokens in GitHub secrets.** They would only matter if a GitHub Actions workflow deployed, and none does: Railway deploys from the branches, and the hourly pipeline only opens PRs (its `PIPELINE_TOKEN` is a GitHub token, not a Railway one). Do not add either; if a workflow ever applies the config, use a Railway *project* token (scoped to production) and store it in GitHub's secret store.
- **`railway.json` or `railway.toml`.** Railway deprecated them and stops reading them on 2026-12-01. The config is `.railway/railway.ts`.
- **Per-team Railway projects, a development or staging environment, and promoting between Railway environments.** The repository has one project and one environment.
