// The rules behind `node course/tooling/pr-report.mjs`: is a pull request documented well enough for the evaluation?
// Pure (no GitHub, no file system), so every rule is unit-tested. The template rules come from
// `pnpm check:pr`; this file adds what check:pr cannot see from the PR alone: the linked issue's team
// label and the issue references in the commits.
import { checkPr } from "../../../tooling/workflow/lib/check-pr.mjs";
import { fieldsOf } from "../../../tooling/workflow/lib/template.mjs";

// The automatic rules that check the same thing as a checklist item. An "Exception:" under the item
// covers them too: the author explained why that rule could not be met.
const ITEM_RULES = [
  { item: /reference the issue|Refs #N/i, rules: ["commit-refs"] },
  { item: /\btitle\b/i, rules: ["title"] },
  { item: /branch is named/i, rules: ["branch"] },
  // Only "The base branch is correct": "up to date with its base branch" says nothing about the base.
  { item: /base branch is correct/i, rules: ["base"] },
  { item: /same team label/i, rules: ["labels", "issue-label"] },
];

/**
 * Unticked checklist items, and those with an "Exception: <why>" note right under them. Excepted items
 * are accepted: the template asks authors to explain an item they can't tick instead of ticking it anyway.
 * @param {string | null} body
 * @returns {{ open: number, excepted: string[], exceptedRules: Set<string> }} excepted: the items' texts
 */
export function uncheckedItems(body) {
  const section = fieldsOf(body ?? "").find((s) => s.heading.trim().toLowerCase() === "checklist");
  /** @type {string[]} */
  const excepted = [];
  let open = 0;
  if (section) {
    const lines = section.body.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!/^\s*-\s*\[ \]/.test(line)) return;
      const next = lines.slice(i + 1).find((l) => l.trim() !== "") ?? "";
      if (/^\s*(?:[-*>]\s*)?\**Exception\**:\s*\S/i.test(next) && !/^\s*-\s*\[[ xX]\]/.test(next))
        excepted.push(line.replace(/^\s*-\s*\[ \]\s*/, "").trim());
      else open++;
    });
  }
  const exceptedRules = new Set(
    excepted.flatMap((text) => ITEM_RULES.filter((m) => m.item.test(text)).flatMap((m) => m.rules)),
  );
  return { open, excepted, exceptedRules };
}

