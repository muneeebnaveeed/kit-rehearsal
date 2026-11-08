<!--
Title: "fix(<team-label>): subject" (Conventional Commits): lowercase, imperative, at most 72 characters, no period. Example: "fix(team-2): keep score after reconnect".
Add the same team label to the PR as to its issue. Fill in every field and keep the labels as they are:
`pnpm check:pr` and the evaluation read them. Write "None" when a field does not apply.
-->
**Linked issue**: Closes #
**Team**: <!-- team-1, team-2, team-3, team-4, platform or team-instructor -->
**Summary**: <!-- why it matters: what was broken for players or teams, and what works now, in 2 or 3 sentences. Not a list of what changed -->
**Root cause**: <!-- why it broke: the wrong assumption or missed case behind the bug, not the lines you changed -->
**How to test**: <!-- steps a reviewer can follow to see it working -->
**Screenshots**: <!-- of visible changes, or None -->
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
