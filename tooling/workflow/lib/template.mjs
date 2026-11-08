// Reads the Markdown templates in .github/ so the checks always follow the templates (issues and PRs
// alike are "**Label**: value" fields): change a template and the matching check changes with it.

/** Removes HTML comments (the guidance text in templates). */
export function stripComments(md) {
  return md.replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * Splits an issue or PR body, or a template, into its "**Label**: value" fields. A value runs until the next field
 * line; text before the first field (the guidance comment) is ignored.
 * @param {string} md
 * @returns {{ heading: string, body: string }[]}
 */
export function fieldsOf(md) {
  const fields = [];
  let current = null;
  let inFence = false;
  for (const line of stripComments(md).split(/\r?\n/)) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const m = !inFence && /^\*\*(.+?)\*\*:\s?(.*)$/.exec(line);
    if (m) {
      current = { heading: m[1].trim(), body: `${m[2]}\n` };
      fields.push(current);
    } else if (current) {
      current.body += `${line}\n`;
    }
  }
  for (const f of fields) f.body = f.body.trim();
  return fields;
}

/** Field labels of a template, in order. */
export function fieldLabelsOf(md) {
  return fieldsOf(md).map((f) => f.heading);
}

/**
 * Parses the YAML-ish front matter GitHub issue templates start with (flat key: value lines).
 * @param {string} md
 * @returns {Record<string, string>}
 */
export function frontMatterOf(md) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