const CLOSING = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/i;
const ANY_REFERENCE = /\b(?:refs|close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/i;
// Messages git or a tool generates (same list as check:commit).
const EXEMPT_COMMIT = /^(?:Merge |Revert "|fixup! |squash! |amend! )/;

/**
 * The issue a PR body links. Work PRs must close it; sync PRs (head `main`) and promotions may use "Refs".
 * @param {string | null | undefined} body
 * @param {{ allowRefs?: boolean }} [opts]
 * @returns {number | null}
 */
export function linkedIssue(body, opts = {}) {
  const m = (opts.allowRefs ? ANY_REFERENCE : CLOSING).exec(body ?? "");
  return m ? Number(m[1]) : null;
}

/**
 * Which team a PR belongs to in the report: its team label, else the scope of its title
 * (`feat(team-2): …`), else the branch prefix.
 * @param {{ title: string, head: string, labels: string[] }} pr
 * @param {string[]} teamLabels
 */
export function teamOf(pr, teamLabels) {
  const fromLabels = pr.labels.filter((l) => teamLabels.includes(l));
  if (fromLabels.length === 1) return fromLabels[0];
  const title = /^[a-z]+\(([^)]+)\)!?:/.exec(pr.title.trim())?.[1];
  if (title && teamLabels.includes(title)) return title;
  const branch = pr.head.split("/")[0];
  if (teamLabels.includes(branch)) return branch;
  const feature = /^feature\/(team-[1-4])$/.exec(pr.head)?.[1];
  if (feature && teamLabels.includes(feature)) return feature;
  return null;
}

/**
 * Audits one pull request.
 * @param {{
 *   pr: { number: number, title: string, body: string | null, head: string, base: string, labels: string[], state: string, author: string, url?: string },
 *   commits: { oid?: string, message: string }[],
 *   commitsTruncated?: boolean,
 *   issue: { number: number, labels: string[] } | null,
 *   config: { teamLabels: string[] },
 *   templates: Record<string, string>,
 *   judgedElsewhere?: Set<string>,
 * }} input `issue` is the linked issue as GitHub returned it (null if the PR links none or it does not exist).
 *   `judgedElsewhere`: oids of commits that are already part of an earlier merged PR; a work PR that
 *   brings in `main` carries them, and they were judged in their own PR.
 */
export function auditPr({
  pr,
  commits,
  commitsTruncated = false,
  issue,
  config,
  templates,
  judgedElsewhere = new Set(),
}) {
  const template = checkPr({
    title: pr.title,
    body: pr.body,
    head: pr.head,
    base: pr.base,
    labels: pr.labels,
    config,
    templates,
  });
  /** @type {{ rule: string, message: string }[]} */
  const problems = [];
  /** @type {{ rule: string, message: string }[]} */
  const accepted = [];
  /** @type {string[]} */
  const warnings = [...template.warnings];
  // Unticked checklist items with an "Exception:" note are accepted, and so are the rules they cover.
  const { open, excepted, exceptedRules } = uncheckedItems(pr.body);
  const add = (rule, message) => {
    const p = { rule, message };
    if (exceptedRules.has(rule)) accepted.push(p);
    else problems.push(p);
  };
  for (const p of template.problems) {
    if (p.rule === "checklist" && /not ticked/.test(p.message)) {
      if (open > 0)
        add(
          p.rule,
          `${open} checklist item(s) are not ticked. Tick them, fix what they check, or explain why under the item with "Exception: ...".`,
        );
      continue;
    }
    add(p.rule, "fix" in p && p.fix ? `${p.message} ${p.fix}` : p.message);
  }
  if (excepted.length > 0)
    warnings.push(
      `Accepted with an "Exception:" note: ${excepted.map((t) => `"${t.slice(0, 60)}"`).join(", ")}.`,
    );

  // A work branch carries the commits of one issue. Integration PRs (feature/team-N into main) and
  // sync PRs (from main) carry many issues' commits, so only work PRs are checked here.
  const isWorkPr = pr.head !== "main" && !/^feature\/team-[1-4]$/.test(pr.head);
  const number = linkedIssue(pr.body, { allowRefs: !isWorkPr });

  if (isWorkPr && number !== null) {
    const prTeam = pr.labels.filter((l) => config.teamLabels.includes(l));
    if (!issue) {
      add("issue", `The linked issue #${number} does not exist.`);
    } else {
      const issueTeam = issue.labels.filter((l) => config.teamLabels.includes(l));
      if (issueTeam.length !== 1) {
        add(
          "issue-label",
          `The linked issue #${number} needs exactly one team label; it has ${issueTeam.length}${issueTeam.length ? ` (${issueTeam.join(", ")})` : ""}.`,
        );
      } else if (prTeam.length === 1 && prTeam[0] !== issueTeam[0]) {
        add(
          "issue-label",
          `The PR is labelled ${prTeam[0]} but the linked issue #${number} is labelled ${issueTeam[0]}.`,
        );
      }
    }

    const ref = new RegExp(`^\\s*(?:Refs|Closes|Fixes|Resolves)\\s+#${number}\\b`, "im");
    // Commits from an earlier merged PR were judged there.
    const fromElsewhere = commits.filter((c) => c.oid && judgedElsewhere.has(c.oid));
    const own = commits.filter((c) => !fromElsewhere.includes(c));
    const checked = own.filter((c) => !EXEMPT_COMMIT.test(c.message));
    const missing = checked.filter((c) => !ref.test(c.message));
    if (fromElsewhere.length > 0)
      warnings.push(
        `${fromElsewhere.length} commit(s) already belong to an earlier merged PR and are not checked here.`,
      );
    if (missing.length > 0)
      add(
        "commit-refs",
        `${missing.length} of ${checked.length} commit(s) do not reference the issue with "Refs #${number}": ${missing
          .slice(0, 3)
          .map((c) => `"${c.message.split("\n")[0].slice(0, 60)}"`)
          .join(", ")}${missing.length > 3 ? ", ..." : ""}.`,
      );
    if (commitsTruncated)
      warnings.push("The PR has more commits than were read; only the first ones were checked.");
  }

  return {
    number: pr.number,
    title: pr.title,
    url: pr.url ?? null,
    state: pr.state,
    author: pr.author,
    head: pr.head,
    base: pr.base,
    team: teamOf(pr, config.teamLabels),
    type: template.type,
    linkedIssue: number,
    ok: problems.length === 0,
    problems,
    accepted,
    excepted,
    warnings,
  };
}

/**
 * Groups audit results per team, in the order of `teamLabels`, with PRs that belong to no team last.
 * @param {ReturnType<typeof auditPr>[]} results
 * @param {string[]} teamLabels
 */
export function groupByTeam(results, teamLabels) {
  const order = [...teamLabels, null];
  return order
    .map((team) => {
      const prs = results.filter((r) => r.team === team).sort((a, b) => b.number - a.number);
      const failing = prs.filter((r) => !r.ok);
      const passing = prs.filter((r) => r.ok);
      return {
        team,
        total: prs.length,
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
    "# Pull request documentation report",
    "",
    `Repository \`${meta.repo}\`, ${meta.state} pull requests, generated ${meta.generatedAt}.`,
    `${total - failing} of ${plural(total, "pull request")} pass. The rules are the ones in CLAUDE.md and the PR templates (see course/README.md).`,
    "",
    "| Team | PRs | Pass | Fail |",
    "|------|----:|-----:|-----:|",
    ...groups.map((g) => `| ${g.team ?? "(no team)"} | ${g.total} | ${g.passCount} | ${g.failCount} |`),
  ];
  for (const g of groups) {
    lines.push("", `## ${g.team ?? "(no team)"}`, "");
    if (g.failing.length === 0) {
      lines.push(g.total === 1 ? "The pull request passes." : `All ${g.total} pull requests pass.`);
    }
    for (const r of g.failing) {
      const link = r.url ? `[#${r.number}](${r.url})` : `#${r.number}`;
      lines.push(`- ${link} ${r.title} (${r.state.toLowerCase()}, ${r.author})`);
      for (const p of r.problems) lines.push(`  - **${p.rule}:** ${p.message}`);
      for (const w of r.warnings) lines.push(`  - *warning:* ${w}`);
    }
    if (!meta.failingOnly && g.passing.length > 0)
      lines.push("", `Passing: ${g.passing.map((r) => `#${r.number}`).join(", ")}`);
    // Failing PRs already show their exceptions as warnings; passing ones would otherwise hide them.
    const withExceptions = g.passing.filter((r) => r.excepted?.length);
    if (!meta.failingOnly && withExceptions.length > 0) {
      lines.push("", 'Passing with an "Exception:" note (check the reason):');
      for (const r of withExceptions.sort((a, b) => b.number - a.number)) {
        const rules = [...new Set((r.accepted ?? []).map((p) => p.rule))];
        const items = r.excepted.map((t) => `"${t.slice(0, 60)}"`).join(", ");
        lines.push(`- #${r.number}: ${items}${rules.length ? ` (accepts ${rules.join(", ")})` : ""}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}
