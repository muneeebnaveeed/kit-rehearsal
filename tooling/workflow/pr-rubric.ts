// `pnpm pr:rubric`: scores a pull request on what a script can judge (tests, How to test, screenshots,
// summary, size, root cause) and says how to earn each missing point. Advice only, never a required
// check. Run on every PR by .github/workflows/pr-rubric.yml.
//
//   pnpm pr:rubric --number 61              print the rubric
//   --json                                  machine-readable output
//   --comment                               post it as one PR comment, updated in place on later runs
//
// Reads the PR through the GitHub CLI (GH_TOKEN in CI). Never checks out or runs a PR's code.
// Exit codes: 0 done (whatever the score), 2 usage error, 3 environment problem (gh).
import { execFileSync } from "node:child_process";
import { EXIT, parseArgs } from "./lib/args.mjs";
import { environmentError, root } from "./lib/context.mjs";
import { MARKER, type PrFile, rubricMarkdown, scoreRubric } from "./lib/rubric.ts";
import { loadTypes } from "./lib/types.mjs";

const { flags } = parseArgs(process.argv.slice(2), { boolean: ["json", "comment"] });
const number = typeof flags.number === "string" ? flags.number : null;
if (!number || !/^\d+$/.test(number)) {
  console.error("usage: pnpm pr:rubric --number <n> [--json] [--comment]");
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
      console.error(`error: PR #${number} not found.`);
      process.exit(EXIT.usage);
    }
    environmentError(`gh failed on ${what} (logged in with "gh auth login"?): ${stderr || e.message}`);
    return "";
  }
}

const pr = JSON.parse(
  gh(["pr", "view", number, "--json", "title,body,headRefName,baseRefName,files,commits"], `PR #${number}`),
) as {
  title: string;
  body: string | null;
  headRefName: string;
  baseRefName: string;
  files: PrFile[] | null;
  commits: unknown[] | null;
};

const result = scoreRubric({
  title: pr.title,
  body: pr.body,
  head: pr.headRefName,
  base: pr.baseRefName,
  files: pr.files ?? [],
  commits: pr.commits?.length ?? 0,
  config: loadTypes(root),
});
const markdown = rubricMarkdown(result);

let commentUrl: string | null = null;
if (flags.comment === true) {
  const repo =
    process.env.GITHUB_REPOSITORY ??
    JSON.parse(gh(["repo", "view", "--json", "nameWithOwner"], "the repository")).nameWithOwner;
  const comments = JSON.parse(
    gh(
      ["api", "--paginate", "--slurp", `repos/${repo}/issues/${number}/comments?per_page=100`],
      "the PR's comments",
    ),
  ) as { id: number; body: string; html_url: string }[][];
  const existing = comments.flat().find((c) => c.body.startsWith(MARKER));
  if (existing?.body.trim() === markdown.trim()) {
    commentUrl = existing.html_url;
  } else {
    const path = existing
      ? `repos/${repo}/issues/comments/${existing.id}`
      : `repos/${repo}/issues/${number}/comments`;
    const out = gh(
      ["api", "-X", existing ? "PATCH" : "POST", path, "-f", `body=${markdown}`],
      "the rubric comment",
    );
    commentUrl = JSON.parse(out).html_url;
  }
}

if (flags.json === true) {
  console.log(JSON.stringify({ number: Number(number), ...result, commentUrl }, null, 2));
} else {
  console.log(markdown.replace(`${MARKER}\n\n`, ""));
  if (commentUrl) console.log(`comment: ${commentUrl}`);
}
process.exit(EXIT.ok);
