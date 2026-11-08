# Rehearsal

A dry run of the whole flow in a throwaway repository, before the real one exists. It proves what the tests can't: that the pipeline app's PRs start CI, that auto-merge waits for an approval, that Railway deploys a merge and the production check sees it, and that GitHub keeps `feature/team-N` after a promotion merges. Plan one afternoon. Do it each time the kit changes in the pipeline, the rulesets or Railway.

You need two GitHub accounts: one that opens a work PR and one that approves it. The pipeline app opens the automatic PRs, so either account can approve those.

## 1. Repository

- [ ] Create a repository from the template, e.g. `OWNER/kit-rehearsal`: private on a paid plan, public otherwise (rulesets and auto-merge need one or the other), and follow [KIT_SETUP.md](KIT_SETUP.md) sections 2 to 7 against it, with these shortcuts:
  - Labels, rulesets, the pipeline app and the `KIT_GATEWAY` variable: as written. These are what is being rehearsed. Install the app you already have on the rehearsal repository as well.
  - People: just the two accounts.
  - Railway: a separate project (`railwayProject` in `kit.json`), so the rehearsal never touches the real one. The template game and one team stub are enough in `GAMES`.

## 2. One work PR, one promotion

- [ ] As the first account: `pnpm issue:start` for team-1, a one-line visible change in `games/team-1`, `pnpm pr:open`. The checks run, the labeller sets `waiting-on.review`, and the rubric comment appears.
- [ ] As the second account: approve and merge it into `feature/team-1`. `feature/team-1` still exists afterwards.
- [ ] Run the Hourly pipeline by hand (Actions, Run workflow). The run summary says it opened the promotion for team-1 and skipped the others. The PR is by the app (`<name>[bot]`), has auto-merge on and is waiting for a review.
- [ ] As the second account: tick the remaining checklist items and approve. GitHub merges once CI is green, with a merge commit.
- [ ] Check after the merge:
  - `feature/team-1` still exists. If GitHub deleted it, the feature ruleset is missing or "delete branch on merge" won over it: fix that before the event.
  - Railway deployed `main`, or holds the deploy for approval because the app isn't a project member (KIT_SETUP.md, section 6). Note which, and fix section 6 if it is wrong.
  - The Production check run on the merge commit is green and a GitHub release exists.
  - `pnpm env:status` shows production on the merge commit.

- [ ] Run the pipeline by hand again. `feature/team-2` (or any team branch other than team-1) is now behind `main`, so the run opens a sync PR into it with auto-merge on, and skips the promotion for team-1 because it has nothing new. Approve the sync as a member of that team; it merges once CI is green.
- [ ] Set `debug: true` on the team-1 entry in `GAMES`, apply, and check that only that game's `/health` says `"debug":true` and shows the overlay. Remove it again.

## 3. Failure paths

- [ ] Push a commit that fails lint to a team branch through a PR: CI is red, and the next pipeline run skips the promotion while the PR stays open, or doesn't open one.
- [ ] Make `main` and a team branch change the same line, then run the pipeline: the sync PR opens without auto-merge and the run summary says it needs a person.
- [ ] Merge a docs-only change into `main`: the Production check passes at once without waiting for a deploy, and publishes no release.
- [ ] Roll back once: redeploy the previous production deployment in Railway, then revert the merge commit on `main` through a PR.

## 4. Clean up

- [ ] Set `PIPELINE` to `off`, remove the repository from the app's installation, delete the Railway project and the repository.
