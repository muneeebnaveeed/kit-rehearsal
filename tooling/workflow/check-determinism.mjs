// `pnpm check:determinism`: simulation code (room/, shared/, server core) doesn't call Math.random()
// or read the wall clock, so replays reproduce exactly. Opt a line out with "// determinism-ok: <reason>".
//
//   pnpm check:determinism [--json]
//
// Exit codes: 0 valid, 1 problems found, 3 environment problem (git).
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "./lib/args.mjs";
import { isSimulationFile, scanSource } from "./lib/check-determinism.mjs";
import { root } from "./lib/context.mjs";
import { git } from "./lib/git.mjs";
import { print, result } from "./lib/report.mjs";

const { flags } = parseArgs(process.argv.slice(2), { boolean: ["json"] });
const files = git(root, ["ls-files", "-z"]).split("\0").filter(isSimulationFile);
const problems = files.flatMap((f) => scanSource(f, readFileSync(path.join(root, f), "utf8")));
process.exit(
  print("determinism", result(`${files.length} simulation file(s) scanned`, problems), flags.json === true),
);
