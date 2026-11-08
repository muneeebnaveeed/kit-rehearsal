---
name: address-review
description: Work through the review comments on a pull request. Use when the user asks to address, answer, fix or go through review comments or feedback on a PR, or when a reviewer requested changes. The script collects the comments, you fix or answer each one, and the reviewer decides.
---

# Address review comments

The rule: **the script collects, you answer every point, the reviewer decides.** Never resolve a thread yourself; the reviewer does that.

1. Run from the repo root, on the PR's branch:

   ```bash
   pnpm pr:comments
   ```

   Pass `--pr <n>` for another PR. Exit code 0 means no thread is waiting on the author: check the reviews and discussion it printed, then stop.
2. For each thread marked "waiting on author", and each point in a review, decide with the user: fix it, or explain why not. Ask when a comment is unclear or two comments disagree.
3. Make the fixes, run `pnpm preflight`, commit with the `write-commit` skill, and push.
4. Reply in each thread (its link is under it) with what changed and in which commit, or why it stays as it is. Show the user the replies before you post them.
5. Run `pnpm pr:comments` again: every thread you answered should no longer be waiting on the author.
