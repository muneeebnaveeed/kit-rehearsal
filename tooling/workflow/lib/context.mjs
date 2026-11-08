// Shared plumbing for the branch-level checks: the repo root, which branch is checked against which
// base, and GitHub issue lookups. In CI the head and base come from the pull_request event's env vars
// (GITHUB_HEAD_REF, GITHUB_BASE_REF); locally from git and the branch model.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { EXIT } from "./args.mjs";
import { currentBranch, git } from "./git.mjs";
import { baseFor } from "./rules.mjs";
import { loadTypes } from "./types.mjs";

export const root = fileURLToPath(new URL("../../../", import.meta.url));

/** Prints an environment error and exits with 3. @param {string} message */
export function environmentError(message) {
  console.error(`error: ${message}`);
  process.exit(EXIT.environment);
}

/**
 * @param {Record<string, string | true>} flags parsed with lib/args.mjs
 * @returns {{ branch: string, base: string | null, baseRef: string | null, head: string, teamLabels: string[] }}
 */
export function resolveContext(flags) {
  const str = (name) => (typeof flags[name] === "string" ? flags[name] : null);
  const { teamLabels } = loadTypes(root);
  let branch;
  try {
    branch = str("branch") ?? process.env.GITHUB_HEAD_REF ?? currentBranch(root);
  } catch (err) {
    environmentError(`git failed: ${err.stderr?.toString().trim() || err.message}`);
  }
  const base = str("base") ?? process.env.GITHUB_BASE_REF ?? baseFor(branch, teamLabels) ?? null;
  const head = str("head") ?? "HEAD";
  return { branch, base, baseRef: base ? refFor(base) : null, head, teamLabels };
}

/** Prefer origin/<base>, so a stale local copy doesn't hide changes. @param {string} base */
function refFor(base) {
  for (const ref of [`origin/${base}`, base]) {
    try {
      git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
      return ref;
    } catch {
      // try the next one
    }
  }
  environmentError(`base branch "${base}" not found locally or on origin. Run: git fetch origin ${base}`);
}

/**
 * Looks an issue up with the GitHub CLI. Returns null when it doesn't exist.
 * @param {number} number
 * @returns {{ number: number, state: string, labels: string[], body: string } | null}
 */
export function getIssue(number) {
  try {
    const out = execFileSync("gh", ["issue", "view", String(number), "--json", "number,state,labels,body"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const data = JSON.parse(out);
    return {
      number: data.number,
      state: data.state,
      labels: data.labels.map((l) => l.name),
      body: data.body ?? "",
    };
  } catch (err) {
    const stderr = err.stderr?.toString() ?? "";
    if (/not found|Could not resolve/i.test(stderr)) return null;
    if (err.code === "ENOENT")
      environmentError("the GitHub CLI (gh) isn't installed: https://cli.github.com");
    environmentError(
      `could not read issue #${number} with gh (logged in with "gh auth login"?): ${stderr.trim() || err.message}`,
    );
  }
}

/**
 * Files the branch changes since it left the base (added, copied, modified, renamed), repo-relative.
 * @param {string} baseRef
 * @param {string} head
 */
export function changedPaths(baseRef, head) {
  const out = git(root, ["diff", "--name-only", "--diff-filter=ACMR", "-z", `${baseRef}...${head}`]);
  return out.split("\0").filter(Boolean);
}
