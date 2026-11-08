// The label scheme from labels.json, and the plan that makes GitHub match it. Pure: the caller passes
// the repo's current labels, so the plan is unit-tested.
import { readFileSync } from "node:fs";

/**
 * @typedef {{ name: string, color: string, description: string, renamedFrom?: string[] }} LabelDef
 * @typedef {{ name: string, color: string, description: string }} RepoLabel
 * @typedef {{ action: "create" | "update" | "rename" | "delete", name: string, from?: string, color?: string, description?: string }} LabelChange
 */

/** @param {string} root repo root */
export function loadLabels(root) {
  return JSON.parse(readFileSync(`${root}/tooling/workflow/labels.json`, "utf8"));
}

/** Every defined label, flattened. @param {{ groups: { labels: LabelDef[] }[] }} scheme */
export const allLabels = (scheme) => scheme.groups.flatMap((g) => g.labels);

/** Names in one group, e.g. labelsOf(scheme, "status"). @param {any} scheme @param {string} group */
export const labelsOf = (scheme, group) =>
  scheme.groups.find((g) => g.group === group)?.labels.map((l) => l.name) ?? [];

const same = (a, b) => a.toLowerCase() === b.toLowerCase();

/**
 * What to change so the repo's labels match the scheme. Labels the scheme doesn't know and doesn't
 * remove are left alone.
 * @param {{ groups: { labels: LabelDef[] }[], remove?: string[] }} scheme
 * @param {RepoLabel[]} current
 * @returns {LabelChange[]}
 */
export function planLabelSync(scheme, current) {
  /** @type {LabelChange[]} */
  const changes = [];
  const find = (name) => current.find((l) => same(l.name, name));
  const renamed = new Set();

  for (const def of allLabels(scheme)) {
    const existing = find(def.name);
    if (existing) {
      if (!same(existing.color, def.color) || existing.description !== def.description) {
        changes.push({ action: "update", name: def.name, color: def.color, description: def.description });
      }
      continue;
    }
    const old = (def.renamedFrom ?? []).map(find).find(Boolean);
    if (old) {
      renamed.add(old.name.toLowerCase());
      changes.push({
        action: "rename",
        from: old.name,
        name: def.name,
        color: def.color,
        description: def.description,
      });
    } else {
      changes.push({ action: "create", name: def.name, color: def.color, description: def.description });
    }
  }
  for (const name of scheme.remove ?? []) {
    const existing = find(name);
    if (existing && !renamed.has(existing.name.toLowerCase()))
      changes.push({ action: "delete", name: existing.name });
  }
  return changes;
}
