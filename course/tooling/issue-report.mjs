// `node course/tooling/issue-report.mjs`: lists, per team, which issues break the naming and labelling
// rules (exactly one team label, and no `[team-2]` prefix in the title), and why. Reads
// the issues from GitHub with the GitHub CLI, then runs the rules in lib/issue-report.mjs, which reuse
// `pnpm check:issue`.
//
//   node course/tooling/issue-report.mjs                        every issue (open and closed), as Markdown
//   node course/tooling/issue-report.mjs --state open           only open issues (also: closed, all)
//   node course/tooling/issue-report.mjs --team team-2           only one team
//   node course/tooling/issue-report.mjs --failing               leave out the passing issues
//   node course/tooling/issue-report.mjs --json                  machine-readable output
//   node course/tooling/issue-report.mjs --repo owner/name       another repository than the current one
//
//   node course/tooling/issue-report.mjs --fix                  dry run: shows how each failing issue would be fixed
//   node course/tooling/issue-report.mjs --fix --apply          fixes the issues on GitHub and comments what is left
//
// --fix removes a title prefix, and adds the team it names as the label when the issue has none
// (see lib/issue-fix.mjs). The rest goes into one comment per issue.
//
// Exit codes: 0 done, 1 some fixes failed, 2 usage error, 3 environment problem (gh missing or not
// logged in).
import { fileURLToPath } from "node:url";
import { EXIT, parseArgs } from "../../tooling/workflow/lib/args.mjs";
import { loadTypes } from "../../tooling/workflow/lib/types.mjs";
import { runFixes } from "./lib/fix-runner.mjs";
import { currentRepo, paginate } from "./lib/github.mjs";
import { ISSUE_COMMENT_MARKER, planIssueFix } from "./lib/issue-fix.mjs";
import { auditIssue, formatReport, groupByTeam } from "./lib/issue-report.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const { flags } = parseArgs(process.argv.slice(2), { boolean: ["json", "failing", "fix", "apply"] });
const str = (name) => (typeof flags[name] === "string" ? flags[name] : null);

const STATES = { open: ["OPEN"], closed: ["CLOSED"], all: ["OPEN", "CLOSED"] };
const state = str("state") ?? "all";
const config = loadTypes(root);
const team = str("team");
if (!STATES[state] || (team && !config.teamLabels.includes(team)) || (flags.apply && !flags.fix)) {
  console.error(
    `usage: node course/tooling/issue-report.mjs [--state ${Object.keys(STATES).join("|")}] [--team ${config.teamLabels.join("|")}] [--failing] [--json] [--repo owner/name] [--fix [--apply]]`,
  );
  process.exit(EXIT.usage);
}

const repo = str("repo") ?? currentRepo(root);
const [owner, name] = repo.split("/");

const nodes = paginate(
  root,
  `query($owner: String!, $name: String!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      issues(first: 100, after: $cursor, states: [${STATES[state].join(", ")}], orderBy: { field: CREATED_AT, direction: DESC }) {
        pageInfo { hasNextPage endCursor }
        nodes {
          number title url state
          author { login }
          labels(first: 30) { nodes { name } }
          comments(last: 50) { nodes { id databaseId body viewerDidAuthor isMinimized } }
        }
      }
    }
  }`,
  { owner, name },
  (d) => d.repository.issues,
);

const entries = nodes.map((i) => {
  const issue = {
    number: i.number,
    title: i.title,
    url: i.url,
    state: i.state,
    author: i.author?.login ?? "ghost",
    labels: i.labels.nodes.map((l) => l.name),
  };
  const ownComment = i.comments.nodes.find((c) => c.viewerDidAuthor && c.body.includes(ISSUE_COMMENT_MARKER));
  return { issue, result: auditIssue({ issue, config }), ownComment };
});
const selected = team ? entries.filter((e) => e.result.team === team) : entries;

if (flags.fix === true) {
  const items = selected
    .filter((e) => !e.result.ok || e.ownComment)
    .map((e) => ({
      plan: planIssueFix({ issue: e.issue, config, hadComment: Boolean(e.ownComment) }),
      ownComment: e.ownComment,
    }));
  const { failed } = runFixes({ root, repo, kind: "issue", apply: flags.apply === true, items });
  // exitCode, not process.exit(): on macOS and Linux stdout to a pipe is asynchronous, and exit() would cut it off.
  process.exitCode = failed > 0 ? EXIT.failed : EXIT.ok;
} else {
  const results = selected.map((e) => e.result);
  const failingOnly = flags.failing === true;
  const groups = groupByTeam(results, config.teamLabels)
    .map((g) => (failingOnly ? { ...g, passing: [] } : g))
    .filter((g) => !failingOnly || g.failCount > 0);

  if (flags.json === true) {
    console.log(
      JSON.stringify({ repo, state, generatedAt: new Date().toISOString(), teams: groups }, null, 2),
    );
  } else {
    const generatedAt = `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`;
    process.stdout.write(formatReport(groups, { repo, state, generatedAt, failingOnly }));
  }
  process.exitCode = EXIT.ok;
}
