<!--
Title: chore(platform): bring feature/team-N up to date with main
A sync PR has `main` as its head branch and uses `Refs #N`, because one issue can cover several syncs.
Usually opened by `pnpm branches:sync`. Fill in every field and keep the labels as they are.
-->
**Linked issue**: Refs #
**Team**: platform
**Summary**: <!-- why now: which branch falls behind main, by how much, and whether merging conflicts -->
**Included changes**: <!-- the pull requests that arrive with this merge -->
**How to test**: <!-- steps a reviewer can follow to see it working -->
**Screenshots**: <!-- of visible changes, or None -->
**Checklist**:
- [ ] The PR refers to an issue with `Refs #N`, and that issue has a team label
- [ ] This PR has the same team label as the issue
- [ ] The title follows Conventional Commits with the team label as the scope: `type(<team-label>): subject`
- [ ] The head branch is `main` and the base branch is `feature/team-N`
- [ ] The merge adds no new commits of its own, or the conflicts that were resolved are listed in the summary
- [ ] No secrets, credentials, build output or large binaries are committed
- [ ] The branch is up to date with its base branch
- [ ] I tested the change as described under "How to test"
