// `pnpm branches:sync`: opens a PR from main into each feature/team-N that is behind it, filled from
// the sync template. A branch that is up to date, or already has an open sync PR, is left alone. It
// only opens PRs; the team reviews and merges them. With --auto-merge, GitHub merges a PR that merges
// cleanly once both are in place (the hourly pipeline uses it, one team at a time).
//
//   pnpm branches:sync --issue 33          every feature/team-N that is behind main
//   pnpm branches:sync 2 4 --issue 33      only feature/team-2 and feature/team-4
//   --issue <n>                            the issue the PRs refer to (Refs #n, labelled platform; required)
//   --auto-merge                           turn on auto-merge for each PR that shows no conflicts
//   --dry-run                              check everything and print the PRs, but don't open them
//   --json                                 machine-readable output
//
// Exit codes: 0 every branch is up to date or has a PR, 1 a problem (issue wrong, PR not valid),
// 2 usage error, 3 environment problem (git, gh).
import { parseArgs } from "./lib/args.mjs";
import {
  bodyProblems,
  issueProblems,
  parseMergedPrs,
  resolveTeam,
  syncAutoMerge,
  syncPr,
} from "./lib/branch-prs.mjs";
import { issueFlag, progress, report, usageError } from "./lib/command.mjs";
import { root } from "./lib/context.mjs";
import {
  countCommits,
  createPr,
  enableAutoMerge,
  fetchOrigin,
  issue as getIssue,
  gitOrExit,
  mergeLog,
  openPrs,
  predictConflicts,
} from "./lib/remote.mjs";
import { result } from "./lib/report.mjs";
import { loadPrTemplates, loadTypes } from "./lib/types.mjs";

const USAGE = "pnpm branches:sync [<N>...] --issue <n> [--auto-merge] [--dry-run] [--json]";
const { flags, positional } = parseArgs(process.argv.slice(2), {
  boolean: ["json", "dry-run", "auto-merge"],
});
const json = flags.json === true;
const dryRun = flags["dry-run"] === true;

/** @type {string[]} */
const teams = [];
for (const arg of positional.length > 0 ? positional : ["1", "2", "3", "4"]) {
  const r = resolveTeam({ positional: arg });
  if (r.error) usageError(r.error, USAGE);
  if (!teams.includes(r.team)) teams.push(r.team);
}
const number = issueFlag(flags, USAGE);

const linked = getIssue(number);
const issueFound = issueProblems(linked, { number, label: "platform" });
if (issueFound.length > 0)
  process.exit(report("branches-sync", result("no PRs were opened", issueFound), { json }));
const issue = /** @type {NonNullable<typeof linked>} */ (linked);

const onOrigin = new Set(
  gitOrExit(["ls-remote", "--heads", "origin", "refs/heads/feature/team-*"])
    .split("\n")
    .map((l) => l.split("\trefs/heads/")[1])
    .filter(Boolean),
);
const present = teams.filter((t) => onOrigin.has(`feature/${t}`));
progress(`Fetching main and ${present.map((t) => `feature/${t}`).join(", ") || "no feature branches"}...`);
fetchOrigin(["main", ...present.map((t) => `feature/${t}`)]);

const config = loadTypes(root);
const templates = loadPrTemplates(root, config);
/** @type {import("./lib/report.mjs").Problem[]} */
const problems = [];
/** @type {string[]} */
const warnings = [];
/** @type {{ branch: string, status: string, behind?: number, conflicts?: string[], url?: string, autoMerge?: boolean }[]} */
const branches = [];
/** @type {ReturnType<typeof syncPr>[]} */
const drafts = [];

for (const team of teams) {
  const branch = `feature/${team}`;
  if (!present.includes(team)) {
    warnings.push(`origin has no ${branch}; skipped.`);
    branches.push({ branch, status: "missing" });
    continue;
  }
  const behind = countCommits(`origin/${branch}..origin/main`);
  if (behind === 0) {
    branches.push({ branch, status: "up-to-date", behind });
    continue;
  }
  const existing = openPrs("main", branch);
  if (existing.length > 0) {
    branches.push({ branch, status: "already-open", behind, url: existing[0].url });
    continue;
  }
  const predicted = predictConflicts(`origin/${branch}`, "origin/main");
  if (predicted === null) warnings.push(`Can't predict conflicts for ${branch} (needs git 2.38 or later).`);
  const conflicts = predicted ?? [];
  const draft = syncPr({
    templates,
    issue,
    team,
    behind,
    prs: parseMergedPrs(mergeLog(`origin/${branch}..origin/main`)),
    conflicts,
  });
  const drift = bodyProblems(draft, { config, templates });
  if (drift.length > 0) {
    problems.push(...drift.map((p) => ({ ...p, message: `${branch}: ${p.message}` })));
    branches.push({ branch, status: "invalid", behind });
    continue;
  }
  if (dryRun) {
    drafts.push(draft);
    branches.push({ branch, status: "would-open", behind, conflicts });
  } else {
    const url = createPr(draft);
    const autoMerge = flags["auto-merge"] === true && syncAutoMerge(predicted);
    if (autoMerge) enableAutoMerge(url);
    else if (flags["auto-merge"] === true)
      warnings.push(`${branch}: auto-merge is off because the merge may conflict; someone must resolve it.`);
    branches.push({ branch, status: "opened", behind, conflicts, url, autoMerge });
  }
}

const describe = (b) =>
  `${b.branch}: ${b.status}${b.url ? ` ${b.url}` : ""}${b.behind ? ` (${b.behind} behind)` : ""}`;
const res = { ...result(branches.map(describe).join("; "), problems, warnings), dryRun, branches };
process.exit(report("branches-sync", res, { json, drafts }));
