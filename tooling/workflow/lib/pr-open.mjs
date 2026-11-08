// Plans `pnpm pr:open`: checks the branch and issue belong to your team, and drafts the title and
// body from the template workflow:classify picks. Pure: the caller runs preflight, git and gh, and
// passes the facts it verified. A checklist item is ticked only when its fact was verified, so a
// draft with an unverified item fails check:pr and no PR is opened.
import { checkSubject } from "./check-commit.mjs";
import { renderField } from "./pr-body.mjs";
import { parsePrefix, WORK_BRANCH } from "./rules.mjs";
import { teamBase } from "./team.mjs";
import { fieldLabelsOf, fieldsOf, stripComments } from "./template.mjs";

/**
 * Which verified fact ticks which checklist item, matched on the item's text. An item that matches
 * none stays open.
 * @type {[RegExp, string][]}
 */
export const CHECKLIST_FACTS = [
  [/closes an issue/i, "issueLinked"],
  [/same team label/i, "sameLabel"],
  [/title follows/i, "title"],
  [/branch is named/i, "branchName"],
  [/own team's folder/i, "ownership"],
  [/commits follow/i, "commits"],
  [/no secrets/i, "files"],
  [/base branch is correct/i, "base"],
  [/up to date/i, "upToDate"],
  [/tested the change/i, "tested"],
];

/** The fact that ticks a checklist item, or null. @param {string} item the item's text */
export function factOf(item) {
  return CHECKLIST_FACTS.find(([re]) => re.test(item))?.[1] ?? null;
}

// Files whose change is visible in the browser, so the PR needs screenshots.
export const CLIENT_FILE = /(^|\/)client\/|\.(css|html|tsx|jsx|svg|png|jpe?g|gif|webp)$/;

/**
 * @typedef {{ number: number, title: string, state: string, labels: string[], assignees?: string[] }} Issue
 * @param {{ branch: string, team: string, teamLabels: string[], issue: Issue | null | undefined, existingPr: string | null }} input
 *   issue: undefined when the branch has no issue number to look up
 */
export function planPrOpen({ branch, team, teamLabels, issue, existingPr }) {
  /** @type {import("./report.mjs").Problem[]} */
  const problems = [];
  const add = (rule, message, fix) => problems.push({ rule, message, ...(fix ? { fix } : {}) });
  const base = teamBase(team);

  const m = WORK_BRANCH.exec(branch);
  if (!m) {
    add(
      "branch",
      `"${branch}" isn't a work branch (<team-label>/<issue-number>-<short-description>).`,
      branch === "main" || /^feature\//.test(branch)
        ? "pr:open is for work branches. Promote a feature branch with pnpm team:promote."
        : "Start work with: pnpm issue:start <issue-number>",
    );
    return { ok: false, base, number: null, label: null, problems };
  }
  const [, label, num] = m;
  const number = Number(num);
  if (label !== team) {
    add(
      "team",
      `Branch ${branch} belongs to ${label}, but you are on ${team}.`,
      `Open PRs for your own team's branches. If you really work for ${label}, pass --team ${label} for this run.`,
    );
  }

  if (issue === null) {
    add("issue", `Issue #${number} doesn't exist.`, "Name the branch after an open issue.");
  } else if (issue) {
    if (issue.state !== "OPEN")
      add("issue", `Issue #${number} is closed.`, "Reopen it, or work on an open issue.");
    const labels = issue.labels.filter((l) => teamLabels.includes(l));
    if (labels.length !== 1 || labels[0] !== label) {
      add(
        "label",
        `Issue #${number} has ${labels.length ? labels.join(", ") : "no team label"}, but the branch is ${label}'s.`,
        `Give #${number} the single team label ${label}, or work on one of ${label}'s issues.`,
      );
    }
  }
  if (existingPr)
    add("exists", `This branch already has an open PR: ${existingPr}`, "Update that PR instead.");

  return { ok: problems.length === 0, base, number, label, problems };
}

/**
 * The PR title: `<commitType>(<team>): <subject>`. The issue title first; when that isn't a valid
 * subject (too long, not imperative...), the oldest commit with the same type. Null when neither fits.
 * @param {{ commitType: string, team: string, issueTitle: string, subjects: string[], precedence: string[] }} input
 *   subjects: newest first, as git log prints them
 */
export function prTitle({ commitType, team, issueTitle, subjects }) {
  const valid = (t) => checkSubject(t).problems.length === 0;
  const fromIssue = issueTitle
    .replace(/^\s*\[[^\]]*\]\s*/, "")
    .trim()
    .replace(/\.+$/, "");
  const candidates = [
    fromIssue && `${commitType}(${team}): ${fromIssue[0].toLowerCase()}${fromIssue.slice(1)}`,
  ];
  for (const subject of [...subjects].reverse()) {
    if (parsePrefix(subject)?.prefix !== commitType) continue;
    candidates.push(`${commitType}(${team}): ${subject.slice(subject.indexOf(":") + 1).trim()}`);
  }
  return candidates.find((t) => t && valid(t)) ?? null;
}

