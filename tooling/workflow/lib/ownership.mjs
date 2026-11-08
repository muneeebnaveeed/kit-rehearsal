// Which label owns which path, read from tooling/ownership.json (first matching rule wins).
import { readFileSync } from "node:fs";
import { globToRegExp } from "./glob.mjs";

/** @typedef {{ path: string, owner: string }} OwnershipRule */

/** @param {string} root repo root */
export function loadOwnership(root) {
  const file = JSON.parse(readFileSync(`${root}/tooling/ownership.json`, "utf8"));
  return /** @type {OwnershipRule[]} */ (file.rules);
}

/**
 * @param {string} file
 * @param {OwnershipRule[]} rules
 */
export function ownerOf(file, rules) {
  for (const rule of rules) {
    if (globToRegExp(rule.path).test(file)) return rule.owner;
  }
  return "shared";
}

/**
 * Distinct owners of the given files, without "shared" (files that belong to nobody in particular).
 * @param {string[]} files
 * @param {OwnershipRule[]} rules
 */
export function ownersOf(files, rules) {
  return [...new Set(files.map((f) => ownerOf(f, rules)))].filter((o) => o !== "shared").sort();
}
