// Tiny argument parser: "--flag", "--key value" and "--key=value". No dependencies.

/**
 * @param {string[]} argv
 * @param {{ boolean?: string[] }} [spec] flags that never take a value
 * @returns {{ flags: Record<string, string | true>, positional: string[] }}
 */
export function parseArgs(argv, spec = {}) {
  const booleans = new Set(spec.boolean ?? []);
  /** @type {Record<string, string | true>} */
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else if (booleans.has(arg.slice(2)) || i + 1 >= argv.length || argv[i + 1].startsWith("--")) {
      flags[arg.slice(2)] = true;
    } else {
      flags[arg.slice(2)] = argv[++i];
    }
  }
  return { flags, positional };
}

/** Exit codes shared by every workflow script (same as the platform scripts in #10). */
export const EXIT = { ok: 0, failed: 1, usage: 2, environment: 3 };
