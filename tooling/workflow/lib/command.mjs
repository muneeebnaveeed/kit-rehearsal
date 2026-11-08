// Small helpers shared by the commands that act (sync, team:promote, branches:sync,
// env:status, env:wait): usage errors, numeric flags and printing a drafted PR.
import { EXIT } from "./args.mjs";
import { print } from "./report.mjs";

/** Prints a usage error and exits with 2. @param {string} message @param {string} usage */
export function usageError(message, usage) {
  console.error(`error: ${message}`);
  console.error(`usage: ${usage}`);
  process.exit(EXIT.usage);
}

/**
 * A positive number of seconds from a flag, in milliseconds.
 * @param {Record<string, string | true>} flags
 * @param {string} name
 * @param {number} fallback seconds
 * @param {string} usage
 */
export function secondsFlag(flags, name, fallback, usage) {
  if (flags[name] === undefined) return fallback * 1000;
  const n = Number(flags[name]);
  if (!Number.isFinite(n) || n <= 0)
    usageError(`--${name} takes a number of seconds, got "${flags[name]}".`, usage);
  return n * 1000;
}

/**
 * The issue number from --issue. Required: a PR between long-lived branches still links an issue.
 * @param {Record<string, string | true>} flags
 * @param {string} usage
 */
export function issueFlag(flags, usage) {
  const raw = typeof flags.issue === "string" ? flags.issue.replace(/^#/, "") : null;
  if (!raw) usageError("--issue <number> is required: the PR links that issue.", usage);
  if (!/^\d+$/.test(raw)) usageError(`--issue takes an issue number, got "${flags.issue}".`, usage);
  return Number(raw);
}

/** Progress messages go to stderr, so --json output on stdout stays parseable. @param {string} message */
export function progress(message) {
  console.error(message);
}

/**
 * Prints a result like the checks do. In a dry run (text mode) the drafted PRs follow it.
 * @param {string} name
 * @param {import("./report.mjs").CheckResult & Record<string, unknown>} res
 * @param {{ json: boolean, drafts?: { title: string, head: string, base: string, labels: string[], body: string }[] }} opts
 */
export function report(name, res, { json, drafts = [] }) {
  const code = print(name, res, json);
  if (!json) {
    for (const d of drafts) {
      console.log(`\n--- ${d.head} -> ${d.base}: ${d.title} [${d.labels.join(", ")}]\n`);
      console.log(d.body);
    }
  }
  return code;
}
