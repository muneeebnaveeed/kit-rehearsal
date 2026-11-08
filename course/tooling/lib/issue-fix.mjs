// The fixes behind `node course/tooling/issue-report.mjs --fix`: brings an issue in line with the naming
// and labelling rules where the team is unambiguous, and leaves the rest to the author in a comment.
//
// Fixed here: a missing team label, when the title prefix names a team (also a malformed one such as
// "[team : 4]" or "[Team 4]"), and a missing or malformed "[<team-label>]" prefix, when the label names
// the team. A title prefix that names another team than the label is not fixed: which one is right is
// for the author to say.
//
// Pure (no GitHub), so every fix is unit-tested.
import { auditIssue } from "./issue-report.mjs";

export const ISSUE_COMMENT_MARKER = "<!-- issue-report:fix -->";

/**
 * Reads a team from a title prefix, also from the malformed ones people type: "[team : 4]", "[Team 4]",
 * "[team4]", "[TEAM-4]", "[Platform]".
 * @param {string} title
 * @param {string[]} teamLabels
 * @returns {{ team: string | null, prefix: string | null }} prefix is the raw "[...]" text, if any
 */
export function prefixTeam(title, teamLabels) {
  const m = /^\s*\[([^\]]*)\]/.exec(title);
  if (!m) return { team: null, prefix: null };
  const raw = m[1].trim().toLowerCase();
  const number = /^team\s*[-:_ ]?\s*:?\s*([1-4])$/.exec(raw)?.[1];
  const candidate = number ? `team-${number}` : raw.replace(/\s+/g, "-");
  return { team: teamLabels.includes(candidate) ? candidate : null, prefix: m[0] };
}

/**
 * Plans the fixes for one issue.
 * @param {{
 *   issue: { number: number, title: string, url?: string, state: string, author: string, labels: string[] },
 *   config: { teamLabels: string[], types: Record<string, { githubLabel: string | null }> },
 *   hadComment?: boolean,
 * }} input hadComment: this tool already left a comment, which a passing open issue gets updated to "nothing left"
 */
export function planIssueFix({ issue, config, hadComment = false }) {
  const before = auditIssue({ issue, config });
  /** @type {string[]} */
  const fixed = [];
  const labelTeams = issue.labels.filter((l) => config.teamLabels.includes(l));
  const { team: titleTeam, prefix } = prefixTeam(issue.title, config.teamLabels);

  // Labels: add the team the title names, when the issue has no team label.
  const addLabels = labelTeams.length === 0 && titleTeam ? [titleTeam] : [];
  if (addLabels.length) fixed.push(`added the \`${titleTeam}\` label`);

  // Title: "[team-label] Summary", from the one team label.
  const team = labelTeams.length === 1 ? labelTeams[0] : (addLabels[0] ?? null);
  let title = issue.title;
  if (team && (titleTeam === null || titleTeam === team)) {
    const rest = (prefix ? issue.title.trim().slice(prefix.length) : issue.title.trim()).trim();
    const wanted = `[${team}] ${rest}`;
    if (rest && wanted !== issue.title) title = wanted;
  }
  if (title !== issue.title) fixed.push(`fixed the title: \`${title}\``);

  const after = { ...issue, title, labels: [...issue.labels, ...addLabels] };
  const remaining = auditIssue({ issue: after, config });
  const changes = {
    ...(title !== issue.title ? { title } : {}),
    ...(addLabels.length ? { addLabels } : {}),
  };
  return {
    number: issue.number,
    state: issue.state,
    team: remaining.team ?? before.team,
    changes,
    fixed,
    remaining: remaining.problems,
    // Only open issues get a comment: on a closed issue nobody acts on it.
    comment:
      issue.state !== "OPEN" || (fixed.length === 0 && remaining.ok && !hadComment)
        ? null
        : issueCommentFor(fixed, remaining.problems),
  };
}

/**
 * The comment left on the issue: what was fixed, and what only the author can fix.
 * @param {string[]} fixed
 * @param {{ rule: string, message: string }[]} remaining
 */
export function issueCommentFor(fixed, remaining) {
  const lines = [
    ISSUE_COMMENT_MARKER,
    "**Issue label and title check** (see `course/README.md`, *Checking issue labels and titles*)",
    "",
  ];
  if (fixed.length) lines.push("Fixed automatically:", ...fixed.map((f) => `- ${f}`), "");
  if (remaining.length) {
    lines.push(
      "Still to do by the author (the evaluation uses the label to credit the right team):",
      ...remaining.map((p) => `- [ ] **${p.rule}:** ${p.message}`),
    );
  } else {
    lines.push("The issue now follows the rules. Nothing left to do.");
  }
  lines.push("", "Rerun the check with `node course/tooling/issue-report.mjs --failing`.");
  return `${lines.join("\n")}\n`;
}
