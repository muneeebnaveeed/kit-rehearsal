// `pnpm issues:close-shipped --number <promotion>`: closes the issues a merged promotion (feature/team-N
// into main) shipped. Run by .github/workflows/close-shipped-issues.yml when a promotion merges.
//
//   1. reads the promotion's commits and picks out the work PRs whose merge commits it carries
//   2. reads each of those PRs' "Closes #N" (also Fixes, Resolves)
//   3. closes every one of those issues that is still open, with a comment naming the promotion
//
//   --dry-run     print what it would close, close nothing
//   --json        machine-readable output
//
// Reads through the GitHub CLI (GH_TOKEN in CI). Never checks out or runs a PR's code.
// Exit codes: 0 done (also when there was nothing to close), 1 not a merged promotion, 2 usage error,
// 3 environment problem (gh).
import { execFileSync } from "node:child_process";
import { EXIT, parseArgs } from "./lib/args.mjs";
import {
  isPromotion,
  mergedPrNumbers,
  shippedComment,
  shippedIssues,
  type WorkPr,
} from "./lib/close-shipped.ts";
import { environmentError, root } from "./lib/context.mjs";

const { flags } = parseArgs(process.argv.slice(2), { boolean: ["json", "dry-run"] });
const number = typeof flags.number === "string" ? flags.number : null;
if (!number || !/^\d+$/.test(number)) {
  console.error("usage: pnpm issues:close-shipped --number <n> [--dry-run] [--json]");
  process.exit(EXIT.usage);
}
const dryRun = flags["dry-run"] === true;

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
    environmentError(
      `gh failed on ${what} (logged in with "gh auth login"?): ${e.stderr?.toString().trim() || e.message}`,
    );
    return "";
  }
}

interface PrView {
  number: number;
  headRefName: string;
  baseRefName: string;
  state: string;
  body: string | null;
}
const view = (n: number | string) =>
  JSON.parse(
    gh(["pr", "view", String(n), "--json", "number,headRefName,baseRefName,state,body"], `PR #${n}`),
  ) as PrView;

const promotion = view(number);
if (
  !isPromotion({ head: promotion.headRefName, base: promotion.baseRefName }) ||
  promotion.state !== "MERGED"
) {
  console.error(`#${number} is not a merged promotion (feature/team-N into main); nothing to close.`);
  process.exit(EXIT.failed);
}

// The REST list returns up to 250 commits, more than a promotion every hour carries.
const subjects = gh(
  [
    "api",
    "--paginate",
    `repos/{owner}/{repo}/pulls/${number}/commits`,
    "--jq",
    '.[].commit.message | split("\\n")[0]',
  ],
  `the commits of #${number}`,
)
  .split("\n")
  .filter(Boolean);
const prs: WorkPr[] = mergedPrNumbers(subjects).map((n) => {
  const p = view(n);
  return {
    number: p.number,
    base: p.baseRefName,
    head: p.headRefName,
    merged: p.state === "MERGED",
    body: p.body,
  };
});
const shipped = shippedIssues(promotion.headRefName, prs);

const closed: { issue: number; pr: number }[] = [];
const alreadyClosed: number[] = [];
for (const [issue, pr] of shipped) {
  const state = gh(
    ["issue", "view", String(issue), "--json", "state", "--jq", ".state"],
    `issue #${issue}`,
  ).trim();
  if (state !== "OPEN") {
    alreadyClosed.push(issue);
    continue;
  }
  if (!dryRun) {
    gh(
      [
        "issue",
        "close",
        String(issue),
        "--reason",
        "completed",
        "--comment",
        shippedComment(Number(number), pr),
      ],
      `closing #${issue}`,
    );
  }
  closed.push({ issue, pr });
}

if (flags.json) {
  console.log(
    JSON.stringify(
      { promotion: Number(number), dryRun, prs: prs.map((p) => p.number), closed, alreadyClosed },
      null,
      2,
    ),
  );
} else {
  const verb = dryRun ? "would close" : "closed";
  console.log(`#${number} carried ${prs.length} PR(s): ${verb} ${closed.length} issue(s).`);
  for (const c of closed) console.log(`  #${c.issue} (from #${c.pr})`);
  if (alreadyClosed.length) console.log(`  already closed: ${alreadyClosed.map((n) => `#${n}`).join(", ")}`);
}
