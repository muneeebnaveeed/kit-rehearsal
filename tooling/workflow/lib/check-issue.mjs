// Validates an issue against its template. Pure: the caller passes the template texts.
import { fieldLabelsOf, fieldsOf, stripComments } from "./template.mjs";

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

  // Which template does the body follow? An explicit type wins; otherwise a field that only one
  // template has decides; with none, it is a feature.
  const labelSets = Object.fromEntries(Object.entries(templates).map(([k, md]) => [k, fieldLabelsOf(md)]));
  const fields = fieldsOf(body);
  const bodyLabels = fields.map((f) => normalize(f.heading));
  let chosen = type;
  if (!chosen) {
    const common = new Set((labelSets.feature ?? []).map(normalize));
    const hits = Object.entries(labelSets)
      .filter(([k]) => k !== "feature")
      .filter(([, ls]) => ls.some((l) => !common.has(normalize(l)) && bodyLabels.includes(normalize(l))))
      .map(([k]) => k);
    if (hits.length > 1) {
      add(
        "template",
        `The body mixes the fields of several templates (${hits.join(", ")}). Use one template.`,
      );
    }
    chosen = hits.length === 1 ? hits[0] : "feature";
  }
  if (!labelSets[chosen]) {
    add("template", `No issue template for type "${chosen}".`);
    return { ok: false, type: chosen, problems };
  }

  // Every field of the template, in order, each with real content.
  let cursor = -1;
  for (const label of labelSets[chosen]) {
    const idx = fields.findIndex((f) => normalize(f.heading) === normalize(label));
    if (idx === -1) {
      add("heading", `Missing field "**${label}**".`);
      continue;
    }
    if (idx < cursor) add("order", `Field "**${label}**" is out of order; follow the template.`);
    cursor = Math.max(cursor, idx);

    const content = stripComments(fields[idx].body).trim();
    if (label === "Done when") {
      const items = content.split(/\r?\n/).filter((l) => /^\s*-\s*\[[ xX]\]\s*\S/.test(l));
      if (items.length === 0)
        add("done-when", '"Done when" needs at least one checkbox item with text, e.g. "- [ ] Tests pass".');
    } else if (content.replace(/^\s*(?:[-*]|\d+\.)\s*$/gm, "").trim() === "") {
      add("empty", `Field "**${label}**" is empty. Fill it in, or write "None" if it does not apply.`);
    }
  }

  return { ok: problems.length === 0, type: chosen, problems };
}
