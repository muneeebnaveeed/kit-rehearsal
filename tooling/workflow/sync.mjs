// `pnpm sync`: merges the current branch's base into it (team work: feature/team-N; platform and
// instructor work: main) and reports conflicts. It never resolves a conflict, never rebases, never
// pushes and never force-pushes. A conflicted merge is left in progress for you to finish or abort.
//
//   pnpm sync                   fetch the base and merge origin/<base> into the current branch
//   --base <branch>             merge this base instead of the one the branch model expects
//   --dry-run                   only say what the merge would do (and predict conflicts)
//   --json                      machine-readable output
//
// Exit codes: 0 up to date or merged, 1 conflicts or uncommitted changes, 2 usage error (e.g. on main),
// 3 environment problem (git).
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "./lib/args.mjs";
import { report, usageError } from "./lib/command.mjs";
import { root } from "./lib/context.mjs";
import { currentBranch, git } from "./lib/git.mjs";
import { countCommits, fetchOrigin, gitOrExit, predictConflicts } from "./lib/remote.mjs";
import { parseConflictNames, syncBaseFor, syncResult } from "./lib/sync.mjs";
import { loadTypes } from "./lib/types.mjs";

const USAGE = "pnpm sync [--base <branch>] [--dry-run] [--json]";
const { flags, positional } = parseArgs(process.argv.slice(2), { boolean: ["json", "dry-run"] });
const json = flags.json === true;
const dryRun = flags["dry-run"] === true;
if (positional.length > 0) usageError(`unexpected argument "${positional[0]}".`, USAGE);
if (flags.base === true) usageError("--base needs a branch name.", USAGE);

const { teamLabels } = loadTypes(root);
let branch;
try {
  branch = currentBranch(root);
} catch (err) {
  usageError(`not in a git repository: ${err.message}`, USAGE);
}
const plan = syncBaseFor(branch, teamLabels, typeof flags.base === "string" ? flags.base : null);
if (plan.error) usageError(plan.error, USAGE);
const base = plan.base;

const dirty = gitOrExit(["status", "--porcelain", "--untracked-files=no"])
  .split("\n")
  .filter(Boolean)
  .map((l) => l.slice(3));
const mergeHead = resolve(root, gitOrExit(["rev-parse", "--git-path", "MERGE_HEAD"]).trim());
const mergeInProgress = existsSync(mergeHead);
if (dirty.length > 0 || mergeInProgress) {
  process.exit(
    report("sync", syncResult({ branch, base, behind: 0, conflicts: [], dryRun, dirty, mergeInProgress }), {
      json,
    }),
  );
}

fetchOrigin([base]);
const ref = `origin/${base}`;
const behind = countCommits(`HEAD..${ref}`);

let conflicts = [];
const warnings = [];
if (behind > 0 && dryRun) {
  const predicted = predictConflicts("HEAD", ref);
  if (predicted === null) warnings.push("This git can't predict conflicts (needs git 2.38 or later).");
  conflicts = predicted ?? [];
} else if (behind > 0) {
  try {
    git(root, ["merge", "--no-edit", ref]);
  } catch (err) {
    conflicts = parseConflictNames(gitOrExit(["diff", "--name-only", "--diff-filter=U"]));
    if (conflicts.length === 0) {
      console.error(`error: git merge ${ref} failed: ${err.stderr?.toString().trim() || err.message}`);
      process.exit(3);
    }
  }
}

const res = syncResult({ branch, base, behind, conflicts, dryRun });
res.warnings.push(...warnings);
process.exit(report("sync", res, { json }));
