// Plans `pnpm issue:start <n>`: checks the issue belongs to your team and names the work branch.
// Pure: the caller looks the issue up, lists the branches and runs git and gh.
import { WORK_BRANCH } from "./rules.mjs";
import { teamBase } from "./team.mjs";

const MAX_SLUG = 40;

/**
 * The short description in a branch name, from an issue title: "[team-2] Add login page" ->
 * "add-login-page". At most 40 characters, cut at a word boundary.
 * @param {string} title
 */
export function slugify(title) {
  const words = title
    .replace(/^\s*\[[^\]]*\]\s*/, "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  let slug = "";
  for (const word of words) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > MAX_SLUG) break;
    slug = next;
  }
  if (!slug && words.length > 0) slug = words[0].slice(0, MAX_SLUG);
  return slug || "work";
}

/**
 * @typedef {{ number: number, title: string, state: string, labels: string[], assignees: string[] }} Issue
 * @param {{
 *   issue: Issue | null,
 *   team: string,
 *   teamLabels: string[],
 *   user?: string | null,
 *   slug?: string | null,
 *   existingBranches: string[],
 *   dirty: boolean,
 * }} input issue: null when it doesn't exist; existingBranches: local and remote branch names
 */
export function planIssueStart({
  issue,
  team,
  teamLabels,
  user = null,
  slug = null,
  existingBranches,
  dirty,
}) {
  /** @type {import("./report.mjs").Problem[]} */
  const problems = [];
  /** @type {string[]} */
  const warnings = [];
  const add = (rule, message, fix) => problems.push({ rule, message, ...(fix ? { fix } : {}) });
  const base = teamBase(team);
  const fail = () => ({ ok: false, branch: null, base, label: null, problems, warnings });

  if (!issue) {
    add("issue", "The issue doesn't exist.", "Open it first with the fill-issue skill, then start it.");
    return fail();
  }
  if (issue.state !== "OPEN")
    add("issue", `Issue #${issue.number} is closed.`, "Reopen it, or pick an open issue.");

  const labels = issue.labels.filter((l) => teamLabels.includes(l));
  const label = labels.length === 1 ? labels[0] : null;
  if (!label) {
    add(
      "label",
      `Issue #${issue.number} needs exactly one team label (${teamLabels.join(", ")}); it has ${labels.length ? labels.join(", ") : "none"}.`,
      `gh issue edit ${issue.number} --add-label <team-label>`,
    );
  } else if (label !== team) {
    add(
      "team",
      `Issue #${issue.number} belongs to ${label}, but you are on ${team}.`,
      `Pick one of ${team}'s issues. If you really work on it, pass --team ${label} for this run.`,
    );
  }

  const description = slug ?? slugify(issue.title);
  const branch = label ? `${label}/${issue.number}-${description}` : null;
  if (branch && !WORK_BRANCH.test(branch)) {
    add(
      "slug",
      `"${description}" can't be used in a branch name.`,
      "Use lowercase letters, digits and hyphens.",
    );
  } else if (branch && existingBranches.includes(branch)) {
    add("exists", `Branch ${branch} already exists.`, `git switch ${branch}`);
  }
  if (dirty) add("dirty", "The working tree has uncommitted changes.", "Commit or stash them first.");

  const others = issue.assignees.filter((a) => a !== user);
  if (others.length > 0 && !(user && issue.assignees.includes(user)))
    warnings.push(`#${issue.number} is already assigned to ${others.join(", ")}; check with them first.`);

  if (problems.length > 0) return fail();
  return { ok: true, branch, base, label, problems, warnings };
}
