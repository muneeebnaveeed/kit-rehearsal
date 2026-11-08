// `pnpm pipeline promote|sync <team-N>`: one step of the hourly pipeline (.github/workflows/pipeline.yml).
//
//   1. finds the step's tracking issue ("[team-N] Promotions from feature/team-N", or
//      "[platform] Syncs from main into feature/team-N"), and opens it when it doesn't exist yet
//   2. runs pnpm team:promote, or pnpm branches:sync for that one team, with that issue and --auto-merge
//   3. reports what happened on the run's summary page: opened, opened without auto-merge (a sync that
//      conflicts), skipped (nothing new, a PR already open, the branch missing) or failed
//
// GitHub only merges what it opens once a person approves and every required check passes.
// Exit codes: 0 opened or skipped, 1 failed, 2 usage error, 3 environment problem (gh).
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { EXIT, parseArgs } from "./lib/args.mjs";
import { environmentError, root } from "./lib/context.mjs";
import { outcome, type Step, summaryLine, syncOutcome, trackingIssue } from "./lib/pipeline.ts";

const USAGE = "pnpm pipeline promote|sync <team-N>";
const { positional } = parseArgs(process.argv.slice(2));
const [kind, team] = positional;
let step: Step;
if ((kind === "promote" || kind === "sync") && team && /^team-[1-4]$/.test(team)) step = { kind, team };
else {
  console.error(`usage: ${USAGE}`);
  process.exit(EXIT.usage);
}

const gh = (args: string[]): string => {
  try {
    return execFileSync("gh", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    const e = err as { code?: string; stderr?: Buffer | string; message: string };
    if (e.code === "ENOENT") environmentError("the GitHub CLI (gh) isn't installed: https://cli.github.com");
    environmentError(`gh failed (is GH_TOKEN set?): ${e.stderr?.toString().trim() || e.message}`);
    return "";
  }
};

const wanted = trackingIssue(step);
const found = JSON.parse(
  gh([
    "issue",
    "list",
    "--state",
    "open",
    "--label",
    wanted.label,
    "--search",
    `"${wanted.title}" in:title`,
    "--json",
    "number,title",
  ]),
) as { number: number; title: string }[];
let issue = found.find((i) => i.title === wanted.title)?.number;
if (!issue) {
  const url = gh([
    "issue",
    "create",
    "--title",
    wanted.title,
    "--label",
    wanted.label,
    "--body",
    wanted.body,
  ]).trim();
  issue = Number(url.split("/").pop());
}

const args = [
  step.kind === "sync" ? "tooling/workflow/branches-sync.mjs" : "tooling/workflow/team-promote.mjs",
  step.team.slice(5),
  "--issue",
  String(issue),
  "--auto-merge",
  "--json",
];
const run = spawnSync(process.execPath, args, {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});
let report = null;
try {
  report = JSON.parse(run.stdout);
} catch {
  // a crash prints no JSON; the exit code says enough
}
const result = (step.kind === "sync" ? syncOutcome : outcome)(run.status ?? EXIT.environment, report);
const line = summaryLine(step, result);
console.log(line);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
process.exit(result.status === "failed" ? EXIT.failed : EXIT.ok);
