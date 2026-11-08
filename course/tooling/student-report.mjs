// `node course/tooling/student-report.mjs`: per-student activity with a 1-5 score and a justification, from what
// is visible on GitHub (issues, PRs, commits, reviews). Reads the repository with the GitHub CLI, takes the PR
// documentation results from pr-report.mjs, then runs the rules in lib/student-report.mjs.
//
//   node course/tooling/student-report.mjs > .private/student-scores.md    Markdown report
//   node course/tooling/student-report.mjs --json                          machine-readable output
//   node course/tooling/student-report.mjs --repo owner/name               another repository than the current one
//   node course/tooling/student-report.mjs --roster path/to/teams.json     another roster than course/teams.json
//
// The output has individual scores and the repository is public: keep it in .private/ (ignored by git).
// Exit codes: 0 report written, 2 usage error, 3 environment problem (gh missing or not logged in).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT, parseArgs } from "../../tooling/workflow/lib/args.mjs";
import { loadTypes } from "../../tooling/workflow/lib/types.mjs";
import { collectContributions, withContributions } from "./lib/contribution.mjs";
import {
  collectStats,
  docsFromReport,
  formatStudentReport,
  parseRoster,
  rosterLogins,
  scoreAll,
} from "./lib/student-report.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const { flags, positional } = parseArgs(process.argv.slice(2), { boolean: ["json"] });
if (
  positional?.length ||
  (flags.repo !== undefined && typeof flags.repo !== "string") ||
  (flags.roster !== undefined && typeof flags.roster !== "string")
) {
  console.error("usage: node course/tooling/student-report.mjs [--json] [--repo owner/name] [--roster path]");
  process.exit(EXIT.usage);
}
const config = loadTypes(root);

// The roster (course/teams.json) says who is in which team. Without it, teams are guessed from labels.
const rosterPath =
  typeof flags.roster === "string" ? resolve(flags.roster) : resolve(root, "course/teams.json");
let roster = null;
if (typeof flags.roster === "string" || existsSync(rosterPath)) {
  try {
    roster = parseRoster(readFileSync(rosterPath, "utf8"));
  } catch (err) {
    console.error(`error: could not read the roster ${rosterPath}: ${err.message}`);
    process.exit(EXIT.usage);
  }
}

/** Runs a command and returns stdout, or exits with an environment error. */
function run(cmd, args, what) {
  try {
    return execFileSync(cmd, args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 });
  } catch (err) {
    console.error(
      `error: could not ${what} (GitHub CLI installed and logged in with "gh auth login"?): ${err.stderr?.toString().trim() || err.message}`,
    );
    process.exit(EXIT.environment);
  }
}

const graphql = (query, variables) => {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [k, v] of Object.entries(variables)) if (v !== null) args.push("-F", `${k}=${v}`);
  return JSON.parse(run("gh", args, "read from GitHub")).data;
};

/** Reads every page of a connection. */
function paginate(query, variables, pick) {
  const nodes = [];
  let cursor = null;
  do {
    const conn = pick(graphql(query, { ...variables, cursor }));
    nodes.push(...conn.nodes);
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (cursor);
  return nodes;
}

const repo =
  (typeof flags.repo === "string" && flags.repo) ||
  run(
    "gh",
    ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
    "find the repository",
  ).trim();
const [owner, name] = repo.split("/");
const logins = (conn) => conn.nodes.map((n) => n.author?.login ?? n.login).filter(Boolean);

const prs = paginate(
  `query($owner: String!, $name: String!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      pullRequests(first: 25, after: $cursor, orderBy: { field: CREATED_AT, direction: ASC }) {
        pageInfo { hasNextPage endCursor }
        nodes {
          number title headRefName state additions deletions
          author { login }
          mergedBy { login }
          labels(first: 20) { nodes { name } }
          reviews(first: 100) { nodes { author { login } } }
          comments(first: 100) { nodes { author { login } } }
          files(first: 100) { totalCount nodes { path additions } }
          commits(first: 100) { nodes { commit { oid message authors(first: 5) { nodes { user { login } } } } } }
        }
      }
    }
  }`,
  { owner, name },
  (d) => d.repository.pullRequests,
).map((p) => ({
  number: p.number,
  title: p.title,
  head: p.headRefName,
  state: p.state,
  additions: p.additions,
  deletions: p.deletions,
  author: p.author?.login ?? null,
  mergedBy: p.mergedBy?.login ?? null,
  labels: p.labels.nodes.map((l) => l.name),
  reviewers: logins(p.reviews),
  commenters: logins(p.comments),
  files: p.files.nodes,
  filesTruncated: p.files.totalCount > p.files.nodes.length,
  commits: p.commits.nodes.map(({ commit: c }) => ({
    oid: c.oid,
    message: c.message,
    authors: c.authors.nodes.map((a) => a.user?.login ?? null),
  })),
}));

const issues = paginate(
  `query($owner: String!, $name: String!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      issues(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          number title
          author { login }
          assignees(first: 10) { nodes { login } }
          labels(first: 20) { nodes { name } }
          comments(first: 100) { nodes { author { login } } }
        }
      }
    }
  }`,
  { owner, name },
  (d) => d.repository.issues,
).map((i) => ({
  number: i.number,
  title: i.title,
  author: i.author?.login ?? null,
  assignees: logins(i.assignees),
  labels: i.labels.nodes.map((l) => l.name),
  commenters: logins(i.comments),
}));

// PR documentation: the same rules as the PR documentation report.
const prReportOutput = run(
  process.execPath,
  [fileURLToPath(new URL("pr-report.mjs", import.meta.url)), "--state", "all", "--json", "--repo", repo],
  "run pr-report.mjs",
);
let prReport;
try {
  prReport = JSON.parse(prReportOutput);
} catch (err) {
  console.error(
    `error: pr-report.mjs --json did not print valid JSON (${prReportOutput.length} characters, truncated?): ${err.message}`,
  );
  process.exit(EXIT.environment);
}
const docs = docsFromReport(prReport);

// One login per line: stitching per-page JSON arrays together breaks on an empty page.
const members = run(
  "gh",
  ["api", `repos/${repo}/assignees`, "--paginate", "--jq", ".[].login"],
  "list collaborators",
)
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean);
// What each student's merged work added, with the share counted within the team.
const contributions = collectContributions(prs);
const rows = withContributions(
  scoreAll(
    collectStats({
      prs,
      issues,
      docs,
      teamLabels: config.teamLabels,
      members: [...members, ...rosterLogins(roster)],
    }),
    roster,
  ),
  contributions.people,
);

if (flags.json === true) {
  console.log(JSON.stringify({ repo, generatedAt: new Date().toISOString(), students: rows }, null, 2));
} else {
  const generatedAt = `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`;
  process.stdout.write(
    formatStudentReport(rows, {
      repo,
      generatedAt,
      prCount: prs.length,
      issueCount: issues.length,
      instructors: roster ? [...roster.instructors] : [],
      repeats: contributions.repeats,
      truncated: contributions.truncated,
    }),
  );
}
// exitCode, not process.exit(): on macOS and Linux stdout to a pipe is asynchronous, and exit() would cut it off.
process.exitCode = EXIT.ok;
