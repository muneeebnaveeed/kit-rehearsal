// `pnpm pr:ci-logs`: downloads the logs of the checks failing on a PR, so you (or your agent) read
// the error instead of clicking through GitHub.
//
//   1. finds the PR: --pr <n>, else the current branch's
//   2. takes the latest run of every check and keeps the failing ones
//   3. downloads each failing job's log, without timestamps and colour codes
//   4. saves the logs and a summary (the error lines of each log) in the git directory,
//      .git/kit/pr-<n>/ci/, and prints the summary
//
//   --pr <n>      the PR to read (default: the current branch's)
//   --json        machine-readable output
//
// Exit codes: 0 nothing failing, 1 failing checks found, 2 usage error, 3 environment problem (git, gh).
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { EXIT, parseArgs } from "./lib/args.mjs";
import {
  type Check,
  cleanLog,
  excerpt,
  failingChecks,
  type JobReport,
  logFileName,
  summaryMarkdown,
} from "./lib/ci-logs.ts";
import { environmentError, root } from "./lib/context.mjs";

const { flags } = parseArgs(process.argv.slice(2), { boolean: ["json"] });
const json = flags.json === true;
const pr = typeof flags.pr === "string" ? flags.pr : null;
if (flags.pr === true || (pr !== null && !/^\d+$/.test(pr))) {
  console.error("usage: pnpm pr:ci-logs [--pr <number>] [--json]");
  process.exit(EXIT.usage);
}

/** Runs gh. `allowFail` keeps stdout of commands that exit non-zero on purpose (gh pr checks). */
function gh(args: string[], what: string, allowFail = false): string {
  try {
    return execFileSync("gh", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 1 << 28,
    });
  } catch (err) {
    const e = err as {
      code?: string;
      status?: number;
      stdout?: string;
      stderr?: Buffer | string;
      message: string;
    };
    if (e.code === "ENOENT") environmentError("the GitHub CLI (gh) isn't installed: https://cli.github.com");
    if (allowFail && e.stdout) return e.stdout;
    const stderr = e.stderr?.toString().trim() ?? "";
    // Newer gh refuses to print colour codes unless asked; older gh doesn't know the flag.
    if (/--allow-escape-sequences/.test(stderr))
      return gh([...args, "--allow-escape-sequences"], what, allowFail);
    if (/no pull requests found|Could not resolve to a PullRequest/i.test(stderr)) {
      console.error(
        `error: ${pr ? `PR #${pr} not found` : "the current branch has no PR"}. Pass --pr <number>.`,
      );
      process.exit(EXIT.usage);
    }
    throw new Error(`gh failed on ${what}: ${stderr || e.message}`);
  }
}

// Assigned in the try; environmentError exits.
let report!: {
  pr: { number: number; url: string };
  jobs: JobReport[];
  external: ReturnType<typeof failingChecks>["external"];
  dir: string;
};
try {
  const view = JSON.parse(gh(["pr", "view", ...(pr ? [pr] : []), "--json", "number,url"], "the PR"));
  const checks: Check[] = JSON.parse(
    gh(
      ["pr", "checks", String(view.number), "--json", "name,state,bucket,link,workflow,startedAt"],
      "the PR's checks",
      true,
    ) || "[]",
  );
  const { jobs, external } = failingChecks(checks);

  const dir = path.resolve(
    root,
    execFileSync("git", ["rev-parse", "--git-path", `kit/pr-${view.number}/ci`], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
  );
  mkdirSync(dir, { recursive: true });
  for (const old of readdirSync(dir)) rmSync(path.join(dir, old));

  const reports: JobReport[] = jobs.map((job) => {
    try {
      const lines = cleanLog(
        gh(["api", `repos/{owner}/{repo}/actions/jobs/${job.jobId}/logs`], `the log of ${job.name}`),
      );
      const file = path.join(dir, logFileName(job));
      writeFileSync(file, lines.join("\n"));
      return { job, file: path.relative(root, file), excerpt: excerpt(lines), error: null };
    } catch (err) {
      return { job, file: null, excerpt: [], error: (err as Error).message };
    }
  });
  report = {
    pr: { number: view.number, url: view.url },
    jobs: reports,
    external,
    dir: path.relative(root, dir),
  };
  writeFileSync(path.join(dir, "summary.md"), summaryMarkdown(report.pr, reports, external));
} catch (err) {
  environmentError(`${(err as Error).message} (logged in with "gh auth login"?)`);
}

const failing = report.jobs.length + report.external.length;
if (json) {
  console.log(JSON.stringify({ ...report, failing }, null, 2));
} else {
  process.stdout.write(summaryMarkdown(report.pr, report.jobs, report.external));
  if (failing > 0) console.log(`Saved in ${report.dir}/ (summary.md and one .log per job).`);
}
process.exit(failing > 0 ? EXIT.failed : EXIT.ok);