/**
 * Ticks the checklist items whose fact is true.
 * @param {string[]} lines the template's checklist lines ("- [ ] ...")
 * @param {Record<string, boolean>} facts
 */
export function tickChecklist(lines, facts) {
  /** @type {string[]} */
  const unticked = [];
  const out = lines.map((line) => {
    const m = /^(\s*-\s*)\[ \]\s*(.*)$/.exec(line);
    if (!m) return line;
    const fact = factOf(m[2]);
    if (fact && facts[fact] === true) return `${m[1]}[x] ${m[2]}`;
    unticked.push(m[2]);
    return line;
  });
  return { lines: out, unticked };
}

/**
 * Checklist facts preflight verified. A cross-team change passes preflight with a warning; the
 * checklist item also asks that the issue explains why, which a script can't judge, so it stays open.
 * @param {{ name: string, ok: boolean, warnings: string[] }[]} steps preflight --json steps
 */
export function preflightFacts(steps) {
  const passed = (name, noWarnings = false) => {
    const s = steps.find((x) => x.name === name);
    return Boolean(s?.ok && (!noWarnings || s.warnings.length === 0));
  };
  return {
    ownership: passed("ownership", true),
    commits: passed("commits"),
    files: passed("files") && passed("secrets"),
  };
}

/** The option that fills a field: "Root cause" -> "root-cause". @param {string} heading */
export function sectionFlag(heading) {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** The text pr:open writes under "How to test" when you don't pass your own. */
export const PREFLIGHT_TEST_TEXT =
  "1. Check out the branch and run `pnpm preflight`. It passed before this PR was opened: setup, lint, typecheck, test, build and the branch checks.";

/**
 * The fields pr:open can fill from facts. Fields it can't know are left out, so you pass them or
 * check:pr refuses: Summary and Root cause say why, which no diff or commit list can (Impact,
 * Behaviour unchanged and Screenshots of a visible change likewise).
 * @param {{ files: string[] }} input
 * @returns {Record<string, string | undefined>}
 */
export function defaultSections({ files }) {
  const docs = files.filter((f) => f.endsWith(".md"));
  return {
    "How to test": PREFLIGHT_TEST_TEXT,
    Screenshots: files.some((f) => CLIENT_FILE.test(f)) ? undefined : "None: no client files changed.",
    "Pages affected": docs.length ? docs.map((f) => `- \`${f}\``).join("\n") : undefined,
  };
}

/**
 * Builds the body from a template: every field, in order, without the guidance comments. Each
 * field gets `sections[label]`; the Checklist gets the template's items, ticked from `facts`.
 * @param {{ template: string, sections: Record<string, string | undefined>, facts: Record<string, boolean> }} input
 */
export function buildPrBody({ template, sections, facts }) {
  const checklist = fieldsOf(template).find((s) => s.heading === "Checklist");
  const items = stripComments(checklist?.body ?? "")
    .split(/\r?\n/)
    .filter((l) => /^\s*-\s*\[ \]/.test(l));
  const ticked = tickChecklist(items, facts);
  /** @type {string[]} */
  const missing = [];
  const parts = fieldLabelsOf(template).map((label) => {
    const content = label === "Checklist" ? ticked.lines.join("\n") : (sections[label] ?? "").trim();
    if (!content) missing.push(label);
    return renderField(label, content);
  });
  return { body: `${parts.join("\n\n")}\n`, missing, unticked: ticked.unticked };
}
