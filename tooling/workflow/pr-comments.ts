// `pnpm pr:comments`: collects what reviewers said on a PR, so you (or your agent) can answer every
// point without clicking through GitHub.
//
//   1. finds the PR: --pr <n>, else the current branch's
//   2. reads its review threads, reviews and discussion in one GitHub query
//   3. lists the open threads by file, the ones waiting on the author first, then the reviews and
//      the discussion; resolved threads are counted, not shown
//   4. saves the report in the git directory, .git/kit/pr-<n>/comments.md, and prints it
//
//   --pr <n>      the PR to read (default: the current branch's)
//   --all         also show resolved threads
//   --json        machine-readable output
//
// Exit codes: 0 nothing waiting on the author, 1 threads waiting on the author, 2 usage error,
// 3 environment problem (git, gh).
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { EXIT, parseArgs } from "./lib/args.mjs";
import { environmentError, root } from "./lib/context.mjs";
import { commentsMarkdown, normalize, type PrComments, QUERY, verdicts } from "./lib/pr-comments.ts";

const { flags } = parseArgs(process.argv.slice(2), { boolean: ["json", "all"] });
const json = flags.json === true;
const all = flags.all === true;
const pr = typeof flags.pr === "string" ? flags.pr : null;
if (flags.pr === true || (pr !== null && !/^\d+$/.test(pr))) {
  console.error("usage: pnpm pr:comments [--pr <number>] [--all] [--json]");
  process.exit(EXIT.usage);
}

function gh(args: string[], what: string): string {
  try {
    return execFileSync("gh", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 1 << 28,
    });
  } catch (err) {
    const e = err as { code?: string; stderr?: Buffer | string; message: string };
    if (e.code === "ENOENT") environmentError("the GitHub CLI (gh) isn't installed: https://cli.github.com");
    const stderr = e.stderr?.toString().trim() ?? "";
    if (/no pull requests found|Could not resolve to a PullRequest/i.test(stderr)) {
      console.error(
        `error: ${pr ? `PR #${pr} not found` : "the current branch has no PR"}. Pass --pr <number>.`,
      );
      process.exit(EXIT.usage);
    }
    environmentError(`gh failed on ${what} (logged in with "gh auth login"?): ${stderr || e.message}`);
    return "";
  }
}

const number = pr ?? JSON.parse(gh(["pr", "view", "--json", "number"], "the current branch's PR")).number;
const answer = JSON.parse(
  gh(
    [
      "api",
      "graphql",
      "-F",
      "owner={owner}",
      "-F",
      "name={repo}",
      "-F",
      `number=${number}`,
      "-f",
      `query=${QUERY}`,
    ],
    `PR #${number}`,
  ),
);
const comments: PrComments = normalize(answer.data.repository.pullRequest);
const markdown = commentsMarkdown(comments, { all });

let file = "";
try {
  file = path.resolve(
    root,
    execFileSync("git", ["rev-parse", "--git-path", `kit/pr-${comments.number}/comments.md`], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
  );
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, markdown);
} catch (err) {
  environmentError(`git failed: ${(err as Error).message}`);
}

const waiting = comments.threads.filter((t) => t.waitingOnAuthor).length;
if (json) {
  console.log(
    JSON.stringify(
      { ...comments, verdicts: verdicts(comments), waiting, file: path.relative(root, file) },
      null,
      2,
    ),
  );
} else {
  process.stdout.write(markdown);
  console.log(`\nSaved in ${path.relative(root, file)}.`);
}
process.exit(waiting > 0 ? EXIT.failed : EXIT.ok);
