// Rules for `pnpm sync`: which base a branch is brought up to date with, and how the outcome of the
// merge is reported. Pure: the command runs git and passes the results in. Sync only ever merges the
// base into the current branch: it never rebases, never force-pushes and never resolves a conflict.
import { baseFor } from "./rules.mjs";

const LONG_LIVED = /^(?:main|feature\/team-[1-4])$/;

/**
 * @param {string} branch the current branch ("HEAD" when detached)
 * @param {string[]} teamLabels
 * @param {string | null} [override] --base
 * @returns {{ base: string, error?: undefined } | { error: string, base?: undefined }}
 */
export function syncBaseFor(branch, teamLabels, override = null) {
  if (branch === "HEAD") return { error: "You are on a detached HEAD. Check out your work branch first." };
  if (/^feature\/team-[1-4]$/.test(branch)) {
    return {
      error: `${branch} is a long-lived branch and can only change through pull requests. To bring it up to date with main, run pnpm branches:sync (it opens a PR).`,
    };
  }
  if (LONG_LIVED.test(branch)) {
    return {
      error: `${branch} is a long-lived branch: main and the feature branches only change through pull requests.`,
    };
  }
  if (override) return { base: override };
  const base = baseFor(branch, teamLabels);
  if (!base) {
    return {
      error: `Can't tell the base of "${branch}" from its name (<team-label>/<issue>-<description>). Pass --base <branch>.`,
    };
  }
  return { base };
}

/**
 * Conflicted files, from `git merge-tree --write-tree --name-only --no-messages` (first line is the
 * tree id) or from `git diff --name-only --diff-filter=U`.
 * @param {string} out
 * @param {{ mergeTree?: boolean }} [opts]
 */
export function parseConflictNames(out, opts = {}) {
  const lines = out.split(/\r?\n/);
  const names = (opts.mergeTree ? lines.slice(1) : lines).map((l) => l.trim()).filter(Boolean);
  return [...new Set(names)];
}

/**
 * @param {{
 *   branch: string,
 *   base: string,
 *   behind: number,
 *   conflicts: string[],
 *   dryRun?: boolean,
 *   dirty?: string[],
 *   mergeInProgress?: boolean,
 * }} input
 */
export function syncResult({
  branch,
  base,
  behind,
  conflicts,
  dryRun = false,
  dirty = [],
  mergeInProgress = false,
}) {
  const ref = `origin/${base}`;
  /** @type {import("./report.mjs").Problem[]} */
  const problems = [];
  /** @type {string[]} */
  const warnings = [];
  const out = (summary, merged) => ({
    ok: problems.length === 0,
    summary,
    problems,
    warnings,
    branch,
    base,
    behind,
    conflicts,
    merged,
    dryRun,
  });

  if (mergeInProgress) {
    problems.push({
      rule: "merge-in-progress",
      message: "A merge is already in progress.",
      fix: "Finish it (resolve, git add, git commit) or undo it with git merge --abort, then run pnpm sync again.",
    });
    return out(`${branch} was not synced`, false);
  }
  if (dirty.length > 0) {
    problems.push({
      rule: "dirty",
      message: `There are uncommitted changes (${dirty.slice(0, 5).join(", ")}${dirty.length > 5 ? ", ..." : ""}).`,
      fix: "Commit them (or git stash them yourself), then run pnpm sync again.",
    });
    return out(`${branch} was not synced`, false);
  }
  if (behind === 0) return out(`${branch} is already up to date with ${ref}`, false);

  if (conflicts.length > 0) {
    for (const file of conflicts) {
      problems.push({
        rule: "conflict",
        message: dryRun ? `Merging ${ref} would conflict here.` : `Conflict: merging ${ref} needs you here.`,
        file,
        fix: dryRun
          ? `Run pnpm sync, then resolve the file yourself.`
          : "Edit the file and remove the conflict markers, git add it, then git commit. To give up instead: git merge --abort.",
      });
    }
    return out(
      dryRun
        ? `merging ${behind} commit(s) from ${ref} into ${branch} would conflict in ${conflicts.length} file(s)`
        : `merging ${ref} into ${branch} stopped with ${conflicts.length} conflicted file(s); nothing was resolved for you`,
      false,
    );
  }

  if (dryRun)
    return out(`would merge ${behind} commit(s) from ${ref} into ${branch}, without conflicts`, false);
  warnings.push(`The merge is only local. Run the checks (pnpm preflight:quick), then git push.`);
  return out(`merged ${behind} commit(s) from ${ref} into ${branch}`, true);
}
