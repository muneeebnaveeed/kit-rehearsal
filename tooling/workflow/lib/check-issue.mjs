// Validates an issue against its template. Pure: the caller passes the template texts.
import { headingsOf, sectionsOf, stripComments } from "./template.mjs";

const normalize = (s) => s.trim().toLowerCase();

/**
 * @param {{
 *   title: string,
 *   body: string,
 *   labels?: string[] | null,
 *   type?: string | null,
 *   config: { teamLabels: string[] },
 *   templates: Record<string, string>,
 * }} input templates: issue type -> template Markdown
 */
export function checkIssue({ title, body, labels = null, type = null, config, templates }) {
  /** @type {{ rule: string, message: string }[]} */
  const problems = [];
  const add = (rule, message) => problems.push({ rule, message });

  // Title: a short summary. The team label already names the team, so no "[team-2]" prefix.
  const prefix = /^\s*(\[[^\]]*\])/.exec(title)?.[1];
  if (!title.trim()) add("title", "The title is empty.");
  else if (prefix) add("title", `Drop "${prefix}" from the title: the team label already names the team.`);

  // Labels: exactly one team label.
  if (labels) {
    const team = labels.filter((l) => config.teamLabels.includes(l));
    if (team.length !== 1) {
      add("labels", `Needs exactly one team label (${config.teamLabels.join(", ")}); has ${team.length}.`);
    }
  }

  // Which template does the body follow? An explicit type wins; otherwise a heading that only one
  // template has decides; with none, it is a feature.
  const headingSets = Object.fromEntries(Object.entries(templates).map(([k, md]) => [k, headingsOf(md)]));
  const bodyHeadings = sectionsOf(body).map((s) => normalize(s.heading));
  let chosen = type;
  if (!chosen) {
    const common = new Set((headingSets.feature ?? []).map(normalize));
    const hits = Object.entries(headingSets)
      .filter(([k]) => k !== "feature")
      .filter(([, hs]) => hs.some((h) => !common.has(normalize(h)) && bodyHeadings.includes(normalize(h))))
      .map(([k]) => k);
    if (hits.length > 1) {
      add("template", `The body mixes headings of several templates (${hits.join(", ")}). Use one template.`);
    }
    chosen = hits.length === 1 ? hits[0] : "feature";
  }
  if (!headingSets[chosen]) {
    add("template", `No issue template for type "${chosen}".`);
    return { ok: false, type: chosen, problems };
  }

  // Every heading of the template, in order, each with real content.
  const sections = sectionsOf(body);
  let cursor = -1;
  for (const heading of headingSets[chosen]) {
    const idx = sections.findIndex((s) => normalize(s.heading) === normalize(heading));
    if (idx === -1) {
      add("heading", `Missing section "## ${heading}".`);
      continue;
    }
    if (idx < cursor) add("order", `Section "## ${heading}" is out of order; follow the template.`);
    cursor = Math.max(cursor, idx);

    const content = stripComments(sections[idx].body).trim();
    if (heading === "Done when") {
      const items = content.split(/\r?\n/).filter((l) => /^\s*-\s*\[[ xX]\]\s*\S/.test(l));
      if (items.length === 0)
        add("done-when", '"Done when" needs at least one checkbox item with text, e.g. "- [ ] Tests pass".');
    } else if (content.replace(/^\s*(?:[-*]|\d+\.)\s*$/gm, "").trim() === "") {
      add("empty", `Section "## ${heading}" is empty. Fill it in, or write "None" if it does not apply.`);
    }
  }

  return { ok: problems.length === 0, type: chosen, problems };
}
