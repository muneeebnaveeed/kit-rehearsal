// Thin git, GitHub CLI and HTTP plumbing for the commands that open PRs or read remote state. Every
// failure of git or gh is an environment problem (exit 3) with a message that says what to do.
import { execFileSync } from "node:child_process";
import { environmentError, root } from "./context.mjs";
import { parseHealth } from "./env.mjs";
import { git } from "./git.mjs";
import { parseConflictNames } from "./sync.mjs";

const reason = (err) => err.stderr?.toString().trim() || err.message;

/**
 * Runs gh and returns its stdout. Exits with 3 when gh is missing or fails.
 * @param {string[]} args
 * @param {{ input?: string }} [opts]
 */
export function gh(args, opts = {}) {
  try {
    return execFileSync("gh", args, {
      cwd: root,
      encoding: "utf8",
      input: opts.input,
      stdio: [opts.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
  } catch (err) {
    if (err.code === "ENOENT")
      environmentError("the GitHub CLI (gh) isn't installed: https://cli.github.com");
    environmentError(
      `gh ${args.slice(0, 2).join(" ")} failed (logged in with "gh auth login"?): ${reason(err)}`,
    );
  }
}

/** Runs git in the repo root. Exits with 3 when it fails. @param {string[]} args */
export function gitOrExit(args) {
  try {
    return git(root, args);
  } catch (err) {
    environmentError(`git ${args[0]} failed: ${reason(err)}`);
  }
}

/**
 * The `git fetch` arguments that bring branches into their origin/ refs. A shallow clone (what
 * actions/checkout makes) also fetches the full history: without it commit counts are wrong and
 * there is no merge base to predict conflicts from.
 * @param {string[]} branches
 * @param {{ shallow: boolean }} opts
 */
export function fetchArgs(branches, { shallow }) {
  return [
    "fetch",
    "--quiet",
    ...(shallow ? ["--unshallow"] : []),
    "origin",
    ...branches.map((b) => `+refs/heads/${b}:refs/remotes/origin/${b}`),
  ];
}

/** Fetches branches from origin so every comparison uses GitHub's state. @param {string[]} branches */
export function fetchOrigin(branches) {
  const shallow = gitOrExit(["rev-parse", "--is-shallow-repository"]).trim() === "true";
  gitOrExit(fetchArgs(branches, { shallow }));
}

/** Whether origin has the branch (after fetching it). @param {string} branch */
export function remoteBranchExists(branch) {
  const out = gitOrExit(["ls-remote", "--heads", "origin", branch]);
  return out.trim() !== "";
}

/** Number of commits in a range like origin/prod..origin/main. @param {string} range */
export function countCommits(range) {
  return Number(gitOrExit(["rev-list", "--count", range]).trim());
}

/** Files a range like origin/main...origin/feature/team-2 changes since the merge base. @param {string} range */
export function changedFiles(range) {
  return gitOrExit(["diff", "--name-only", range]).split("\n").filter(Boolean);
}

/** @param {string} ref */
export function revParse(ref) {
  return gitOrExit(["rev-parse", ref]).trim();
}

/** `git log --merges` of a range in the format parseMergedPrs reads. @param {string} range */
export function mergeLog(range) {
  return gitOrExit(["log", "--merges", "--format=%H%x1f%s%x1f%b%x1e", range]);
}

/**
 * Files that would conflict if `theirs` were merged into `ours`, without touching the work tree
 * (git merge-tree, git 2.38+). null when this git can't tell.
 * @param {string} ours
 * @param {string} theirs
 * @returns {string[] | null}
 */
export function predictConflicts(ours, theirs) {
  try {
    git(root, ["merge-tree", "--write-tree", "--name-only", "--no-messages", ours, theirs]);
    return [];
  } catch (err) {
    // Exit status 1 means "conflicts", and stdout lists them after the tree id.
    if (err.status === 1 && typeof err.stdout === "string" && err.stdout.trim() !== "") {
      return parseConflictNames(err.stdout, { mergeTree: true });
    }
    return null;
  }
}

/** "owner/name" of the repository. */
export function repoName() {
  return (
    process.env.GITHUB_REPOSITORY ||
    gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]).trim()
  );
}

/**
 * Open PRs from head into base.
 * @param {string} head
 * @param {string} base
 * @returns {{ number: number, url: string, title: string }[]}
 */
export function openPrs(head, base) {
  return JSON.parse(
    gh(["pr", "list", "--state", "open", "--head", head, "--base", base, "--json", "number,url,title"]),
  );
}

/**
 * Check runs on a commit.
 * @param {string} repo
 * @param {string} sha
 */
export function checkRuns(repo, sha) {
  return JSON.parse(gh(["api", `repos/${repo}/commits/${sha}/check-runs?per_page=100`])).check_runs ?? [];
}

/**
 * The issue, or null when it doesn't exist.
 * @param {number} number
 * @returns {{ number: number, state: string, labels: string[] } | null}
 */
export function issue(number) {
  try {
    const data = JSON.parse(
      execFileSync("gh", ["issue", "view", String(number), "--json", "number,state,labels"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    return { number: data.number, state: data.state, labels: data.labels.map((l) => l.name) };
  } catch (err) {
    if (/not found|Could not resolve/i.test(reason(err))) return null;
    if (err.code === "ENOENT")
      environmentError("the GitHub CLI (gh) isn't installed: https://cli.github.com");
    environmentError(
      `could not read issue #${number} with gh (logged in with "gh auth login"?): ${reason(err)}`,
    );
  }
}

/**
 * Opens a PR and returns its URL. Never merges, never enables auto-merge.
 * @param {{ head: string, base: string, title: string, body: string, labels: string[] }} pr
 */
export function createPr(pr) {
  const args = [
    "pr",
    "create",
    "--head",
    pr.head,
    "--base",
    pr.base,
    "--title",
    pr.title,
    "--body-file",
    "-",
  ];
  for (const label of pr.labels) args.push("--label", label);
  return gh(args, { input: pr.body }).trim();
}

/**
 * Turns on auto-merge (merge commit) for a PR. GitHub merges it only once the branch's ruleset is
 * satisfied: an approving review by a person and every required check.
 * @param {string} url
 */
export function enableAutoMerge(url) {
  gh(["pr", "merge", url, "--auto", "--merge"]);
}

/** Value of a git config key, or null. @param {string} key */
export function gitConfig(key) {
  try {
    return git(root, ["config", "--get", key]).trim() || null;
  } catch {
    return null;
  }
}

/**
 * GET <url>/health. Never throws: a network error, a timeout or a bad body comes back as `error`.
 * @param {string} url the environment's base URL
 * @param {number} [timeoutMs]
 * @returns {Promise<{ health?: { ok: true, env: string, sha: string }, error?: string }>}
 */
export async function fetchHealth(url, timeoutMs = 10_000) {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { error: `${url}/health answered HTTP ${res.status}.` };
    const text = await res.text();
    try {
      return parseHealth(JSON.parse(text));
    } catch {
      return { error: `${url}/health did not return JSON.` };
    }
  } catch (err) {
    return {
      error: `${url}/health is unreachable: ${err.cause?.code || err.cause?.errors?.[0]?.code || err.message}`,
    };
  }
}
