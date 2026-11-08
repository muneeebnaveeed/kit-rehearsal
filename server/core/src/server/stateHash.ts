import { createHash } from "node:crypto";

/** JSON with object keys sorted at every level, so equal states always serialize the same way. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

/**
 * SHA-256 (hex) of the state's canonical JSON. Independent of Colyseus change tracking, so the live
 * room and the replay runner hash the same state the same way.
 */
export function stateHash(state: { toJSON(): unknown }): string {
  return createHash("sha256").update(canonicalJson(state.toJSON())).digest("hex");
}
