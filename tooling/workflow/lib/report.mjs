// Output for the workflow checks, in the same shape as check:pr and check:commit:
// "ok: ..." on success, "warning: ..." lines, and "  - [rule] message" for each problem.
import { EXIT } from "./args.mjs";

/**
 * @typedef {{ rule: string, message: string, file?: string, fix?: string }} Problem
 * @typedef {{ ok: boolean, summary: string, problems: Problem[], warnings: string[], skipped?: boolean }} CheckResult
 */

/**
 * @param {string} summary shown when the check passes
 * @param {Problem[]} problems
 * @param {string[]} [warnings]
 * @returns {CheckResult}
 */
export function result(summary, problems, warnings = []) {
  return { ok: problems.length === 0, summary, problems, warnings };
}

/** @param {string} reason @returns {CheckResult} */
export function skipped(reason) {
  return { ok: true, summary: `skipped: ${reason}`, problems: [], warnings: [], skipped: true };
}

/**
 * Prints a result and returns the exit code.
 * @param {string} name e.g. "ownership"
 * @param {CheckResult} res
 * @param {boolean} json
 */
export function print(name, res, json) {
  if (json) {
    console.log(JSON.stringify({ check: name, ...res }, null, 2));
  } else {
    for (const w of res.warnings) console.error(`warning: ${w}`);
    if (res.ok) {
      console.log(`ok: ${name}: ${res.summary}`);
    } else {
      console.error(`${name}: ${res.summary}`);
      for (const p of res.problems) {
        console.error(`  - [${p.rule}] ${p.message}${p.file ? ` (${p.file})` : ""}`);
        if (p.fix) console.error(`    fix: ${p.fix}`);
      }
    }
  }
  return res.ok ? EXIT.ok : EXIT.failed;
}
