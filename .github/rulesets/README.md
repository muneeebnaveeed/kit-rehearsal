# Rulesets

Branch rules that make the workflow in `CLAUDE.md` enforced instead of followed by convention. GitHub does not read this folder: a **repository admin** has to import each file once.

| File | Protects | What it blocks |
|---|---|---|
| `main.json` | `main` (production) | Direct pushes, force pushes and deletion. Merging without an approving review by someone other than the last pusher, without resolved conversations, with anything but a merge commit, or while CI, the `instructor gate` or the PR template check is red. No bypass, not even for admins. With `.github/CODEOWNERS`, a change under `course/` also needs an instructor to approve it. |
| `feature.json` | `feature/team-1` to `feature/team-4` | Deletion (including the automatic deletion of head branches after a merge into `main`) and force pushes. Merging without an approving review, with anything but a merge commit, or while CI, the `instructor gate` or the PR template check is red. |

## Import (admin)

1. Open **Settings → Rules → Rulesets → New ruleset → Import a ruleset**.
2. Choose `main.json`, review it and create it. Repeat for `feature.json`.
3. In **Settings → General → Pull Requests**, match [KIT_SETUP.md](../../KIT_SETUP.md#3-repository-settings-github-admin). Auto-merge is allowed: it waits for the approving review and the required checks these rulesets ask for, so it cannot merge past a gate.

Or from a terminal, as an admin:

```bash
gh api -X POST repos/OWNER/REPO/rulesets --input .github/rulesets/main.json
gh api -X POST repos/OWNER/REPO/rulesets --input .github/rulesets/feature.json
```

## Notes

- `instructor gate` comes from `instructor-gate.yml`, which runs from the base branch (`pull_request_target`). It runs on every PR and passes when the PR does not use the `team-instructor` identity, so requiring it is safe. Its first run, on the PR that adds it, fails with `Cannot find module .../check-instructor.mjs`, because the job checks out `main` and the script is not there yet; that is expected. Import the rulesets only after the workflow is on `main` **and has passed once there**.
- `main.json` sets `require_code_owner_review`, which is what makes `.github/CODEOWNERS` binding: the instructors listed there must approve changes under `course/` and to `.github/instructors.json`. The list in `CODEOWNERS` has to match `.github/instructors.json` (a test checks it).
- The status check names must match the job names in `.github/workflows/`: `instructor gate` (`instructor-gate.yml`), `pull request follows the template` (`workflow-checks.yml`) and `🧰 setup`, `📝 config`, `🧹 lint`, `🔎 typecheck`, `🧪 test` and `📦 build` (`ci.yml`, emoji included). Rename a job and the ruleset (and `REQUIRED_CHECKS` in `tooling/workflow/lib/required-checks.mjs`) must change with it, or merging stops; `required-checks.test.ts` fails if they drift.
- `pull request follows the template` skips sync PRs from `main`, and a skipped check counts as passed.
- Nobody can bypass `main.json`: merging into `main` is a production deploy. If an admin needs to, they edit the ruleset first, and that change is visible in the audit log.
