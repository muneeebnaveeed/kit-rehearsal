// `pnpm check:branch`: the branch is named <team-label>/<issue>-<description>, targets the base the
// branch model expects, and its issue exists, is open and carries the same label.
//
//   pnpm check:branch                       the current branch, against the base it should target
//   --branch <name> --base <name>           check another branch / base (CI passes these through env vars)
//   --offline                               skip the GitHub lookup of the issue
//   --json                                  machine-readable output
//
// Exit codes: 0 valid, 1 problems found, 2 usage error, 3 environment problem (git, gh).
import { parseArgs } from "./lib/args.mjs";
import { checkBranch } from "./lib/check-branch.mjs";
import { getIssue, resolveContext } from "./lib/context.mjs";
import { print, result } from "./lib/report.mjs";
import { WORK_BRANCH } from "./lib/rules.mjs";

const { flags } = parseArgs(process.argv.slice(2), { boolean: ["json", "offline"] });
const { branch, base, teamLabels } = resolveContext(flags);
const work = WORK_BRANCH.exec(branch);
const issue = work && flags.offline !== true ? getIssue(Number(work[2])) : undefined;
const warnings = work && flags.offline === true ? ["offline: the issue and its label were not checked."] : [];

const problems = checkBranch({ branch, base, teamLabels, issue });
process.exit(
  print("branch", result(`${branch} -> ${base ?? "(no base)"}`, problems, warnings), flags.json === true),
);
