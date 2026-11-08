// The rules behind `node course/tooling/issue-report.mjs`: does an issue follow the naming and labelling
// rules, so the evaluation can attribute it to the right team? Pure (no GitHub, no file system), so every
// rule is unit-tested. The rules themselves are the ones of `pnpm check:issue`: this file only picks the
// title and label rules out of it, because issues that predate the templates have no template to check.
import { checkIssue } from "../../../tooling/workflow/lib/check-issue.mjs";

/** The rules of check:issue that this report enforces. */
const RULES = new Set(["title", "labels"]);

/**
 * The team an issue belongs to: its team label if it has exactly one, otherwise the label in its
 * `[<team-label>]` title prefix, otherwise none.
 * @param {{ title: string, labels: string[] }} issue
 * @param {string[]} teamLabels
 */
export function teamOf(issue, teamLabels) {
  const labels = issue.labels.filter((l) => teamLabels.includes(l));
  if (labels.length === 1) return labels[0];
  const prefix = /^\[([^\]]+)\]/.exec(issue.title.trim())?.[1];
  return prefix && teamLabels.includes(prefix) ? prefix : null;
}

/**
 * @param {{
 *   issue: { number: number, title: string, url?: string, state: string, author: string, labels: string[] },
 *   config: { teamLabels: string[], types: Record<string, { githubLabel: string | null }> },
 * }} input
 */
export function auditIssue({ issue, config }) {
  // With no templates, checkIssue still reports the title and label rules before it gives up on the body.
  const { problems } = checkIssue({
    title: issue.title,
    body: "",
    labels: issue.labels,
    config,
    templates: {},
  });
  const found = problems.filter((p) => RULES.has(p.rule));
  return {
    number: issue.number,
    title: issue.title,
    url: issue.url ?? null,
    state: issue.state,
    author: issue.author,
    labels: issue.labels,
    team: teamOf(issue, config.teamLabels),
    ok: found.length === 0,
    problems: found,
  };
}

/**
 * Groups audit results per team, in the order of `teamLabels`, with issues that belong to no team last.
 * @param {ReturnType<typeof auditIssue>[]} results
 * @param {string[]} teamLabels
 */
export function groupByTeam(results, teamLabels) {
  return [...teamLabels, null]
    .map((team) => {
      const issues = results.filter((r) => r.team === team).sort((a, b) => b.number - a.number);
      const failing = issues.filter((r) => !r.ok);
      const passing = issues.filter((r) => r.ok);
      return {
        team,
        total: issues.length,
        passCount: passing.length,
        failCount: failing.length,
        failing,
        passing,
      };
    })
    .filter((g) => g.total > 0);
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Renders the report as Markdown, ready to paste into an issue or hand to an AI evaluator.
 * @param {ReturnType<typeof groupByTeam>} groups
 * @param {{ repo: string, state: string, generatedAt: string, failingOnly?: boolean }} meta
 */
export function formatReport(groups, meta) {
  const total = groups.reduce((n, g) => n + g.total, 0);
  const failing = groups.reduce((n, g) => n + g.failCount, 0);
  const lines = [
    "# Issue labels and titles report",
    "",
    `Repository \`${meta.repo}\`, ${meta.state} issues, generated ${meta.generatedAt}.`,
    `${total - failing} of ${plural(total, "issue")} pass. The rules are in CLAUDE.md, "Issue first" (see course/README.md).`,
    "",
    "| Team | Issues | Pass | Fail |",
    "|------|-------:|-----:|-----:|",
    ...groups.map((g) => `| ${g.team ?? "(no team)"} | ${g.total} | ${g.passCount} | ${g.failCount} |`),
  ];
  for (const g of groups) {
    lines.push("", `## ${g.team ?? "(no team)"}`, "");
    if (g.failing.length === 0) {
      lines.push(g.total === 1 ? "The issue passes." : `All ${g.total} issues pass.`);
      continue;
    }
    for (const r of g.failing) {
      const link = r.url ? `[#${r.number}](${r.url})` : `#${r.number}`;
      lines.push(
        `- ${link} ${r.title} (${r.state.toLowerCase()}, ${r.author}, labels: ${r.labels.join(", ") || "none"})`,
      );
      for (const p of r.problems) lines.push(`  - **${p.rule}:** ${p.message}`);
    }
    if (!meta.failingOnly && g.passing.length > 0)
      lines.push("", `Passing: ${g.passing.map((r) => `#${r.number}`).join(", ")}`);
  }
  return `${lines.join("\n")}\n`;
}
