import { readFileSync } from "node:fs";

/** Loads tooling/workflow/types.json. @param {string} root repo root */
export function loadTypes(root) {
  return JSON.parse(readFileSync(`${root}/tooling/workflow/types.json`, "utf8"));
}

/**
 * PR type -> template Markdown, for every type that has a PR template.
 * @param {string} root repo root
 * @param {{ types: Record<string, { prTemplate: string | null }> }} config loadTypes(root)
 */
export function loadPrTemplates(root, config) {
  return Object.fromEntries(
    Object.entries(config.types)
      .filter(([, t]) => t.prTemplate)
      .map(([name, t]) => [name, readFileSync(`${root}/${t.prTemplate}`, "utf8")]),
  );
}
