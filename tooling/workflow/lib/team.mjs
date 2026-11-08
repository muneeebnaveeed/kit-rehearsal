// Which team you are on. issue:start and pr:open need it to pick the base branch and to refuse
// another team's work. It is saved per clone in local git config (`kit.team`), never committed.
// Pure: the caller reads git config and asks the question.

/** The local git config key that stores your team. */
export const TEAM_CONFIG_KEY = "kit.team";

/**
 * The branch your team's work branches start from and their PRs go into (see "Branches" in CLAUDE.md).
 * @param {string} team
 */
export function teamBase(team) {
  return /^team-[1-4]$/.test(team) ? `feature/${team}` : "main";
}

/** The numbered list shown when asking. team-1..team-4 keep their own number. @param {string[]} teamLabels */
export function teamMenu(teamLabels) {
  return teamLabels.map((label, i) => `  ${i + 1}) ${label}`);
}

/**
 * Reads an answer to the team question: a label, or its number in teamMenu().
 * @param {string} answer
 * @param {string[]} teamLabels
 * @returns {string | null}
 */
export function parseTeamAnswer(answer, teamLabels) {
  const a = answer.trim();
  if (teamLabels.includes(a)) return a;
  if (/^\d+$/.test(a)) return teamLabels[Number(a) - 1] ?? null;
  return null;
}

/**
 * Decides the team for this run: `--team` first (this run only), then the saved team. Without either it
 * asks in a terminal and stops with a usage error otherwise. It never guesses.
 * @param {{ flag: string | null, saved: string | null, interactive: boolean, teamLabels: string[] }} input
 * @returns {{ ok: true, team: string, source: "flag" | "saved" } | { ok: false, prompt: true } | { ok: false, prompt: false, exitCode: 2, message: string }}
 */
export function resolveTeam({ flag, saved, interactive, teamLabels }) {
  const known = teamLabels.join(", ");
  if (flag !== null) {
    if (teamLabels.includes(flag)) return { ok: true, team: flag, source: "flag" };
    return {
      ok: false,
      prompt: false,
      exitCode: 2,
      message: `Unknown team "${flag}". Use one of: ${known}.`,
    };
  }
  if (saved && teamLabels.includes(saved)) return { ok: true, team: saved, source: "saved" };
  if (interactive) return { ok: false, prompt: true };
  const why = saved
    ? `The saved team "${saved}" (git config ${TEAM_CONFIG_KEY}) is not a team label.`
    : "Your team isn't set yet.";
  return {
    ok: false,
    prompt: false,
    exitCode: 2,
    message: `${why} There is no terminal to ask in, so pass --team <${teamLabels.join("|")}>, or run "pnpm team:set <team>" once.`,
  };
}
