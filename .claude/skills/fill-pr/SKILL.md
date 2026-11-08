---
name: fill-pr
description: Open a GitHub pull request for this repository that follows its template. Use when the user asks to open, create or write a pull request or PR, or when finished work on a branch needs one. The classifier script chooses the template, label and base branch, you fill it in, and check:pr validates it.
---

# Fill a pull request

The rule: **the script chooses, you fill, the check decides.** Never pick the PR type, template, team label or base branch yourself, and never open a PR that `pnpm check:pr` rejects.

Prerequisites: the work is committed on a branch named `<team-label>/<issue-number>-<slug>` and an issue exists (open one with the `fill-issue` skill first if not). Commits should follow the format checked by `pnpm check:commit` (see `write-commit`).

## 1. Classify

Run from the repo root, with the branch the PR comes from:

```bash
pnpm workflow:classify --kind pr --base <base-ref> --json
```

Use `origin/main` as `<base-ref>` for platform and instructor work, `origin/feature/team-N` for team work.

- It returns `type`, `label`, `base` (the branch to target) and `template`.
- **Exit code 1 means it could not decide** (`undecided: true`, with `candidates`). Ask the user which type it is, then re-run with `--type <their answer>`.
- Syncs have `main` as their head. Pass `--target feature/team-N` and `--label platform` (they use `Refs #N`, not `Closes #N`). Promotions (`feature/team-N` into `main`) are opened by `pnpm team:promote`, not by hand.
- If it lists several owners for the changed files, the change must be split, because a PR has exactly one team label.

## The team-instructor label

`team-instructor` is reserved for the instructors (`.github/instructors.json`). The classifier refuses it, with an explanation, when the GitHub account is not on that list. **Do not work around it**: never pass `--actor`, never edit the list, never write the label by hand. Stop, tell the user which label you would use instead (their team's, or `platform`; for changes under `course/` from another team, also a line `Cross-team: <why>` in the issue) and continue with that.

## 2. Gather the facts

- The issue: `gh issue view <n>` (the number is in the branch name). The summary must match what the issue asked for.
- The commits and diff: `git log --oneline <base-ref>..HEAD` and `git diff <base-ref>...HEAD --stat`.

## 3. Fill the template

Read the file named in `template`. Write the PR body to a scratch file (not into the repo) that keeps **every `**Label**:` field, in order, with the exact same label**, one field per line with no blank line between fields. A value can run over several lines (a list, test steps); put it on the lines after `**Label**:`. Remove the HTML comments. Don't add `##` headings.

- **Title:** Conventional Commits with the label as the scope, like a commit subject: `<type>(<label>): <short imperative summary>`, lowercase, at most 72 characters, no period. Use the `commitType` from the classification (`feat` for feature, `fix` for bug, `docs`, `refactor`, a chore type, or `chore` for sync), e.g. `feat(team-2): add login page`.
- **Linked issue:** `Closes #<n>` (work PRs) or `Refs #<n>` (sync).
- **Team:** the label, as plain text.
- **Summary:** why the change exists, in 2 or 3 sentences: the problem or goal from the issue, and what players or teams get from it. Never a summary of what changed (the diff shows that), and no file, function or other implementation names.
- **Root cause** (bug): why it broke, the wrong assumption or missed case, not the lines you changed. Same rules as Summary.
- Fill the other type-specific fields (Pages affected, Impact, Behaviour unchanged, Included changes) when the template has them.
- **How to test:** only steps and commands that you actually ran, with their real results. If you did not run something, say so. Never claim a test passed that you did not run.
- **Screenshots:** an image or link of the visible change, or `None, <why there is nothing to show>` (for example `None, no client files changed`). A bare `None` fails `pnpm check:pr`.
- **Checklist:** tick an item only if it is true. If one is not, fix the cause (rename the branch, change the base) before ticking it. Notes after an item are fine.
- Write in English. Use only facts from the issue, the code and the commands you ran.

## 4. Check

```bash
pnpm check:pr --title "<title>" --body-file <body-file> --head <branch> --base <base> --labels <label> --git-base <base-ref>
```

Fix every problem and re-run. A warning about a different classification is worth reading: use the template the classifier chose unless the user says otherwise. After three failed rounds, stop and show the user the remaining messages.

## 5. Open

```bash
git push -u origin <branch>
gh pr create --base <base> --head <branch> --title "<title>" --body-file <body-file> --label <label>
```

Report the PR URL. Do not request reviewers, merge, or enable auto-merge unless the user asks.
