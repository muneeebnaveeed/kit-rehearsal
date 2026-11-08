// `pnpm check:commit`: checks commit messages against the repo's format: Conventional Commits
// ("feat(team-2): add login page") with an issue reference ("Refs #14") in the body.
//
//   pnpm check:commit --file .git/COMMIT_EDITMSG   one message (this is what a commit-msg hook passes)
//   pnpm check:commit --message "feat: add x"      one message given inline
//   pnpm check:commit --range origin/main..HEAD    every non-merge commit in a range
//   pnpm check:commit --range base..HEAD --exclude origin/main
//                                                 skip commits already reachable from a trusted ref
//   pnpm check:commit                              the last commit
//   --json                                         machine-readable output
//
// Merge commits, reverts and fixup!/squash! commits are exempt.
// Exit codes: 0 all valid, 1 problems found, 2 usage error, 3 environment problem (git).
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EXIT, parseArgs } from "./lib/args.mjs";
import { checkCommit, commitRangeArgs, parseLog } from "./lib/check-commit.mjs";
import { git } from "./lib/git.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const { flags } = parseArgs(process.argv.slice(2), { boolean: ["json"] });
const json = flags.json === true;

/** @type {{ id: string, message: string, stripComments: boolean }[]} */
let commits;
try {
  if (typeof flags.file === "string") {
    if (!existsSync(flags.file)) {
      console.error(`error: file not found: ${flags.file}`);
      process.exit(EXIT.usage);
    }
    commits = [{ id: flags.file, message: readFileSync(flags.file, "utf8"), stripComments: true }];
  } else if (typeof flags.message === "string") {
    commits = [{ id: "message", message: flags.message, stripComments: false }];
  } else {
    if (flags.exclude === true) {
      console.error("error: --exclude needs a Git ref");
      process.exit(EXIT.usage);
    }
    const range = typeof flags.range === "string" ? [flags.range] : ["-1", "HEAD"];
    const exclude = typeof flags.exclude === "string" ? flags.exclude : undefined;
    const out = git(root, commitRangeArgs(range, exclude));
    commits = parseLog(out).map((c) => ({ id: c.sha.slice(0, 7), message: c.message, stripComments: false }));
  }
} catch (err) {
  console.error(`error: git failed: ${err.stderr?.toString().trim() || err.message}`);
  process.exit(EXIT.environment);
}

const results = commits.map((c) => ({
  id: c.id,
  ...checkCommit(c.message, { stripComments: c.stripComments }),
}));
const failed = results.filter((r) => !r.ok);

if (json) {
  console.log(
    JSON.stringify({ ok: failed.length === 0, checked: results.length, commits: results }, null, 2),
  );
} else if (failed.length === 0) {
  console.log(`ok: ${results.length} commit message(s) follow the format`);
} else {
  console.error(`${failed.length} of ${results.length} commit message(s) do not follow the format:`);
  for (const r of failed) {
    console.error(`\n  ${r.id}  ${r.subject}`);
    for (const p of r.problems) console.error(`    - [${p.rule}] ${p.message}`);
  }
}
process.exit(failed.length === 0 ? EXIT.ok : EXIT.failed);
