// The rules behind the git hooks in .githooks/: which issue a branch belongs to, adding its reference to
// a commit message, and whether `pnpm install` may point git at the hooks. Pure, so every rule is
// unit-tested; the hook scripts do the I/O.
import { EXEMPT, ISSUE_REFERENCE } from "./check-commit.mjs";
import { WORK_BRANCH } from "./rules.mjs";

/** The folder the hooks live in, relative to the repository root. */
export const HOOKS_PATH = ".githooks";

const TRAILER = /^[A-Za-z][A-Za-z0-9-]*: \S/;
// `git commit -v` (or commit.verbose) puts the staged diff below this line; git ignores everything from
// here on, so the hooks must neither read nor move it.
const SCISSORS = /^# -+ >8 -+$/;
// The `Refs #` placeholder at the end of .gitmessage, still without its number.
const REF_PLACEHOLDER = /^Refs #\s*$/;
const isComment = (line) => line.startsWith("#");
const isBlankOrComment = (line) => line.trim() === "" || isComment(line);

/**
 * The part of a commit message file that becomes the message: everything above git's scissors line.
 * @param {string} message
 */
export function beforeScissors(message) {
  const lines = message.replace(/\r\n/g, "\n").split("\n");
  const cut = lines.findIndex((l) => SCISSORS.test(l));
  return cut === -1 ? lines.join("\n") : lines.slice(0, cut).join("\n");
}

/**
 * The issue number in a work branch name (`team-2/14-add-login` → 14), or null for any other branch.
 * @param {string} branch
 */
export function issueFromBranch(branch) {
  const m = WORK_BRANCH.exec(branch);
  return m ? Number(m[2]) : null;
}

/**
 * Adds "Refs #N" for the branch's issue when the message has no issue reference yet. Leaves the message
 * unchanged off a work branch, for messages git generates (merges, reverts, fixups) and when a reference
 * is already there. Fills in the bare `Refs #` placeholder from .gitmessage when it is there; otherwise
 * the reference goes in its own paragraph, before any trailers (Co-Authored-By: …). Only inserts: every
 * other line, git's "#" comments and the `git commit -v` diff below the scissors line included, stays
 * where it was.
 * @param {string} message the commit message file's content
 * @param {string} branch the current branch
 * @returns {string}
 */
export function addIssueRef(message, branch) {
  const issue = issueFromBranch(branch);
  if (issue === null) return message;

  const lines = message.replace(/\r\n/g, "\n").split("\n");
  const cut = lines.findIndex((l) => SCISSORS.test(l));
  const head = cut === -1 ? lines : lines.slice(0, cut);
  const tail = cut === -1 ? [] : lines.slice(cut);

  // The message proper ends at its last line that is neither blank nor a comment; git's comment block
  // (and anything else) after it is kept as it is.
  let end = head.length;
  while (end > 0 && isBlankOrComment(head[end - 1])) end--;
  const content = head.slice(0, end);
  const after = head.slice(end);
  const text = content.filter((l) => !isComment(l));

  const subject = text.find((l) => l.trim() !== "") ?? "";
  if (subject === "" || EXEMPT.test(subject) || ISSUE_REFERENCE.test(text.join("\n"))) return message;

  const ref = `Refs #${issue}`;
  let body;
  let appended = false;
  const placeholder = content.findIndex((l) => REF_PLACEHOLDER.test(l));
  if (placeholder !== -1) {
    body = content.with(placeholder, ref);
  } else {
    const lastBlank = content.findLastIndex((l) => l.trim() === "");
    const lastParagraph = lastBlank === -1 ? [] : content.slice(lastBlank + 1).filter((l) => !isComment(l));
    if (lastParagraph.length > 0 && lastParagraph.every((l) => TRAILER.test(l))) {
      body = [...content.slice(0, lastBlank), "", ref, ...content.slice(lastBlank)];
    } else {
      body = [...content, "", ref];
      appended = true;
    }
  }

  // An appended reference keeps a blank line before git's comments, as git writes it.
  const gap = appended && after.length > 0 && after[0].trim() !== "" ? [""] : [];
  const out = [...body, ...gap, ...after, ...tail].join("\n");
  return out.endsWith("\n") ? out : `${out}\n`;
}

/**
 * The branch a rebase is working on, from git's `rebase-merge/head-name` (or `rebase-apply/head-name`)
 * file, which holds e.g. "refs/heads/team-2/14-add-login". HEAD is detached during a rebase, so this is
 * how a reworded commit still gets its issue reference.
 * @param {string | null} headName the file's content, or null when there is no rebase
 * @returns {string}
 */
export function branchFromRebase(headName) {
  const ref = headName?.trim() ?? "";
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : "";
}

const ZERO_SHA = /^0+$/;

/**
 * Parses what git writes to a pre-push hook's stdin: one "<local ref> <local sha> <remote ref> <remote
 * sha>" line per ref being pushed.
 * @param {string} stdin
 * @returns {{ localRef: string, localSha: string, remoteRef: string, remoteSha: string }[]}
 */
export function parsePushUpdates(stdin) {
  return stdin
    .split(/\r?\n/)
    .map((l) => l.trim().split(/\s+/))
    .filter((f) => f.length === 4)
    .map(([localRef, localSha, remoteRef, remoteSha]) => ({ localRef, localSha, remoteRef, remoteSha }));
}

/**
 * Whether the pre-push checks can say anything about this push. They look at the working tree, so they
 * only run when what is pushed is the commit checked out; deletions and tags need no checks.
 * @param {{ updates: ReturnType<typeof parsePushUpdates>, headSha: string | null }} input
 * @returns {{ run: true } | { run: false, reason: string }}
 */
export function planPush({ updates, headSha }) {
  if (updates.length === 0) return { run: false, reason: "nothing new to push, nothing to check." };
  const branches = updates.filter((u) => !ZERO_SHA.test(u.localSha) && !u.remoteRef.startsWith("refs/tags/"));
  if (branches.length === 0)
    return { run: false, reason: "only deletions or tags are pushed, nothing to check." };
  const other = branches.filter((u) => u.localSha !== headSha);
  if (other.length > 0) {
    const names = other.map((u) => u.remoteRef.replace(/^refs\/heads\//, "")).join(", ");
    return {
      run: false,
      reason: `${names} is not the commit you have checked out, and the checks look at your working tree, so they were skipped. CI checks the pushed commits.`,
    };
  }
  return { run: true };
}

/**
 * What `pnpm install` should do about git's hooks path.
 * @param {{ isGitCheckout: boolean, current: string | null, ci: boolean }} state
 * @returns {"set" | "already" | "foreign" | "skip"}
 */
export function hooksPathAction({ isGitCheckout, current, ci }) {
  if (!isGitCheckout || ci) return "skip";
  if (!current) return "set";
  return current === HOOKS_PATH ? "already" : "foreign";
}
