// Enforces "work inside your own team's folder" (CLAUDE.md): a work branch may change files its label
// owns and shared files. Another owner's files are an error, unless the issue explains why on a line
// of its own, "Cross-team: <why>"; then they are warnings.
import { ownerOf } from "./ownership.mjs";

/** A line in the issue body like "Cross-team: the fix for #86 needs the report's tests". */
const CROSS_TEAM_LINE = /^\s*(?:[-*]\s*)?\**cross-team\**:\s*\S/im;

/** Whether an issue body explains why the work touches another team's files. @param {string | null | undefined} body */
export const explainsCrossTeam = (body) => CROSS_TEAM_LINE.test(body ?? "");

/**
 * @param {{
 *   label: string,
 *   files: string[],
 *   ownership: { path: string, owner: string }[],
 *   crossTeam: boolean,
 * }} input
 */
export function checkOwnership({ label, files, ownership, crossTeam }) {
  const foreign = files
    .map((file) => ({ file, owner: ownerOf(file, ownership) }))
    .filter(({ owner }) => owner !== label && owner !== "shared");

  if (crossTeam) {
    return {
      problems: [],
      warnings: foreign.map(
        ({ file, owner }) =>
          `${file} is owned by ${owner} (allowed: the issue explains why in "Cross-team:").`,
      ),
    };
  }
  return {
    problems: foreign.map(({ file, owner }) => ({
      rule: "ownership",
      file,
      message: `Owned by ${owner}, but this branch is ${label} work.`,
      fix: `Move it to a ${owner} issue, or add a line "Cross-team: <why>" to the issue.`,
    })),
    warnings: [],
  };
}
