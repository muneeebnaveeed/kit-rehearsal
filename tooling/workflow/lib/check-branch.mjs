// Checks a work branch before (and while) it becomes a PR: the name, the base it must target, and
// that its issue exists, is open and carries the same team label. Pure: the caller passes the issue.
import { baseFor, WORK_BRANCH } from "./rules.mjs";

/**
 * @typedef {{ number: number, state: string, labels: string[] }} Issue
 * @param {{
 *   branch: string,
 *   base: string | null,
 *   teamLabels: string[],
 *   issue?: Issue | null,
 * }} input issue: undefined when it wasn't looked up, null when it doesn't exist
 */
export function checkBranch({ branch, base, teamLabels, issue }) {
  /** @type {import("./report.mjs").Problem[]} */
  const problems = [];
  const add = (rule, message, fix) => problems.push({ rule, message, ...(fix ? { fix } : {}) });

  const isLongLived = branch === "main" || /^feature\/team-[1-4]$/.test(branch);
  const m = WORK_BRANCH.exec(branch);
  if (!m && !isLongLived) {
    add(
      "branch",
      `"${branch}" doesn't match <team-label>/<issue-number>-<short-description>, e.g. team-2/14-add-login-page.`,
      "git branch -m <team-label>/<issue-number>-<short-description>",
    );
    return problems;
  }

  const expected = baseFor(branch, teamLabels, base);
  if (base && expected && base !== expected) {
    add(
      "base",
      `A PR from "${branch}" must target "${expected}", not "${base}".`,
      `Use ${expected} as the base branch.`,
    );
  }
  if (branch === "main" && base && !/^feature\/team-[1-4]$/.test(base)) {
    add("base", `A PR from main goes to a feature/team-N branch (sync), not "${base}".`);
  }

  if (!m || issue === undefined) return problems;
  const [, label, number] = m;
  if (issue === null) {
    add("issue", `Issue #${number} doesn't exist.`, "Open the issue first, then name the branch after it.");
  } else {
    if (issue.state !== "OPEN")
      add("issue", `Issue #${number} is closed.`, "Reopen it, or work on an open issue.");
    if (!issue.labels.includes(label)) {
      add(
        "label",
        `Issue #${number} doesn't have the "${label}" label the branch name uses.`,
        `Add "${label}" to #${number}, or rename the branch after the issue's label.`,
      );
    }
  }
  return problems;
}
