// Thin git helpers. Everything goes through execFileSync (no shell), so it behaves the same on
// macOS, Windows and Linux.
import { execFileSync } from "node:child_process";

/** Up to 256 MB of output: the default 1 MB is too small for the diff of a big sync or promotion PR. */
const MAX_OUTPUT = 1 << 28;

/**
 * @param {string} root
 * @param {string[]} args
 */
export function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: MAX_OUTPUT,
  });
}

/**
 * Parses `git diff --name-status -z` output into { status, path } entries. A rename or copy lists
 * two paths; the new one is kept.
 * @param {string} out
 * @returns {{ status: string, path: string }[]}
 */
export function parseNameStatus(out) {
  const parts = out.split("\0").filter((p) => p !== "");
  const files = [];
  for (let i = 0; i < parts.length; ) {
    const status = parts[i][0];
    if (status === "R" || status === "C") {
      files.push({ status, path: parts[i + 2] });
      i += 3;
    } else {
      files.push({ status, path: parts[i + 1] });
      i += 2;
    }
  }
  return files;
}

/**
 * The change set to classify.
 *   staged: what `git commit` would record
 *   base/head: everything on head since it forked from base (three-dot diff)
 *   neither: all uncommitted work (staged, unstaged and untracked)
 * @param {string} root
 * @param {{ staged?: boolean, base?: string, head?: string }} opts
 */
export function changedFiles(root, opts) {
  if (opts.staged) {
    return parseNameStatus(git(root, ["diff", "--cached", "--name-status", "-z", "-M"]));
  }
  if (opts.base) {
    const head = opts.head ?? "HEAD";
    return parseNameStatus(git(root, ["diff", "--name-status", "-z", "-M", `${opts.base}...${head}`]));
  }
  const tracked = parseNameStatus(git(root, ["diff", "HEAD", "--name-status", "-z", "-M"]));
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean)
    .map((path) => ({ status: "A", path }));
  return [...tracked, ...untracked];
}

/** @param {string} root */
export function currentBranch(root) {
  return git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
}

/**
 * Subjects of the commits on `head` since it forked from `base`, without merge commits, newest first.
 * @param {string} root
 * @param {string} base
 * @param {string} head
 */
export function branchSubjects(root, base, head = "HEAD") {
  return git(root, ["log", "--no-merges", "--format=%s", `${base}..${head}`])
    .split("\n")
    .filter((s) => s.trim() !== "");
}
