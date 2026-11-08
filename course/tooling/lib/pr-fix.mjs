// The fixes behind `node course/tooling/pr-report.mjs --fix`: brings a pull request in line with the rules
// where that can be done mechanically, without inventing anything the author has to say.
//
// Fixed here: the team label, the title (see fixTitle), the template fields (existing text is kept
// and moved into the right field), the "Closes #N" link (from the branch name), the Team field,
// missing checklist items (added unticked) and the base branch of open PRs. Bodies written with "## "
// headings are read too, and rewritten as "**Label**: value" fields.
// Never done here: ticking checklist items, writing a summary, test steps or screenshots, or changing
// commits. Those are left to the author and listed in a comment.
//
// Pure (no GitHub), so every fix is unit-tested.
import { COMMIT_TYPES } from "../../../tooling/workflow/lib/check-commit.mjs";
import { renderField } from "../../../tooling/workflow/lib/pr-body.mjs";
import { baseFor } from "../../../tooling/workflow/lib/rules.mjs";
import { fieldLabelsOf, stripComments } from "../../../tooling/workflow/lib/template.mjs";
import { auditPr, linkedIssue } from "./pr-report.mjs";

export const COMMENT_MARKER = "<!-- pr-report:fix -->";
const normalize = (s) => s.trim().toLowerCase();
const STRUCTURE_RULES = new Set(["heading", "order", "template"]);
const WORK_BRANCH = /^(?:team-[1-4]|platform|team-instructor)\/\d+-/;
const FOOTER = /^🤖 Generated with .*$/m;
// Headings authors use instead of the template's fields, mapped to the field they stand for.
const ALIASES = {
  summary: /^(?:summary|description|what(?: changed)?|changes|overview|about)$/i,
  "how to test": /^(?:test plan|testing|tests?|how to test(?: it)?|verification|how i tested)$/i,
  screenshots: /^(?:screenshots?|screen ?shots?|demo|preview)$/i,
};
const PLACEHOLDER = "<!-- To be filled in by the author. -->";

/** A "## Heading" line or a "**Label**: value" field line. */
const START = /^(?:##\s+(.+?)\s*$|\*\*(.+?)\*\*:\s?(.*)$)/;

/**
 * Splits a body into the text before the first heading or field and its raw sections (comments kept).
 * @param {string} body
 */
export function rawSections(body) {
  const preamble = [];
  /** @type {{ heading: string, lines: string[] }[]} */
  const sections = [];
  let inFence = false;
  let inComment = false;
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    if (!inComment && /^\s*```/.test(line)) inFence = !inFence;
    const m = !inFence && !inComment && START.exec(line);
    if (m) sections.push({ heading: m[1] ?? m[2], lines: m[2] && m[3] ? [m[3]] : [] });
    else (sections.at(-1)?.lines ?? preamble).push(line);
    const opens = line.lastIndexOf("<!--");
    const closes = line.lastIndexOf("-->");
    if (opens > closes) inComment = true;
    else if (closes > opens) inComment = false;
  }
  return {
    preamble: preamble.join("\n").trim(),
    sections: sections.map((s) => ({ heading: s.heading, text: s.lines.join("\n").trim() })),
  };
}

const checklistItems = (text) =>
  stripComments(text)
    .split("\n")
    .filter((l) => /^\s*-\s*\[[ xX]\]/.test(l));
const itemText = (line) => normalize(line.replace(/^\s*-\s*\[[ xX]\]\s*/, "").replace(/[`*]/g, ""));

/**
 * Plans the fixes for one PR.
 * @param {{
 *   pr: { number: number, title: string, body: string | null, head: string, base: string, labels: string[], state: string, author: string, url?: string },
 *   commits: { message: string }[],
 *   issues: Map<number, { number: number, labels: string[] }>,
 *   config: { teamLabels: string[] },
 *   templates: Record<string, string>,
 *   hadComment?: boolean,
 *   judgedElsewhere?: Set<string>,
 * }} input hadComment: this tool already left a comment, which a passing open PR gets updated to "nothing left".
 *   judgedElsewhere: see auditPr.
 */
