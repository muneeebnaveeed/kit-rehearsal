// `pnpm team:set`: saves which team you are on, for issue:start and pr:open. It is stored in local git
// config (`kit.team`), so it is per clone and never committed.
//
//   pnpm team:set <team>     save it (team-1, team-2, team-3, team-4, platform, team-instructor)
//   pnpm team:set            ask (in a terminal only)
//   --show                   print the saved team without changing it
//   --json                   machine-readable output
//
// Exit codes: 0 saved (or shown), 1 --show and nothing is saved, 2 usage error (unknown team, or no
// team and no terminal to ask in), 3 environment problem (git).
import { EXIT, parseArgs } from "./lib/args.mjs";
import { root } from "./lib/context.mjs";
import { TEAM_CONFIG_KEY } from "./lib/team.mjs";
import { askTeam, isInteractive, readSavedTeam, saveTeam, stop } from "./lib/team-io.mjs";
import { loadTypes } from "./lib/types.mjs";

const COMMAND = "team:set";
const { flags, positional } = parseArgs(process.argv.slice(2), { boolean: ["json", "show"] });
const json = flags.json === true;
const { teamLabels } = loadTypes(root);
const previous = readSavedTeam(root);

const out = (data) => {
  if (json)
    console.log(JSON.stringify({ command: COMMAND, ok: true, key: TEAM_CONFIG_KEY, ...data }, null, 2));
};

if (flags.show === true) {
  if (!previous) {
    if (json)
      console.log(JSON.stringify({ command: COMMAND, ok: false, key: TEAM_CONFIG_KEY, team: null }, null, 2));
    else console.error(`No team saved. Run "pnpm team:set <team>" (${teamLabels.join(", ")}).`);
    process.exit(EXIT.failed);
  }
  out({ team: previous });
  if (!json) console.log(previous);
  process.exit(EXIT.ok);
}

if (positional.length > 1) stop(COMMAND, EXIT.usage, "usage: pnpm team:set [<team>] [--show] [--json]", json);
let team = positional[0] ?? null;
if (team === null) {
  if (!isInteractive()) {
    stop(
      COMMAND,
      EXIT.usage,
      `No team given and no terminal to ask in. Run: pnpm team:set <${teamLabels.join("|")}>`,
      json,
    );
  }
  team = await askTeam(teamLabels);
  if (!team) stop(COMMAND, EXIT.usage, "No team chosen.", json);
}
if (!teamLabels.includes(team))
  stop(COMMAND, EXIT.usage, `Unknown team "${team}". Use one of: ${teamLabels.join(", ")}.`, json);

try {
  saveTeam(root, team);
} catch (err) {
  stop(COMMAND, EXIT.environment, `git config failed: ${err.stderr?.toString().trim() || err.message}`, json);
}
out({ team, previous });
if (!json) {
  console.log(
    previous && previous !== team
      ? `ok: team:set: you are on ${team} (was ${previous})`
      : `ok: team:set: you are on ${team}`,
  );
}
process.exit(EXIT.ok);
