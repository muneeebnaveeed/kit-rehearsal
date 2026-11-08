// The team-instructor identity is reserved for the instructors. An issue or pull request "uses" it when
// it carries the team-instructor label, names it in the title, or puts it in the "**Team**" field. Whoever does
// that must be on the list in .github/instructors.json. Pure (no GitHub, no file system), so every rule
// is unit-tested.
//
// The gate is the account, not AI attribution: the instructors' own PRs carry "Generated with Claude
// Code" and Co-Authored-By trailers (the course is AI first), so rejecting those would block their work.
import { readFileSync } from "node:fs";
import { parsePrefix } from "./rules.mjs";
import { fieldsOf } from "./template.mjs";

export const INSTRUCTOR_LABEL = "team-instructor";

const ADVICE =
  "Use your own team label. To change files under course/ from another team, use the 'platform' label (or your team's) and add a line 'Cross-team: <why>' to the issue.";

/** Loads .github/instructors.json. @param {string} root repo root @returns {string[]} lower-case logins */
export function loadInstructors(root) {
  const file = JSON.parse(readFileSync(`${root}/.github/instructors.json`, "utf8"));
  return file.logins.map((l) => l.toLowerCase());
}

/** @param {string | null | undefined} login @param {string[]} instructors */
export function isInstructor(login, instructors) {
  return Boolean(login) && instructors.includes(/** @type {string} */ (login).toLowerCase());
}

/**
 * The ways an issue or PR claims the instructor identity, as readable reasons. Empty when it does not.
 * @param {{ labels?: string[], title?: string, body?: string | null }} item
 */
export function instructorClaims({ labels = [], title = "", body = "" }) {
  const reasons = [];
  if (labels.includes(INSTRUCTOR_LABEL)) reasons.push("the team-instructor label");
  const t = title.trim();
  if (parsePrefix(t)?.scope === INSTRUCTOR_LABEL) reasons.push("the team-instructor scope in its title");
  else if (t.toLowerCase().startsWith(`[${INSTRUCTOR_LABEL}]`))
    reasons.push("the [team-instructor] title prefix");
  const team = fieldsOf(body ?? "").find((s) => s.heading.toLowerCase() === "team");
  if (team && team.body.trim().split(/\s+/)[0].replace(/[`*]/g, "").toLowerCase() === INSTRUCTOR_LABEL) {
    reasons.push("team-instructor as its Team");
  }
  return reasons;
}

/**
 * @param {{
 *   kind: "issue" | "pr",
 *   author: string | null,
 *   labels?: string[],
 *   title?: string,
 *   body?: string | null,
 *   instructors: string[],
 * }} input instructors: lower-case logins
 */
export function checkInstructor({ kind, author, labels = [], title = "", body = "", instructors }) {
  const claims = instructorClaims({ labels, title, body });
  if (claims.length === 0 || isInstructor(author, instructors)) {
    return { ok: true, claims, problems: [] };
  }
  const noun = kind === "pr" ? "pull request" : "issue";
  return {
    ok: false,
    claims,
    problems: [
      {
        rule: "identity",
        message: `This ${noun} uses the team-instructor identity (${claims.join(", ")}), which is reserved for the instructors, and ${author ?? "its author"} is not on the list in .github/instructors.json. ${ADVICE}`,
      },
    ],
  };
}

/**
 * The same rule for the classifier: refuse to hand out the label to someone who may not use it.
 * `actor` is the GitHub login of whoever is running the command, or null when it is not known.
 * @param {{ label: string | null, actor: string | null, instructors: string[] }} input
 * @returns {{ error: string } | { warning: string } | null}
 */
export function guardLabel({ label, actor, instructors }) {
  if (label !== INSTRUCTOR_LABEL) return null;
  if (actor === null) {
    return {
      warning: `The label is team-instructor, which only the instructors may use, but the GitHub account could not be read. CI checks it.`,
    };
  }
  if (isInstructor(actor, instructors)) return null;
  return {
    error: `The label would be team-instructor, which is reserved for the instructors, and ${actor} is not on the list in .github/instructors.json. ${ADVICE} Pass --label to choose another label.`,
  };
}

/** Reads the fields the check needs from a pull_request or issues event payload. @param {any} event */
export function itemFromEvent(event) {
  if (event.pull_request) {
    const p = event.pull_request;
    return {
      kind: /** @type {const} */ ("pr"),
      author: p.user?.login ?? null,
      labels: (p.labels ?? []).map((l) => l.name),
      title: p.title ?? "",
      body: p.body ?? "",
    };
  }
  if (event.issue) {
    const i = event.issue;
    return {
      kind: /** @type {const} */ ("issue"),
      author: i.user?.login ?? null,
      labels: (i.labels ?? []).map((l) => l.name),
      title: i.title ?? "",
      body: i.body ?? "",
    };
  }
  return null;
}
