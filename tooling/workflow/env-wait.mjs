// `pnpm env:wait <sha>`: waits until production's /health reports that commit, e.g. after a merge into
// main. While a deploy restarts the service, failed requests are retried until the timeout.
//
//   pnpm env:wait c9bc1c1    wait until production runs c9bc1c1
//   --timeout <s>            give up after this long (default 600)
//   --interval <s>           how often to look (default 10)
//   --url <url>              the gateway's address (default: $KIT_GATEWAY)
//   --json                   machine-readable output
//
// Exit codes: 0 the environment runs that commit, 1 it didn't before the timeout (or reports the wrong
// APP_ENV), 2 usage error, 3 environment problem (the URL is not set).
import { EXIT, parseArgs } from "./lib/args.mjs";
import { progress, report, secondsFlag, usageError } from "./lib/command.mjs";
import { compareHealth, envUrl } from "./lib/env.mjs";
import { fetchHealth } from "./lib/remote.mjs";
import { result } from "./lib/report.mjs";
import { poll } from "./lib/wait.mjs";

const USAGE = "pnpm env:wait <sha> [--timeout <s>] [--interval <s>] [--url <gateway>] [--json]";
const { flags, positional } = parseArgs(process.argv.slice(2), { boolean: ["json"] });
const json = flags.json === true;
if (positional.length !== 1) usageError("give the commit SHA.", USAGE);
const name = "production";
const sha = positional[0].toLowerCase();
if (!/^[0-9a-f]{7,40}$/.test(sha))
  usageError(`"${positional[0]}" is not a commit SHA (7 to 40 hex characters).`, USAGE);
const timeoutMs = secondsFlag(flags, "timeout", 600, USAGE);
const intervalMs = secondsFlag(flags, "interval", 10, USAGE);

const target = envUrl(name, { flags, env: process.env });
if (target.error) {
  console.error(`error: ${target.error}`);
  process.exit(EXIT.environment);
}
const url = /** @type {string} */ (target.url);

const waited = await poll({
  attempt: async () => {
    const r = await fetchHealth(url);
    return { ...r, problems: compareHealth({ name, ...r, expectedSha: sha }) };
  },
  done: (r) => r.problems.length === 0,
  // The wrong APP_ENV won't fix itself: the URL points at another environment.
  stop: (r) => r.problems.some((p) => p.rule === "app-env"),
  timeoutMs,
  intervalMs,
  onWait: (r, elapsed) =>
    progress(
      `Waiting for ${name} to run ${sha.slice(0, 7)} (${Math.round(elapsed / 1000)}s): ${r.health ? `runs ${r.health.sha.slice(0, 7)}` : r.error}`,
    ),
});

const last = waited.last;
const problems = waited.done
  ? []
  : waited.stopped
    ? last.problems
    : [
        {
          rule: "timeout",
          message: `${name} did not run ${sha.slice(0, 7)} within ${timeoutMs / 1000}s. Last seen: ${last.health ? last.health.sha : last.error}.`,
          fix: "Check the deploy in Railway, or wait longer with --timeout.",
        },
      ];
const res = {
  ...result(
    waited.done ? `${name} runs ${sha.slice(0, 7)}` : `${name} is not on ${sha.slice(0, 7)}`,
    problems,
  ),
  environment: name,
  url,
  sha,
  reported: last.health?.sha ?? null,
  attempts: waited.attempts,
};
process.exit(report("env-wait", res, { json }));
