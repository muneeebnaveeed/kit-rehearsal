// `pnpm team:promote <N>`: opens the PR feature/team-N -> main, filled from the chore template, with
// the PRs merged into the feature branch since main last had it. It refers to the team's tracking issue
// with Refs #N. Merging needs green CI and a review like any other PR; with --auto-merge, GitHub merges
// it as soon as both are in place (the hourly promotion workflow uses it).
//
//   pnpm team:promote 2 --issue 40      open feature/team-2 -> main, referring to issue #40 (labelled platform)
//   <N>                                 team 1 to 4; defaults to --team, then git config kit.team
//   --team team-N                       the team, if <N> is not given
//   --issue <n>                         the platform issue the PR refers to (required)
//   --auto-merge                        turn on auto-merge once the PR is open
//   --dry-run                           check everything and print the PR, but don't open it
//   --json                              machine-readable output
//
// Exit codes: 0 opened (or would open), 1 refused (nothing to promote, PR already open, issue wrong),
// 2 usage error, 3 environment problem (git, gh).
import { parseArgs } from "./lib/args.mjs";
import { bodyProblems, issueProblems, parseMergedPrs, promotePr, resolveTeam } from "./lib/branch-prs.mjs";
import { issueFlag, progress, report, usageError } from "./lib/command.mjs";
import { root } from "./lib/context.mjs";
import {
  changedFiles,
  countCommits,
  createPr,
  enableAutoMerge,
  fetchOrigin,
  issue as getIssue,
  gitConfig,
  mergeLog,
  openPrs,
  predictConflicts,
  remoteBranchExists,
} from "./lib/remote.mjs";
import { result } from "./lib/report.mjs";
import { loadPrTemplates, loadTypes } from "./lib/types.mjs";

const USAGE = "pnpm team:promote <N> --issue <n> [--team team-N] [--auto-merge] [--dry-run] [--json]";
const { flags, positional } = parseArgs(process.argv.slice(2), {
  boolean: ["json", "dry-run", "auto-merge"],
});
const json = flags.json === true;
const dryRun = flags["dry-run"] === true;
if (positional.length > 1) usageError(`unexpected argument "${positional[1]}".`, USAGE);

const who = resolveTeam({
  positional: positional[0] ?? null,
  flag: typeof flags.team === "string" ? flags.team : null,
  configured: gitConfig("kit.team"),
});
if (who.error) usageError(who.error, USAGE);
const team = who.team;
const number = issueFlag(flags, USAGE);
const branch = `feature/${team}`;

const fail = (summary, problems, warnings = []) =>
  process.exit(report("promote", result(summary, problems, warnings), { json }));

if (!remoteBranchExists(branch)) {
  fail(`${branch} was not promoted`, [{ rule: "branch", message: `origin has no ${branch} branch.` }]);
}
progress(`Fetching main and ${branch}...`);
fetchOrigin(["main", branch]);
const ahead = countCommits(`origin/main..origin/${branch}`);
if (ahead === 0) {
  fail(`${branch} was not promoted`, [
    { rule: "nothing", message: `main already has everything on ${branch}.` },
  ]);
}
// A merged sync PR leaves a merge commit main lacks; promoting it alone would change nothing.
if (changedFiles(`origin/main...origin/${branch}`).length === 0) {
  fail(`${branch} was not promoted`, [
    { rule: "nothing", message: `${branch} only adds merges of main, with no changes of its own.` },
  ]);
}
const existing = openPrs(branch, "main");
if (existing.length > 0) {
  fail(`${branch} was not promoted`, [
    { rule: "already-open", message: `A PR from ${branch} into main is already open: ${existing[0].url}` },
  ]);
}
const linked = getIssue(number);
const issueProblemsFound = issueProblems(linked, { number, label: "platform", open: true });
if (issueProblemsFound.length > 0) fail(`${branch} was not promoted`, issueProblemsFound);

const warnings = [];
const behind = countCommits(`origin/${branch}..origin/main`);
if (behind > 0)
  warnings.push(
    `${branch} is ${behind} commit(s) behind main. Bring it up to date first: pnpm branches:sync ${team.slice(5)}.`,
  );
const predicted = predictConflicts("origin/main", `origin/${branch}`);
if (predicted === null) warnings.push("This git can't predict conflicts (needs git 2.38 or later).");

const config = loadTypes(root);
const templates = loadPrTemplates(root, config);
const draft = promotePr({
  templates,
  issue: /** @type {NonNullable<typeof linked>} */ (linked),
  team,
  ahead,
  behind,
  prs: parseMergedPrs(mergeLog(`origin/main..origin/${branch}`)),
  conflicts: predicted ?? [],
});
const drift = bodyProblems(draft, { config, templates });
if (drift.length > 0)
  fail("the drafted PR doesn't pass check:pr (has the template changed?)", drift, warnings);

if (dryRun) {
  const res = {
    ...result(`would open ${branch} -> main: ${draft.title}`, [], warnings),
    dryRun: true,
    pr: draft,
  };
  process.exit(report("promote", res, { json, drafts: [draft] }));
}
const url = createPr(draft);
if (flags["auto-merge"] === true) enableAutoMerge(url);
const res = { ...result(`opened ${url}`, [], warnings), url, pr: draft };
res.warnings.push(
  "Tick the remaining checklist items once you have checked them; pnpm check:pr fails until then.",
);
process.exit(report("promote", res, { json }));
