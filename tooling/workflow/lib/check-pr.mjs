// Validates a pull request against its template. Pure: the caller passes the PR data and the
// template texts, so the same rules run in CI, locally and in tests.
import { checkSubject } from "./check-commit.mjs";
import { baseFor, kindOfMainPr, WORK_BRANCH } from "./rules.mjs";
import { fieldLabelsOf, fieldsOf, stripComments } from "./template.mjs";

const normalize = (s) => s.trim().toLowerCase();
const WORK_TYPES = ["feature", "bug", "docs", "chore", "refactor"];

const IMAGE = /!\[[^\]]*\]\(|<img\s|https?:\/\/\S+/i;
const NONE_REASON = /^(?:none|n\/?a)\s*[,:-]\s*(\S[\s\S]*)$/i;
const BARE_NONE = /^(?:none|n\/?a)\s*[.,:-]*$/i;
export const SCREENSHOTS_FIX = "Add an image, or write `None, <why there is nothing to show>`.";

/**
 * What a Screenshots value holds: an image or link, "None, <reason>" (also "None: " or "None - "),
 * a bare "None" or "N/A", or other text.
 * @param {string} value the field's text, comments stripped
 * @returns {{ kind: "image" } | { kind: "none", reason: string } | { kind: "bare" } | { kind: "text" }}
 */
export function screenshotsOf(value) {
  const v = value.trim();
  if (IMAGE.test(v)) return { kind: "image" };
  const reason = NONE_REASON.exec(v)?.[1]?.trim();
  if (reason && /\w/.test(reason)) return { kind: "none", reason };
  if (BARE_NONE.test(v) || NONE_REASON.test(v)) return { kind: "bare" };
  return { kind: "text" };
}

/**
 * Finds which PR template a body follows from the fields only that template has.
 * Several matches are narrowed to the most specific one.
 * @param {string} body
 * @param {Record<string, string>} templates PR type -> template Markdown
 */
export function detectPrType(body, templates) {
  const common = new Set(fieldLabelsOf(templates.feature).map(normalize));
  const present = new Set(fieldsOf(body).map((s) => normalize(s.heading)));
  /** @type {Record<string, string[]>} */
  const unique = {};
  for (const [type, md] of Object.entries(templates)) {
    if (type === "feature") continue;
    unique[type] = fieldLabelsOf(md)
      .map(normalize)
      .filter((h) => !common.has(h));
  }
  const full = Object.keys(unique).filter(
    (t) => unique[t].length > 0 && unique[t].every((h) => present.has(h)),
  );
  const best = full.filter(
    (t) =>
      !full.some(
        (o) =>
          o !== t && unique[o].length > unique[t].length && unique[t].every((h) => unique[o].includes(h)),
      ),
  );
  const partial = Object.keys(unique).filter(
    (t) => !full.includes(t) && unique[t].some((h) => present.has(h)),
  );
  return { candidates: best, partial };
}

/**
 * @param {{
 *   title: string,
 *   body: string | null,
 *   head: string,
 *   base: string,
 *   labels?: string[] | null,
 *   type?: string | null,
 *   config: { teamLabels: string[], types?: Record<string, { commitTypes: string[] }> },
 *   templates: Record<string, string>,
 *   classification?: { undecided?: boolean, type?: string, rule?: string } | null,
 * }} input templates: PR type -> template Markdown
 */
export function checkPr({
  title,
  body: rawBody,
  head,
  base,
  labels = null,
  type = null,
  config,
  templates,
  classification = null,
}) {
  const body = rawBody ?? "";
  /** @type {{ rule: string, message: string, fix?: string }[]} */
  const problems = [];
  /** @type {string[]} */
  const warnings = [];
  const add = (rule, message, fix = "") => problems.push({ rule, message, ...(fix ? { fix } : {}) });

  // Title: Conventional Commits like a commit subject, with the team label as the scope,
  // e.g. "feat(team-2): add login page" (see "Pull request" in CLAUDE.md).
  const subject = checkSubject(title.trim());
  for (const p of subject.problems) add("title", `Title: ${p.message}`);
  let titleLabel = null;
  if (subject.type && !subject.scope) {
    add("title", `The title needs the team label as its scope, e.g. "${subject.type}(team-2): ...".`);
  } else if (subject.scope && !config.teamLabels.includes(subject.scope)) {
    add(
      "title",
      `The title's scope "${subject.scope}" is not a team label. Use one of: ${config.teamLabels.join(", ")}.`,
    );
  } else {
    titleLabel = subject.scope;
  }

  // Labels: exactly one team label, matching the title.
  if (labels) {
    const team = labels.filter((l) => config.teamLabels.includes(l));
    if (team.length !== 1) {
      add("labels", `Needs exactly one team label (${config.teamLabels.join(", ")}); has ${team.length}.`);
    } else if (titleLabel && titleLabel !== team[0]) {
      add("labels", `The title's scope is ${titleLabel} but the team label is ${team[0]}.`);
    }
  }

  // Head and base branches. A PR from main is a sync (into feature/team-N).
  /** @type {string | null} */
  let fixedType = null;
  // A promotion (feature/team-N into main) carries many issues, like a sync, so it may use Refs.
  const isPromotion = /^feature\/team-\d+$/.test(head) && base === "main";
  const isWorkPr = head !== "main" && !isPromotion;
  if (head === "main") {
    fixedType = kindOfMainPr(base);
    if (!fixedType) add("base", `A PR from main must target a feature/team-N branch (sync), not ${base}.`);
  } else {
    if (!/^feature\/team-[1-4]$/.test(head)) {
      const m = WORK_BRANCH.exec(head);
      if (!m) {
        add(
          "branch",
          `Branch "${head}" must be named <team-label>/<issue-number>-<short-description>, e.g. team-2/14-add-login.`,
        );
      } else if (titleLabel && m[1] !== titleLabel) {
        add("branch", `Branch label "${m[1]}" differs from the title's scope "${titleLabel}".`);
      }
    }
    const expected = baseFor(head, config.teamLabels);
    if (expected && expected !== base) add("base", `A PR from ${head} must target ${expected}, not ${base}.`);
  }

  // Which template does the body follow?
  let chosen = type ?? fixedType;
  if (!chosen) {
    const { candidates, partial } = detectPrType(body, templates);
    const work = candidates.filter((c) => WORK_TYPES.includes(c));
    if (candidates.length > work.length) {
      add(
        "template",
        `A PR from ${head} cannot use the ${candidates.filter((c) => !WORK_TYPES.includes(c)).join("/")} template; that one is for PRs from main.`,
      );
    }
    if (work.length > 1)
      add(
        "template",
        `The body mixes the fields of several templates (${work.join(", ")}). Use one template.`,
      );
    if (work.length === 0 && partial.length > 0) {
      add(
        "template",
        `The body has some of the ${partial.join("/")} template's fields but not all of them. Use the full template.`,
      );
    }
    chosen = work.length === 1 ? work[0] : "feature";
  }
  if (!templates[chosen]) {
    add("template", `No PR template for type "${chosen}".`);
    return { ok: false, type: chosen, problems, warnings };
  }

  // The title's type matches the template: feat for a feature PR, fix for a bug PR, and so on.
  // Release and sync PRs have no commit type of their own; they use chore.
  const allowedTypes = config.types?.[chosen]?.commitTypes?.length
    ? config.types[chosen].commitTypes
    : ["chore"];
  if (subject.type && !allowedTypes.includes(subject.type)) {
    add(
      "title",
      `A ${chosen} PR's title starts with ${allowedTypes.join(" or ")}, not "${subject.type}" (e.g. "${allowedTypes[0]}(${titleLabel ?? "team-2"}): ...").`,
    );
  }

  // Every field of the template, in order, with content.
  const sections = fieldsOf(body);
  const required = fieldLabelsOf(templates[chosen]);
  let cursor = -1;
  for (const heading of required) {
    const idx = sections.findIndex((s) => normalize(s.heading) === normalize(heading));
    if (idx === -1) {
      add("heading", `Missing field "**${heading}**".`);
      continue;
    }
    if (idx < cursor) add("order", `Field "**${heading}**" is out of order; follow the template.`);
    cursor = Math.max(cursor, idx);

    const content = stripComments(sections[idx].body).trim();
    if (content.replace(/^\s*(?:[-*]|\d+\.)\s*$/gm, "").trim() === "") {
      if (heading === "Screenshots") add("empty", `Field "**${heading}**" is empty.`, SCREENSHOTS_FIX);
      else add("empty", `Field "**${heading}**" is empty. Fill it in, or write "None" if it does not apply.`);
      continue;
    }
    if (heading === "Linked issue") {
      const word = isWorkPr ? "Closes|Fixes|Resolves" : "Closes|Fixes|Resolves|Refs";
      if (!new RegExp(`\\b(?:${word})\\s+#\\d+`, "i").test(content)) {
        add(
          "linked-issue",
          `"**Linked issue**" needs ${isWorkPr ? '"Closes #<number>"' : '"Refs #<number>" or "Closes #<number>"'}.`,
        );
      }
    } else if (heading === "Team") {
      const team = content.split(/\s+/)[0].replace(/[`*]/g, "");
      if (!config.teamLabels.includes(team)) {
        add("team", `"**Team**" must be a team label (${config.teamLabels.join(", ")}), got "${team}".`);
      } else if (titleLabel && team !== titleLabel) {
        add("team", `"**Team**" says ${team} but the title's scope is ${titleLabel}.`);
      }
    } else if (heading === "Screenshots") {
      if (screenshotsOf(content).kind === "bare")
        add("screenshots", `"**Screenshots**" says "${content}" without a reason.`, SCREENSHOTS_FIX);
    } else if (heading === "Checklist") {
      const boxes = content.split(/\r?\n/).filter((l) => /^\s*-\s*\[[ xX]\]/.test(l));
      const needed = (stripComments(templates[chosen]).match(/^\s*-\s*\[ \]/gm) ?? []).length;
      const open = boxes.filter((l) => /^\s*-\s*\[ \]/.test(l));
      if (boxes.length < needed)
        add("checklist", `Checklist has ${boxes.length} items; the template has ${needed}.`);
      if (open.length > 0)
        add(
          "checklist",
          `${open.length} checklist item(s) are not ticked. Tick them, or fix what they check.`,
        );
    }
  }

  // The classifier is deterministic, so a different answer from the template used is worth a look.
  if (
    isWorkPr &&
    classification &&
    !classification.undecided &&
    classification.type &&
    classification.type !== chosen
  ) {
    warnings.push(
      `The changed files and commits classify this as "${classification.type}" (rule: ${classification.rule}) but the body follows the ${chosen} template.`,
    );
  }

  return { ok: problems.length === 0, type: chosen, problems, warnings };
}
