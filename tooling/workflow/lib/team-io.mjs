// Reads, asks for and saves your team (see lib/team.mjs for the rules). The answer lives in local git
// config, so it is per clone and never committed.
import { createInterface } from "node:readline";
import { EXIT } from "./args.mjs";
import { git } from "./git.mjs";
import { parseTeamAnswer, resolveTeam, TEAM_CONFIG_KEY, teamMenu } from "./team.mjs";

/** @param {string} root */
export function readSavedTeam(root) {
  try {
    return git(root, ["config", "--get", TEAM_CONFIG_KEY]).trim() || null;
  } catch {
    return null; // not set: git config exits with 1
  }
}

/** @param {string} root @param {string} team */
export function saveTeam(root, team) {
  git(root, ["config", "--local", TEAM_CONFIG_KEY, team]);
}

/** A person at a terminal can answer; agents and CI can't. */
export function isInteractive() {
  return Boolean(process.stdin.isTTY && process.stderr.isTTY) && !process.env.CI;
}

/**
 * Asks on stderr (stdout stays clean for --json) until the answer is a team, at most three times.
 * @param {string[]} teamLabels
 * @returns {Promise<string | null>}
 */
export async function askTeam(teamLabels) {
  // The line iterator buffers, so an answer typed before the prompt shows is not lost.
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    console.error("Which team are you on?");
    for (const line of teamMenu(teamLabels)) console.error(line);
    const prompt = () => process.stderr.write("Team (number or label): ");
    prompt();
    let tries = 0;
    for await (const answer of rl) {
      const team = parseTeamAnswer(answer, teamLabels);
      if (team) return team;
      if (++tries >= 3) break;
      console.error(`Answer with a number from 1 to ${teamLabels.length}, or a label.`);
      prompt();
    }
    return null;
  } finally {
    rl.close();
  }
}

/**
 * Prints a usage or environment error (as JSON with --json) and exits.
 * @param {string} command @param {number} code @param {string} message @param {boolean} json
 * @returns {never}
 */
export function stop(command, code, message, json) {
  if (json) console.log(JSON.stringify({ command, ok: false, exitCode: code, error: message }, null, 2));
  else console.error(`error: ${message}`);
  process.exit(code);
}

/**
 * The team for this run: --team, the saved team, or (first run, in a terminal) the answer to a
 * question, which is then saved. Exits with 2 when there is no team and no terminal to ask in.
 * @param {{ root: string, command: string, flag: string | null, teamLabels: string[], json: boolean }} input
 * @returns {Promise<{ team: string, source: "flag" | "saved" | "asked" }>}
 */
export async function getTeam({ root, command, flag, teamLabels, json }) {
  const r = resolveTeam({ flag, saved: readSavedTeam(root), interactive: isInteractive(), teamLabels });
  if (r.ok) return { team: r.team, source: r.source };
  if (!r.prompt) stop(command, r.exitCode, r.message, json);
  const team = await askTeam(teamLabels);
  if (!team) stop(command, EXIT.usage, `No team chosen. Run "pnpm team:set <team>" or pass --team.`, json);
  try {
    saveTeam(root, team);
  } catch (err) {
    stop(
      command,
      EXIT.environment,
      `git config failed: ${err.stderr?.toString().trim() || err.message}`,
      json,
    );
  }
  console.error(
    `Saved: you are on ${team} (git config ${TEAM_CONFIG_KEY}). Change it with "pnpm team:set <team>".`,
  );
  return { team, source: "asked" };
}