export function planFix({ pr, commits, issues, config, templates, hadComment = false, judgedElsewhere }) {
  const before = auditPr({ pr, commits, issue: issueFor(pr, issues), config, templates, judgedElsewhere });
  /** @type {string[]} */
  const fixed = [];
  const fromMain = pr.head === "main";

  // The issue: the one the body links, else the number in the branch name (work branches only).
  let number = linkedIssue(pr.body, { allowRefs: fromMain });
  if (number === null && !fromMain) {
    const fromBranch = /^[^/]+\/(\d+)-/.exec(pr.head)?.[1];
    if (fromBranch && issues.has(Number(fromBranch))) number = Number(fromBranch);
  }
  const issueTeam = number !== null ? teamLabelOf(issues.get(number)?.labels ?? [], config) : null;
  const team = before.team ?? issueTeam;

  // Labels: add the team label when the PR has none.
  const prTeams = pr.labels.filter((l) => config.teamLabels.includes(l));
  const addLabels = prTeams.length === 0 && team ? [team] : [];
  if (addLabels.length) fixed.push(`added the \`${team}\` label`);

  // Title: see fixTitle.
  const title = fixTitle({ pr, team, commits }) ?? pr.title;
  if (title !== pr.title) fixed.push(`fixed the title: \`${title}\``);

  // Body: template headings, linked issue, team, checklist.
  const body = fixBody({ pr, before, team, number, fromMain, templates, fixed });

  // Base branch: only open PRs can be retargeted. A PR stacked on another work branch waits for it.
  let base = pr.base;
  if (pr.state === "OPEN" && !fromMain && !WORK_BRANCH.test(pr.base)) {
    const expected = baseFor(pr.head, config.teamLabels);
    if (expected && expected !== pr.base) {
      base = expected;
      fixed.push(`changed the base branch from \`${pr.base}\` to \`${expected}\``);
    }
  }

  const after = { ...pr, title, body, base, labels: [...pr.labels, ...addLabels] };
  const remaining = auditPr({
    pr: after,
    commits,
    issue: issueFor(after, issues),
    config,
    templates,
    judgedElsewhere,
  });
  const notes = [];
  if (pr.state === "OPEN" && WORK_BRANCH.test(pr.base) && remaining.problems.some((p) => p.rule === "base"))
    notes.push(
      `This PR is stacked on \`${pr.base}\`. Retarget it to \`${baseFor(pr.head, config.teamLabels)}\` once that branch is merged.`,
    );

  const changes = {
    ...(title !== pr.title ? { title } : {}),
    ...(sameText(body, pr.body) ? {} : { body }),
    ...(addLabels.length ? { addLabels } : {}),
    ...(base !== pr.base ? { base } : {}),
  };
  return {
    number: pr.number,
    state: pr.state,
    team,
    changes,
    fixed,
    remaining: remaining.problems,
    // Only open PRs get a comment: on a merged or closed PR the author can't change anything.
    comment:
      pr.state !== "OPEN" || (fixed.length === 0 && remaining.ok && notes.length === 0 && !hadComment)
        ? null
        : commentFor(pr, fixed, remaining.problems, notes),
  };
}

/** GitHub may store a body with CRLF line endings; that alone is not a change. */
const sameText = (a, b) =>
  (a ?? "").replace(/\r\n/g, "\n").trimEnd() === (b ?? "").replace(/\r\n/g, "\n").trimEnd();

const CONVENTIONAL_TITLE = /^([a-z]+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/;

/**
 * The fixed title, or null when it can't be fixed without guessing.
 * - A Conventional title keeps its type and subject; only a missing or wrong scope becomes the team label.
 * - Any other title becomes Conventional, with the type the PR's own commits use, and only when they all
 *   agree on one.
 * @param {{ pr: { title: string }, team: string | null, commits: { message: string }[] }} input
 */
export function fixTitle({ pr, team, commits }) {
  if (!team) return null;
  const title = pr.title.trim();
  const conventional = CONVENTIONAL_TITLE.exec(title);
  if (conventional && COMMIT_TYPES.includes(conventional[1])) {
    const [, type, scope, bang = "", subject] = conventional;
    if (scope === team) return null;
    return `${type}(${team})${bang}: ${subject}`;
  }
  const rest = title.replace(/^\[[^\]]*\]\s*/, "").replace(/^[a-z]+(?:\([^)]*\))?!?:\s*/i, "");
  if (!rest) return null;
  const types = new Set(
    commits
      .map((c) => CONVENTIONAL_TITLE.exec(c.message.split("\n")[0])?.[1])
      .filter((t) => t && COMMIT_TYPES.includes(t)),
  );
  if (types.size !== 1) return null;
  return `${[...types][0]}(${team}): ${rest.charAt(0).toLowerCase()}${rest.slice(1).replace(/\.$/, "")}`;
}

