/**
 * State inspector for the ~ overlay: turns a room's state (e.g. `room.state.toJSON()`) into short
 * "path → value" lines, so you can watch the live state without a debugger. Pure and renderer-free.
 */

export interface InspectOptions {
  /** At most this many lines; the rest is counted in a final "…" line. */
  readonly maxLines?: number;
  /** Keys shown only as "N entries", e.g. ["pickups"] when there are many. */
  readonly summarise?: readonly string[];
}

const DEFAULT_MAX_LINES = 24;
const MORE_KEY = "…";

export function inspectState(state: unknown, options: InspectOptions = {}): Record<string, string> {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const summarise = new Set(options.summarise ?? []);
  const lines: [string, string][] = [];

  const walk = (value: unknown, path: string, key: string): void => {
    if (value !== null && typeof value === "object") {
      const entries = Array.isArray(value)
        ? value.map((item, i) => [String(i), item] as const)
        : Object.entries(value);
      if (entries.length === 0 || summarise.has(key)) {
        lines.push([path, `${entries.length} entries`]);
        return;
      }
      for (const [childKey, child] of entries) walk(child, path ? `${path}.${childKey}` : childKey, childKey);
      return;
    }
    lines.push([path, formatLeaf(value)]);
  };
  walk(state, "", "");

  const shown = lines.slice(0, maxLines);
  const hidden = lines.length - shown.length;
  return Object.fromEntries(hidden > 0 ? [...shown, [MORE_KEY, `${hidden} more`]] : shown);
}

function formatLeaf(value: unknown): string {
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(1);
  if (value === "") return '""';
  return String(value);
}
