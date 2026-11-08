// `pnpm check:contract`: warns when the branch changes the shared contract (server/core/src/shared/),
// which every game depends on. Never fails.
//
//   pnpm check:contract [--base <branch>] [--head <ref>] [--json]
//
// Exit codes: 0 always (warnings only), 3 environment problem (git).
import { parseArgs } from "./lib/args.mjs";
import { contractWarnings } from "./lib/check-contract.mjs";
import { changedPaths, resolveContext } from "./lib/context.mjs";
import { print, result, skipped } from "./lib/report.mjs";

const { flags } = parseArgs(process.argv.slice(2), { boolean: ["json"] });
const json = flags.json === true;
const { branch, baseRef, head } = resolveContext(flags);
if (!baseRef) process.exit(print("contract", skipped(`no base branch for ${branch}`), json));

const warnings = contractWarnings(changedPaths(baseRef, head));
const summary =
  warnings.length === 0 ? "no shared contract changes" : `${warnings.length} contract file(s) changed`;
process.exit(print("contract", result(summary, [], warnings), json));
