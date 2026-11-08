// `pnpm check:docs`: every relative link and heading anchor in the repo's Markdown files resolves.
//
//   pnpm check:docs [--json]
//
// Exit codes: 0 valid, 1 broken links, 3 environment problem (git).
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "./lib/args.mjs";
import { checkDocs } from "./lib/check-docs.mjs";
import { root } from "./lib/context.mjs";
import { git } from "./lib/git.mjs";
import { print, result } from "./lib/report.mjs";

const { flags } = parseArgs(process.argv.slice(2), { boolean: ["json"] });
const abs = (rel) => path.join(root, rel);
const files = git(root, ["ls-files", "-z", "*.md"])
  .split("\0")
  .filter((f) => f && existsSync(abs(f)));

const problems = checkDocs(files, {
  read: (rel) => readFileSync(abs(rel), "utf8"),
  exists: (rel) => existsSync(abs(rel)),
  isFile: (rel) => statSync(abs(rel)).isFile(),
});
process.exit(
  print("docs", result(`${files.length} Markdown file(s) checked`, problems), flags.json === true),
);
