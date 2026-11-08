---
name: write-commit
description: Write and make a git commit for this repository in the required format (Conventional Commits with an issue reference). Use when the user asks to commit, or when finished changes need committing. The classifier script chooses the commit type and scope, you write the message, and check:commit validates it.
---

# Write a commit

The rule: **the script chooses, you write, the check decides.** Never pick the commit type or scope yourself, and never create a commit that `pnpm check:commit` rejects.

Format: `type(scope): subject`, a blank line, why the change was needed, then `Refs #<issue>` on its own line. Example:

```
feat(team-2): add login page

Players need an account before they can join a room.

Refs #14
```

## 1. Stage and look

Stage only what belongs in this commit (one logical change). Then:

```bash
git status --short
git diff --staged
```

If the staged changes are really two changes, unstage one and commit them separately. Never stage secrets, `.env` files, build output or large binaries.

## 2. Classify

```bash
pnpm workflow:classify --kind commit --staged --json
```

- Use `commitType` as the type and `scope` as the scope. `commitTypes` lists the allowed alternatives for that kind of change (for a chore: `chore`, `ci`, `build`, `test`, `perf`); the script's `commitType` is the default.
- **Exit code 1 means it could not decide** (`undecided: true`). Ask the user whether it is a `feat`, a `fix` or a `refactor` and re-run with `--type feature|bug|refactor`. Do not guess.
- The scope is the team label. If the script reports several owners, the commit mixes teams' files: split it.

## The team-instructor label

`team-instructor` is reserved for the instructors (`.github/instructors.json`). The classifier refuses it as the commit scope, with an explanation, when the GitHub account is not on that list. **Do not work around it**: never pass `--actor`, never edit the list, never write the label by hand. Stop, tell the user which label you would use instead (their team's, or `platform`; for changes under `course/` from another team, also a line `Cross-team: <why>` in the issue) and continue with that.

## 3. Write the message

- **Subject:** `type(scope): description`. The description is in the imperative mood ("add login page", not "added" or "adding"), starts lowercase, is at most 72 characters in total and has no trailing period.
- **Body:** one to three sentences on *why*, not what (the diff shows what). Only facts from the issue, the code and the conversation.
- **Issue:** the number is in the branch name (`<label>/<number>-<slug>`). Put `Refs #<number>` on its own line, or `Closes #<number>` if this commit completes the issue. If the branch has no issue number, ask the user; do not invent one.
- Write in English.

## 4. Check, then commit

Write the message to a scratch file (not into the repo), then:

```bash
pnpm check:commit --file <message-file>
git commit -F <message-file>
```

Fix every reported problem and re-run. After three failed rounds, stop and show the user the remaining messages. Never use `--no-verify`, never amend or rewrite commits that are already pushed, and never push unless the user asks.
