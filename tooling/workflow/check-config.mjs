// `pnpm check:config`: each game's config/game.json (the template and games/team-N/) matches the
// *ConfigSchema its shared/index.ts exports. Node strips the TypeScript types itself, so no build is
// needed, but the game's dependencies must be installed (pnpm install).
//
//   pnpm check:config [--json]
//
// Exit codes: 0 valid, 1 problems found, 3 environment problem (dependencies missing).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "./lib/args.mjs";
import { checkGameConfig } from "./lib/check-config.mjs";
import { environmentError, root } from "./lib/context.mjs";
import { print, result } from "./lib/report.mjs";

const { flags } = parseArgs(process.argv.slice(2), { boolean: ["json"] });

const dirs = ["server/template"];
if (existsSync(path.join(root, "games"))) {
  for (const entry of readdirSync(path.join(root, "games"), { withFileTypes: true })) {
    if (entry.isDirectory()) dirs.push(`games/${entry.name}`);
  }
}
const games = dirs.filter((dir) => existsSync(path.join(root, dir, "config", "game.json")));

const problems = [];
for (const dir of games) {
  const configFile = `${dir}/config/game.json`;
  const sharedFile = `${dir}/shared/index.ts`;
  if (!existsSync(path.join(root, sharedFile))) {
    problems.push({
      rule: "schema",
      file: configFile,
      message: `No ${sharedFile} with a config schema to check it against.`,
    });
    continue;
  }
  let shared;
  try {
    shared = await import(pathToFileURL(path.join(root, sharedFile)).href);
  } catch (err) {
    environmentError(`could not load ${sharedFile} (run pnpm install?): ${err.message}`);
  }
  const json = readFileSync(path.join(root, configFile), "utf8");
  problems.push(...checkGameConfig({ configFile, sharedFile, shared, json }));
}
process.exit(
  print("config", result(`${games.length} game config(s) checked`, problems), flags.json === true),
);
