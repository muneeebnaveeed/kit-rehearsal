// `pnpm check:review`: a pull request has an approving review from someone other than its author.
// Each reviewer's latest decision counts (a later "changes requested" or a dismissal cancels an
// approval); comments don't.
//
//   pnpm check:review                the current branch's PR
//   pnpm check:review --number 45    another PR
//   --json                           machine-readable output
//
// Exit codes: 0 approved, 1 no approval from anyone but the author, 2 usage error (no such PR),
// 3 environment problem (gh missing or not logged in).
import { EXIT, parseArgs } from "./lib/args.mjs";
import { checkReview } from "./lib/check-review.mjs";
import { getPrReviews } from "./lib/gh.mjs";
import { print } from "./lib/report.mjs";
import { stop } from "./lib/team-io.mjs";

const COMMAND = "review";
const { flags, positional } = parseArgs(process.argv.slice(2), { boolean: ["json"] });
const json = flags.json === true;
const number = typeof flags.number === "string" ? flags.number : null;
if (positional.length > 0 || flags.number === true || (number !== null && !/^\d+$/.test(number))) {
  stop(COMMAND, EXIT.usage, "usage: pnpm check:review [--number <pr-number>] [--json]", json);
}

const pr = getPrReviews(number);
if (!pr) {
  stop(
    COMMAND,
    EXIT.usage,
    number ? `PR #${number} doesn't exist.` : "The current branch has no PR. Pass --number <pr-number>.",
    json,
  );
}
const res = checkReview({ author: pr.author, reviews: pr.reviews });
process.exit(
  print(COMMAND, { ...res, summary: `#${pr.number} ${res.summary}`, number: pr.number, url: pr.url }, json),
);
