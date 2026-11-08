---
name: fill-issue
description: Create a GitHub issue for this repository that follows its template. Use when the user asks to open, file, write or create an issue, or when work is about to start without one ("issue first"). The classifier script chooses the template and label, you fill it in, and check:issue validates it.
---

# Fill an issue

The rule: **the script chooses, you fill, the check decides.** Never pick the issue type, template or team label yourself, and never create an issue that `pnpm check:issue` rejects.

## 1. Classify

Run from the repo root:

```bash
pnpm workflow:classify --kind issue --json
```

- It looks at the uncommitted changes. Use `--staged` for staged changes, or `--base <ref>` for the commits of a branch. If there are no changes yet, pass what you know: `--title "fix: <summary>"` or `--type <feature|bug|docs|chore|refactor>`.
- It returns `type`, `label` (the team label) and `template`.
- **Exit code 1 means it could not decide** (`undecided: true`, with `candidates`). Ask the user which type it is, then re-run with `--type <their answer>`. Do not guess.
- If it reports several owners for the changed files, tell the user the change must be split (one issue, one team label), or pass `--label` if the user names the owner.

## The team-instructor label

`team-instructor` is reserved for the instructors (`.github/instructors.json`). The classifier refuses it, with an explanation, when the GitHub account is not on that list. **Do not work around it**: never pass `--actor`, never edit the list, never write the label by hand. Stop, tell the user which label you would use instead (their team's, or `platform`; for changes under `course/` from another team, also a line `Cross-team: <why>` in the issue) and continue with that.

## 2. Fill the template

Read the file named in `template`. Write the issue body to a scratch file (not into the repo) that keeps **every `##` heading, in order, with the exact same text**. Remove the HTML comments.

- **Title:** `[<label>] <short imperative summary>`, for example `[platform] Add the CI workflow`.
- **Goal:** what should be true afterwards and why. **What changes:** a short list of concrete changes.
- **Done when:** checkboxes someone else can verify (`- [ ] ...`), at least one.
- Type-specific sections (steps to reproduce, pages affected, why now, behaviour that must not change) are required too.
- Use only facts from the user, the code or the diff. If a section does not apply, write `None`. Never invent steps, versions or results.
- Write in English.

## 3. Check

```bash
pnpm check:issue --file <body-file> --title "<title>" --labels <label> --type <type>
```

Fix every reported problem and re-run. After three failed rounds, stop and show the user the remaining messages.

## 4. Create

```bash
gh issue create --title "<title>" --body-file <body-file> --label <label>
```

Add only the team label from step 1; the repo has no type labels (see "Labels" in CLAUDE.md). Report the issue URL. Do not assign anyone or add labels beyond those unless the user asks.
