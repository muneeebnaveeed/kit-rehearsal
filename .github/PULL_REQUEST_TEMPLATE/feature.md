<!--
Title: "feat(<team-label>): subject" (Conventional Commits): lowercase, imperative, at most 72 characters, no period. Example: "feat(team-2): add login page".
Add the same team label to the PR as to its issue. Fill in every field and keep the labels as they are:
`pnpm check:pr` and the evaluation read them. Write "None" when a field does not apply; Screenshots also says why: "None, <reason>".
-->
**Linked issue**: Closes #
**Team**: <!-- team-1, team-2, team-3, team-4, platform or team-instructor -->
**Summary**: <!-- why this change exists: the problem or goal, and what players or teams get from it, in 2 or 3 sentences. Not a list of what changed: the diff shows that -->
**How to test**: <!-- steps a reviewer can follow to see it working -->
**Screenshots**: <!-- an image of visible changes, or "None, <why there is nothing to show>" -->
**Checklist**:
- [ ] The PR closes an issue with `Closes #N`, and that issue has a team label
- [ ] This PR has the same team label as the issue
- [ ] The title follows Conventional Commits with the team label as the scope: `type(<team-label>): subject`
- [ ] The branch is named `<team-label>/<issue-number>-<short-description>`
- [ ] Changes only touch my own team's folder (see CLAUDE.md), or the issue explains why not
- [ ] Commits follow Conventional Commits and reference the issue (`Refs #N`)
- [ ] No secrets, credentials, build output or large binaries are committed
- [ ] The base branch is correct: `feature/team-N` for a work branch, `main` for a feature branch and for platform and instructor work
- [ ] The branch is up to date with its base branch
- [ ] I tested the change as described under "How to test"
