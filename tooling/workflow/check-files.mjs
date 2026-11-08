// `pnpm check:files`: the branch adds no dependencies, build output, .env files or files over 1 MB.
// `pnpm check:secrets`: the lines it adds contain no tokens, keys or hard-coded passwords.
//
//   pnpm check:files | pnpm check:secrets   the current branch against its base
//   --base <branch> --head <ref>            compare other refs (CI passes the PR's)
//   --json                                  machine-readable output
//
// Exit codes: 0 valid, 1 problems found, 2 usage error, 3 environment problem (git).
import { parseArgs } from "./lib/args.mjs";
import { addedLines, checkFiles, findSecrets } from "./lib/check-files.mjs";
import { changedPaths, resolveContext, root } from "./lib/context.mjs";
import { git } from "./lib/git.mjs";
import { print, result, skipped } from "./lib/report.mjs";

const { flags, positional } = parseArgs(process.argv.slice(2), { boolean: ["json"] });
const mode = positional[0] === "secrets" ? "secrets" : "files";
const json = flags.json === true;
const { branch, baseRef, head } = resolveContext(flags);

if (!baseRef) process.exit(print(mode, skipped(`no base branch for ${branch}`), json));

if (mode === "secrets") {
  const diff = git(root, ["diff", "--unified=0", "--no-color", "--diff-filter=ACMR", `${baseRef}...${head}`]);
  const lines = addedLines(diff);
  process.exit(print("secrets", result(`${lines.length} added line(s) scanned`, findSecrets(lines)), json));
}

const files = changedPaths(baseRef, head).map((path) => ({
  path,
  bytes: Number(git(root, ["cat-file", "-s", `${head}:${path}`]).trim()),
}));
process.exit(print("files", result(`${files.length} changed file(s) checked`, checkFiles(files)), json));