function teamLabelOf(labels, config) {
  const teams = labels.filter((l) => config.teamLabels.includes(l));
  return teams.length === 1 ? teams[0] : null;
}

function issueFor(pr, issues) {
  const n = linkedIssue(pr.body, { allowRefs: pr.head === "main" });
  return n === null ? null : (issues.get(n) ?? null);
}

/**
 * Adds a missing Linked issue or Team field (or fills an empty or wrong one) at the top of a merged or
 * closed PR, and leaves the rest of its description as it is.
 */
function fixClosedBody({ original, sections, team, number, fromMain, fixed }) {
  const keyword = fromMain ? "Refs" : "Closes";
  const find = (h) => sections.find((s) => normalize(s.heading) === h);
  let body = original;
  const linked = find("linked issue");
  const hasLink =
    linked &&
    new RegExp(`\\b(?:${keyword}|Closes|Fixes|Resolves)\\s+#\\d+`, "i").test(stripComments(linked.text));
  const teamSection = find("team");
  const teamText = teamSection
    ? stripComments(teamSection.text).trim().split(/\s+/)[0]?.replace(/[`*]/g, "")
    : null;
  const prepend = [];
  if (number !== null && !hasLink) {
    if (linked) body = replaceSection(body, "Linked issue", `${keyword} #${number}`);
    else prepend.push(renderField("Linked issue", `${keyword} #${number}`));
    fixed.push(`linked the issue with \`${keyword} #${number}\``);
  }
  if (team && teamText !== team) {
    if (teamSection) body = replaceSection(body, "Team", team);
    else if (linked) body = insertAfterSection(body, "Linked issue", renderField("Team", team));
    else prepend.push(renderField("Team", team));
    fixed.push(`set the Team field to \`${team}\``);
  }
  return prepend.length ? `${prepend.join("\n")}${gapBefore(body)}${body}` : body;
}

// No blank line between two fields; a "## " heading or plain text keeps one.
const gapBefore = (next) => (/^\*\*(.+?)\*\*:/.test(next) ? "\n" : "\n\n");

/** Where the section of `heading` starts and ends (exclusive) in a raw body's lines, or null. */
function sectionSpan(lines, heading) {
  const isStart = (l) => START.exec(l);
  const at = lines.findIndex((l) => {
    const m = isStart(l);
    return m && normalize(m[1] ?? m[2]) === normalize(heading);
  });
  if (at === -1) return null;
  let end = lines.findIndex((l, i) => i > at && isStart(l));
  if (end === -1) end = lines.length;
  return { at, end };
}

/** Inserts a block right after the section of `heading` in a raw body. */
function insertAfterSection(body, heading, block) {
  const lines = body.split("\n");
  const span = sectionSpan(lines, heading);
  if (!span) return body;
  const before = lines.slice(0, span.end).join("\n").trimEnd();
  const after = lines.slice(span.end).join("\n");
  const lead = START.exec(lines[span.at])?.[2] ? "\n" : "\n\n";
  return `${before}${lead}${block}${gapBefore(after)}${after}`;
}

/** Replaces the section of `heading` in a raw body with a field holding `content`. */
function replaceSection(body, heading, content) {
  const lines = body.split("\n");
  const span = sectionSpan(lines, heading);
  if (!span) return body;
  const after = lines.slice(span.end).join("\n");
  return `${[...lines.slice(0, span.at), renderField(heading, content)].join("\n")}${gapBefore(after)}${after}`;
}

function fixBody({ pr, before, team, number, fromMain, templates, fixed }) {
  const original = (pr.body ?? "").replace(/\r\n/g, "\n");
  const template = templates[before.type] ?? templates.feature;
  const rules = new Set(before.problems.map((p) => p.rule));
  if (
    ![...rules].some((r) => ["heading", "order", "template", "linked-issue", "team", "checklist"].includes(r))
  )
    return pr.body ?? "";

  // Keep the "Generated with" footer at the very end.
  const footer = FOOTER.exec(original)?.[0] ?? null;
  const { preamble, sections } = rawSections(footer ? original.replace(FOOTER, "") : original);

  // Nobody will fill in new sections of a merged or closed PR, so it only gets what the evaluation reads to credit the work: the linked issue and the team.
  if (pr.state !== "OPEN") return fixClosedBody({ original, sections, team, number, fromMain, fixed });

  let list = sections;

  if ([...rules].some((r) => STRUCTURE_RULES.has(r))) {
    const pool = [...sections];
    const take = (heading) => {
      const key = normalize(heading);
      let i = pool.findIndex((s) => normalize(s.heading) === key);
      if (i === -1 && ALIASES[key]) i = pool.findIndex((s) => ALIASES[key].test(s.heading.trim()));
      return i === -1 ? null : pool.splice(i, 1)[0];
    };
    list = fieldLabelsOf(template).map((heading) => {
      const found = take(heading);
      return { heading, text: found?.text ?? "" };
    });
    // Text outside the template's fields goes into the summary, so nothing the author wrote is lost.
    const summary = list.find((s) => normalize(s.heading) === "summary");
    const extra = [preamble, ...pool.map((s) => `### ${s.heading}\n\n${s.text}`)].filter(
      (x) => x.trim() !== "",
    );
    if (summary && extra.length) summary.text = [summary.text, ...extra].filter(Boolean).join("\n\n");
    fixed.push("restructured the description to follow the PR template (no text was removed)");
  }

  for (const s of list) {
    const key = normalize(s.heading);
    if (key === "linked issue" && number !== null) {
      const keyword = fromMain ? "Refs|Closes|Fixes|Resolves" : "Closes|Fixes|Resolves";
      if (!new RegExp(`\\b(?:${keyword})\\s+#\\d+`, "i").test(stripComments(s.text))) {
        // A bare "#N" or "Closes #" placeholder becomes the closing keyword.
        const cleaned = s.text.replace(/^\s*(?:Closes|Refs|Fixes|Resolves)?\s*#\s*$/im, "").trim();
        s.text = [`${fromMain ? "Refs" : "Closes"} #${number}`, cleaned].filter(Boolean).join("\n\n");
        fixed.push(`linked the issue with \`${fromMain ? "Refs" : "Closes"} #${number}\``);
      }
    } else if (key === "team" && team) {
      const first = stripComments(s.text).trim().split(/\s+/)[0]?.replace(/[`*]/g, "") ?? "";
      if (first !== team) {
        s.text = team;
        fixed.push(`set the Team field to \`${team}\``);
      }
    } else if (key === "checklist") {
      const have = checklistItems(s.text);
      const known = new Set(have.map(itemText));
      const missing = checklistItems(template).filter((l) => !known.has(itemText(l)));
      if (have.length < checklistItems(template).length && missing.length) {
        s.text = [s.text, missing.map((l) => l.replace(/\[[xX]\]/, "[ ]")).join("\n")]
          .filter((x) => x.trim() !== "")
          .join("\n");
        fixed.push(`added ${missing.length} missing checklist item(s), unticked`);
      }
    }
    if (s.text.trim() === "") s.text = PLACEHOLDER;
  }

  const out = `${list.map((s) => renderField(s.heading, s.text)).join("\n")}\n`;
  const lead = [...rules].some((r) => STRUCTURE_RULES.has(r)) || !preamble ? "" : `${preamble}\n\n`;
  return `${lead}${out}${footer ? `\n${footer}\n` : ""}`;
}

/**
 * The comment left on the PR: what was fixed, and what only the author can fix.
 * @param {{ number: number }} pr
 * @param {string[]} fixed
 * @param {{ rule: string, message: string }[]} remaining
 * @param {string[]} notes
 */
export function commentFor(pr, fixed, remaining, notes = []) {
  const lines = [
    COMMENT_MARKER,
    "**PR documentation check** (see `course/README.md`, *Checking PR documentation*)",
    "",
  ];
  if (fixed.length) {
    lines.push("Fixed automatically:", ...fixed.map((f) => `- ${f}`), "");
  }
  if (remaining.length || notes.length) {
    lines.push(
      "Still to do by the author (the evaluation reads this PR):",
      ...remaining.map((p) => `- [ ] **${p.rule}:** ${p.message}`),
      ...notes.map((n) => `- [ ] ${n}`),
      "",
      "Sections marked *To be filled in by the author* are in the description; edit it to fill them in. Only tick a checklist item if it is true.",
      "Commits that are already pushed don't have to be rewritten; reference the issue (`Refs #N`) in the next ones.",
    );
  } else {
    lines.push("The PR now follows the rules. Nothing left to do.");
  }
  lines.push(
    "",
    `Rerun the check with \`node course/tooling/pr-report.mjs --team <team>\` or \`pnpm check:pr --number ${pr.number}\`.`,
  );
  return `${lines.join("\n")}\n`;
}
