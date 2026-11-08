// `pnpm env:status`: reads production's /health and compares the SHA it reports with the head of main.
//
//   pnpm env:status
//   --url <url>      the gateway's address (default: $KIT_GATEWAY)
//   --offline        don't git fetch; compare with the local origin/main
//   --json           machine-readable output
//
// Exit codes: 0 production runs main's head, 1 it is unreachable, unhealthy or on another commit,
// 2 usage error, 3 environment problem (the URL is not set, git fails).
import { EXIT, parseArgs } from "./lib/args.mjs";
import { report, usageError } from "./lib/command.mjs";
import { compareHealth, ENVIRONMENTS, envUrl } from "./lib/env.mjs";
import { fetchHealth, fetchOrigin, revParse } from "./lib/remote.mjs";
import { result } from "./lib/report.mjs";

const USAGE = "pnpm env:status [--url <gateway>] [--offline] [--json]";
const { flags, positional } = parseArgs(process.argv.slice(2), { boolean: ["json", "offline"] });
const json = flags.json === true;
if (positional.length > 0) usageError(`unexpected argument "${positional[0]}".`, USAGE);

const names = Object.keys(ENVIRONMENTS);

const urls = names.map((name) => ({ name, ...envUrl(name, { flags, env: process.env }) }));
const missing = urls.filter((u) => u.error);
if (missing.length > 0) {
  for (const u of missing) console.error(`error: ${u.error}`);
  process.exit(EXIT.environment);
}

if (flags.offline !== true) fetchOrigin(names.map((n) => ENVIRONMENTS[n].branch));
const environments = await Promise.all(
  urls.map(async ({ name, url }) => {
    const { branch } = ENVIRONMENTS[name];
    const expectedSha = revParse(`origin/${branch}`);
    const { health, error } = await fetchHealth(/** @type {string} */ (url));
    const problems = compareHealth({ name, health, error, expectedSha });
    return {
      name,
      url,
      branch,
      expectedSha,
      sha: health?.sha ?? null,
      env: health?.env ?? null,
      ok: problems.length === 0,
      problems,
    };
  }),
);

const summary = environments
  .map(
    (e) =>
      `${e.name} runs ${e.sha ? e.sha.slice(0, 7) : "?"} (${e.branch} is at ${e.expectedSha.slice(0, 7)})`,
  )
  .join("; ");
const res = {
  ...result(
    summary,
    environments.flatMap((e) => e.problems),
  ),
  environments: environments.map(({ problems, ...e }) => e),
};
process.exit(report("env-status", res, { json }));
