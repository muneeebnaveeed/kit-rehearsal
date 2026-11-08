// Fills a PR template for the commands that open PRs themselves. Every field of the template is
// kept, in order; the guidance comments are dropped. A field or checklist item that is not in the
// template is an error, so a template change can't silently produce a body check:pr rejects.
import { fieldLabelsOf, fieldsOf } from "./template.mjs";

/** One "**Label**: value" field; a multi-line value starts on the next line. */
export function renderField(label, content) {
  const value = content.trim();
  if (!value) return `**${label}**:`;
  return value.includes("\n") ? `**${label}**:\n${value}` : `**${label}**: ${value}`;
}

/**
 * @param {string} template the template's Markdown
 * @param {{
 *   sections: Record<string, string>,
 *   tick?: Record<string, string | true>,
 * }} input sections: field label -> content (others keep the template's text);
 *   tick: start of a checklist item -> true, or a note shown after it
 */
export function fillTemplate(template, { sections, tick = {} }) {
  const labels = fieldLabelsOf(template);
  for (const label of Object.keys(sections)) {
    if (!labels.includes(label)) throw new Error(`The template has no "**${label}**" field.`);
  }
  const defaults = Object.fromEntries(fieldsOf(template).map((s) => [s.heading, s.body]));

  const used = new Set();
  const parts = labels.map((label) => {
    let content = sections[label] ?? defaults[label] ?? "";
    if (label === "Checklist") {
      content = content
        .split(/\r?\n/)
        .map((line) => {
          const m = /^(\s*-\s*)\[ \]\s*(.*)$/.exec(line);
          if (!m) return line;
          const key = Object.keys(tick).find((k) => m[2].startsWith(k));
          if (!key) return line;
          used.add(key);
          const note = tick[key] === true ? "" : ` (${tick[key]})`;
          return `${m[1]}[x] ${m[2]}${note}`;
        })
        .join("\n");
    }
    return renderField(label, content);
  });
  for (const key of Object.keys(tick)) {
    if (!used.has(key)) throw new Error(`The template's checklist has no item "${key}".`);
  }
  return `${parts.join("\n\n")}\n`;
}
