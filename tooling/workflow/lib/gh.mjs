// GitHub CLI lookups for the workflow commands (issue:start, pr:open, check:review). Everything goes
// through execFileSync (no shell). A missing or logged-out gh exits with 3 (environment problem).
import { execFileSync } from "node:child_process";
import { environmentError, root } from "./context.mjs";

/**
 * Runs gh and returns stdout. Returns null when GitHub says the thing doesn't exist.
 * @param {string[]} args
 * @param {string} what for the error message, e.g. "issue #14"
 */
export function gh(args, what) {
  try {
    return execFileSync("gh", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    const stderr = err.stderr?.toString() ?? "";
    if (/not found|Could not resolve|no pull requests found/i.test(stderr)) return null;
    if (err.code === "ENOENT")
      environmentError("the GitHub CLI (gh) isn't installed: https://cli.github.com");
    environmentError(
      `gh failed on ${what} (logged in with "gh auth login"?): ${stderr.trim() || err.message}`,
    );
  }
}

/**
 * @param {number} number
 * @returns {{ number: number, title: string, state: string, labels: string[], assignees: string[] } | null}
 */
export function getIssueDetails(number) {
  const out = gh(
    ["issue", "view", String(number), "--json", "number,title,state,labels,assignees"],
    `issue #${number}`,
  );
  if (out === null) return null;
  const d = JSON.parse(out);
  return {
    number: d.number,
    title: d.title,
    state: d.state,
    labels: d.labels.map((l) => l.name),
    assignees: d.assignees.map((a) => a.login),
  };
}

/** The URL of the open PR whose head is `branch`, or null. @param {string} branch */
export function findOpenPr(branch) {
  const out = gh(
    ["pr", "list", "--head", branch, "--state", "open", "--json", "url", "--limit", "1"],
    `PRs for ${branch}`,
  );
  const list = out ? JSON.parse(out) : [];
  return list[0]?.url ?? null;
}

/** The logged-in GitHub user. */
export function currentUser() {
  return gh(["api", "user", "--jq", ".login"], "the logged-in user")?.trim() ?? null;
}

/**
 * A PR's author and reviews; the current branch's PR when `number` is null. Null when there is none.
 * @param {string | null} number
 */
export function getPrReviews(number) {
  const out = gh(
    ["pr", "view", ...(number ? [number] : []), "--json", "number,url,author,reviews"],
    number ? `PR #${number}` : "the current branch's PR",
  );
  if (out === null) return null;
  const d = JSON.parse(out);
  return {
    number: d.number,
    url: d.url,
    author: d.author.login,
    reviews: d.reviews.map((r) => ({
      author: r.author?.login ?? null,
      state: r.state,
      submittedAt: r.submittedAt,
    })),
  };
}
