// `pnpm check:ownership`: a work branch only changes files its team label owns (tooling/ownership.json)
// and shared files. Another owner's files fail, unless the issue has a line "Cross-team: <why>".
//
//   pnpm check:ownership                    the current branch against its base
//   --base <branch> --head <ref>            compare other refs (CI passes the PR's)
//   --offline                               don't look up the issue's "Cross-team:" line
//   --json                                  machine-readable output
//
// Exit codes: 0 valid, 1 problems found, 2 usage error, 3 environment problem (git, gh).
import { parseArgs } from "./lib/args.mjs";
import { checkOwnership, explainsCrossTeam } from "./lib/check-ownership.mjs";
import { changedPaths, getIssue, resolveContext, root } from "./lib/context.mjs";
import { loadOwnership } from "./lib/ownership.mjs";
import { print, result, skipped } from "./lib/report.mjs";
import { WORK_BRANCH } from "./lib/rules.mjs";

const { flags } = parseArgs(process.argv.slice(2), { boolean: ["json", "offline"] });
const json = flags.json === true;
const { branch, baseRef, head } = resolveContext(flags);
const work = WORK_BRANCH.exec(branch);

if (!work || !baseRef) {
  process.exit(print("ownership", skipped(`${branch} is not a work branch`), json));
}
const [, label, number] = work;
const files = changedPaths(baseRef, head);
const crossTeam = flags.offline !== true && explainsCrossTeam(getIssue(Number(number))?.body);
const { problems, warnings } = checkOwnership({ label, files, ownership: loadOwnership(root), crossTeam });
process.exit(
  print(
    "ownership",
    result(`${files.length} changed file(s) checked against ${label}`, problems, warnings),
    json,
  ),
);
