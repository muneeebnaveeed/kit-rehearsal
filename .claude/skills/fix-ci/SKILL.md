---
name: fix-ci
description: Find out why a pull request's checks are failing and fix it. Use when the user says CI, a check or a workflow is red or failing on a PR, or asks why a PR is blocked by checks. The script downloads the failing logs, you fix the cause, and preflight decides.
---

# Fix failing checks

The rule: **the script reads the logs, you fix the cause, preflight decides.** Never guess from the check name, and never push a fix that `pnpm preflight` rejects.

1. Run from the repo root, on the PR's branch:

   ```bash
   pnpm pr:ci-logs
   ```

   Pass `--pr <n>` for another PR. Exit code 0 means nothing is failing: say so and stop.
2. Read the printed summary. For each failed step it shows the command CI ran and its output up to the error. The full logs are in the folder it names, if the summary is not enough.
3. Reproduce locally with the same command (most are a `pnpm` script, such as `pnpm check:pr --number <n>` or `pnpm test`), fix the cause, and run it again until it passes.
4. Some failures are fixed on GitHub, not in code: a missing team label, the PR title, a closed issue, an empty template field. Edit the PR description or labels as the message says, using the `fill-pr` skill for the description.
5. Run `pnpm preflight`, commit with the `write-commit` skill, and push. Then run `pnpm pr:ci-logs` again once the checks have finished.
