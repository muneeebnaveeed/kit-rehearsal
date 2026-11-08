// `pnpm labels:prs`: keeps every pull request's status labels up to date: stackpile and one waiting-on.*
// label (see "Labels"
// in CLAUDE.md). Run every 10 minutes by .github/workflows/pr-labels.yml, and on PR and review events.
//
//   pnpm labels:prs                 update every open PR, and clear status labels from closed ones
//   pnpm labels:prs --number 61     one PR only
//   --dry-run                       print the changes without making them
//   --json                          machine-readable output
//
// Reads PRs through the GitHub CLI (GH_TOKEN in CI). Never checks out or runs a PR's code.
// Exit codes: 0 done (or skipped: labels missing, run pnpm labels:sync --apply), 2 usage error,
// 3 environment problem (gh).
import { execFileSync } from "node:child_process";
import { EXIT, parseArgs } from "./lib/args.mjs";
import { environmentError, root } from "./lib/context.mjs";
import { labelsOf, loadLabels } from "./lib/labels.mjs";
import { labelChanges } from "./lib/pr-labels.mjs";

const { flags } = parseArgs(process.argv.slice(2), { boolean: ["dry-run", "json"] });
const dryRun = flags["dry-run"] === true;
const json = flags.json === true;
const single = typeof flags.number === "string" ? Number(flags.number) : null;
if (single !== null && !Number.isInteger(single)) {
  console.error("usage: pnpm labels:prs [--number <n>] [--dry-run] [--json]");
  process.exit(EXIT.usage);
}

/** @param {string[]} args */
function gh(args) {
  try {
    return execFileSync("gh", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    if (err.code === "ENOENT")
      environmentError("the GitHub CLI (gh) isn't installed: https://cli.github.com");
    environmentError(
      `gh ${args.slice(0, 2).join(" ")} failed: ${err.stderr?.toString().trim() || err.message}`,
    );
  }
}

const repo =
  process.env.GITHUB_REPOSITORY ?? JSON.parse(gh(["repo", "view", "--json", "nameWithOwner"])).nameWithOwner;
const [owner, name] = repo.split("/");

const FIELDS = `number state isDraft baseRefName
  author { login }
  labels(first: 50) { nodes { name } }
  reviews(last: 100) { nodes { state author { login } } }
  reviewThreads(first: 100) { nodes { isResolved } }`;

/** @param {any} node @returns {import("./lib/pr-labels.mjs").PullRequest} */
const toPr = (node) => ({
  number: node.number,
  state: node.state,
  isDraft: node.isDraft,
  author: node.author?.login ?? null,
  base: node.baseRefName,
  labels: node.labels.nodes.map((l) => l.name),
  reviews: node.reviews.nodes.map((r) => ({ author: r.author?.login ?? null, state: r.state })),
  unresolvedThreads: node.reviewThreads.nodes.filter((t) => !t.isResolved).length,
});

/** @param {string} query GraphQL with $owner and $name @param {string[]} extra */
const graphql = (query, extra = []) =>
  JSON.parse(
    gh(["api", "graphql", "-f", `query=${query}`, "-F", `owner=${owner}`, "-F", `name=${name}`, ...extra]),
  );

/** Every PR in the given states, 100 at a time. @param {string} states e.g. "[OPEN]" */
function listPrs(states) {
  const prs = [];
  let cursor = null;
  do {
    const query = `query($owner: String!, $name: String!, $cursor: String) {
      repository(owner: $owner, name: $name) {
        pullRequests(states: ${states}, first: 50, after: $cursor, orderBy: { field: CREATED_AT, direction: DESC }) {
          pageInfo { hasNextPage endCursor }
          nodes { ${FIELDS} }
        }
      }
    }`;
    const data = graphql(query, cursor ? ["-f", `cursor=${cursor}`] : []);
    const page = data.data.repository.pullRequests;
    prs.push(...page.nodes.map(toPr));
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);
  return prs;
}

/** @param {number} number */
function getPr(number) {
  const query = `query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) { pullRequest(number: $number) { ${FIELDS} } }
  }`;
  const node = graphql(query, ["-F", `number=${number}`]).data.repository.pullRequest;
  if (!node) {
    console.error(`error: PR #${number} not found`);
    process.exit(EXIT.usage);
  }
  return toPr(node);
}

const statusLabels = labelsOf(loadLabels(root), "status");

// The labels must exist; creating them is labels:sync's job. Until an admin has run it (a fresh repo from
// the template), skip quietly instead of failing every 10 minutes.
const existing = new Set(
  JSON.parse(gh(["label", "list", "--limit", "500", "--json", "name"])).map((l) => l.name),
);
const missing = statusLabels.filter((l) => !existing.has(l));
if (missing.length > 0) {
  const message = `labels missing on GitHub: ${missing.join(", ")}. Run: pnpm labels:sync --apply`;
  if (!dryRun) {
    console.log(process.env.GITHUB_ACTIONS ? `::notice::Skipped: ${message}` : `skipped: ${message}`);
    process.exit(EXIT.ok);
  }
  console.error(`warning: ${message}`);
}

let prs;
if (single !== null) {
  prs = [getPr(single)];
} else {
  // Closed PRs only need work while they still carry a status label.
  const closed = listPrs("[CLOSED, MERGED]").filter((p) => p.labels.some((l) => statusLabels.includes(l)));
  prs = [...listPrs("[OPEN]"), ...closed];
}

const results = [];
for (const pr of prs) {
  const { add, remove } = labelChanges(pr, statusLabels);
  if (add.length === 0 && remove.length === 0) continue;
  results.push({ number: pr.number, add, remove });
  if (dryRun) continue;
  if (add.length > 0) {
    gh([
      "api",
      "-X",
      "POST",
      `repos/${repo}/issues/${pr.number}/labels`,
      ...add.flatMap((l) => ["-f", `labels[]=${l}`]),
    ]);
  }
  for (const label of remove) {
    gh(["api", "-X", "DELETE", `repos/${repo}/issues/${pr.number}/labels/${encodeURIComponent(label)}`]);
  }
}

if (json) {
  console.log(JSON.stringify({ dryRun, checked: prs.length, changed: results }, null, 2));
} else {
  for (const r of results) {
    const parts = [...r.add.map((l) => `+${l}`), ...r.remove.map((l) => `-${l}`)];
    console.log(`${dryRun ? "would update" : "updated"} #${r.number}: ${parts.join(" ")}`);
  }
  console.log(`${results.length} of ${prs.length} PR(s) ${dryRun ? "would change" : "changed"}.`);
}
process.exit(EXIT.ok);
