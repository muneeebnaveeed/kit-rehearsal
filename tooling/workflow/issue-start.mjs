// `pnpm issue:start <n>`: starts work on an issue the way CLAUDE.md says. It checks the issue is open
// and carries your team's label, updates your team's base branch, creates `<label>/<n>-<slug>` from it
// and assigns you.
//
//   pnpm issue:start 14
//   --team <team>      your team for this run only (the first run asks and saves it; see team:set)
//   --slug <text>      the branch's short description (default: from the issue title)
//   --dry-run          check and print the plan; change nothing locally or on GitHub
//   --json             machine-readable output
//
// Exit codes: 0 started (or planned), 1 refused (wrong team, closed issue, branch exists, uncommitted
// changes...), 2 usage error (including no team and no terminal), 3 environment problem (git, gh).
import { execFileSync } from "node:child_process";
import { EXIT, parseArgs } from "./lib/args.mjs";
import { root } from "./lib/context.mjs";
import { currentUser, getIssueDetails } from "./lib/gh.mjs";
import { currentBranch, git } from "./lib/git.mjs";
import { planIssueStart } from "./lib/issue-start.mjs";
import { print, result } from "./lib/report.mjs";
import { teamBase } from "./lib/team.mjs";
import { getTeam, stop } from "./lib/team-io.mjs";
import { loadTypes } from "./lib/types.mjs";

const COMMAND = "issue:start";
const { flags, positional } = parseArgs(process.argv.slice(2), { boolean: ["json", "dry-run"] });
const json = flags.json === true;
const dryRun = flags["dry-run"] === true;
const str = (name) => (typeof flags[name] === "string" ? flags[name] : null);

if (positional.length !== 1 || !/^\d+$/.test(positional[0])) {
  stop(
    COMMAND,
    EXIT.usage,
    "usage: pnpm issue:start <issue-number> [--team <team>] [--slug <text>] [--dry-run] [--json]",
    json,
  );
}
const number = Number(positional[0]);
const { teamLabels } = loadTypes(root);
const { team, source } = await getTeam({ root, command: COMMAND, flag: str("team"), teamLabels, json });

/** @param {string[]} args */
const run = (args) => {
  try {
    return git(root, args);
  } catch (err) {
    stop(
      COMMAND,
      EXIT.environment,
      `git ${args[0]} failed: ${err.stderr?.toString().trim() || err.message}`,
      json,
    );
  }
};

const issue = getIssueDetails(number);
const user = currentUser();
const local = run(["for-each-ref", "--format=%(refname:short)", "refs/heads"]).split("\n");
const remote = run(["ls-remote", "--heads", "origin"])
  .split("\n")
  .map((l) => l.split("\trefs/heads/")[1])
  .filter(Boolean);
if (issue && !remote.includes(teamBase(team))) {
  stop(
    COMMAND,
    EXIT.environment,
    `origin has no ${teamBase(team)} branch yet. Ask your team or the platform team to create it.`,
    json,
  );
}
const dirty = run(["status", "--porcelain", "--untracked-files=no"]).trim() !== "";

const plan = planIssueStart({
  issue,
  team,
  teamLabels,
  user,
  slug: str("slug"),
  existingBranches: [...local, ...remote].filter(Boolean),
  dirty,
});
const warnings = [...plan.warnings];
if (source === "flag")
  warnings.push(`--team ${team} applies to this run only; your saved team is unchanged.`);

const { branch, base } = plan;
const alreadyAssigned = Boolean(user && issue?.assignees.includes(user));
const actions = plan.ok
  ? [
      `git fetch origin ${base}`,
      `update local ${base} to origin/${base} (fast-forward only)`,
      `git switch --no-track -c ${branch} origin/${base}`,
      alreadyAssigned
        ? `#${number} is already assigned to you`
        : `gh issue edit ${number} --add-assignee @me`,
    ]
  : [];

const finish = (summary) => {
  const res = {
    command: COMMAND,
    ...result(summary, plan.problems, warnings),
    team,
    teamSource: source,
    dryRun,
    issue: number,
    branch,
    base,
    actions,
  };
  if (!json && plan.ok) {
    console.log(`${dryRun ? "Would run" : "Ran"}:`);
    for (const a of actions) console.log(`  ${a}`);
  }
  process.exit(print(COMMAND, res, json));
};

if (!plan.ok) finish(`can't start #${number}`);
if (dryRun) finish(`dry run: would create ${branch} from origin/${base}`);

// Update the base branch, then branch from it.
run(["fetch", "origin", base]);
let hasLocalBase = true;
try {
  git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${base}`]);
} catch {
  hasLocalBase = false;
}
if (hasLocalBase) {
  try {
    if (currentBranch(root) === base) git(root, ["merge", "--ff-only", `origin/${base}`]);
    else git(root, ["fetch", "origin", `${base}:${base}`]);
  } catch (err) {
    // Not fatal: the new branch starts from origin/<base>, which was just fetched.
    warnings.push(
      `Local ${base} was not updated (${err.stderr?.toString().trim().split("\n")[0] || err.message}).`,
    );
  }
}
run(["switch", "--no-track", "-c", branch, `origin/${base}`]);

if (!alreadyAssigned) {
  try {
    execFileSync("gh", ["issue", "edit", String(number), "--add-assignee", "@me"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    stop(
      COMMAND,
      EXIT.environment,
      `Created ${branch}, but could not assign you to #${number}: ${err.stderr?.toString().trim() || err.message}. Run: gh issue edit ${number} --add-assignee @me`,
      json,
    );
  }
}
finish(`created ${branch} from origin/${base}`);
