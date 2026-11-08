// Which status labels a pull request should carry: stackpile and one waiting-on.* label. Pure: the
// caller passes the PR's data from GitHub, so every rule is unit-tested. See "Labels" in CLAUDE.md.

import { latestDecisions } from "./check-review.mjs";

/** Bases that are not another PR: a PR into anything else is stacked on that PR. */
const LONG_LIVED = /^(main|feature\/team-[1-4])$/;

/**
 * @typedef {{ author: string | null, state: string }} Review
 * @typedef {{
 *   number: number,
 *   state: "OPEN" | "CLOSED" | "MERGED",
 *   isDraft: boolean,
 *   author: string | null,
 *   base: string,
 *   labels: string[],
 *   reviews: Review[],
 *   unresolvedThreads: number,
 * }} PullRequest
 */

/** @param {string} base */
export const isStacked = (base) => !LONG_LIVED.test(base);

/**
 * What the PR is waiting on: "author", "review" or "merge", in that order of precedence.
 * - author: a draft, changes requested by a reviewer, or an unresolved review thread
 * - review: no approval from someone other than the author
 * - merge: approved, with nothing open
 * Only each reviewer's latest decisive review counts (approved, changes requested or dismissed),
 * the way GitHub counts them; plain comments don't change a decision.
 * @param {Pick<PullRequest, "isDraft" | "author" | "reviews" | "unresolvedThreads">} pr
 */
export function waitingOn(pr) {
  const latest = latestDecisions(pr.author, pr.reviews);
  const states = [...latest.values()];
  if (pr.isDraft || states.includes("CHANGES_REQUESTED") || pr.unresolvedThreads > 0) return "author";
  if (!states.includes("APPROVED")) return "review";
  return "merge";
}

/**
 * The changes that bring a PR's status labels in line: open PRs get stackpile when stacked and exactly
 * one waiting-on.* label; closed and merged PRs lose them all. Other labels are never touched.
 * @param {PullRequest} pr
 * @param {string[]} statusLabels the labels.json "status" group
 */
export function labelChanges(pr, statusLabels) {
  /** @type {Set<string>} */
  const want = new Set();
  if (pr.state === "OPEN") {
    if (isStacked(pr.base)) want.add("stackpile");
    want.add(`waiting-on.${waitingOn(pr)}`);
  }
  const has = new Set(pr.labels);
  return {
    add: [...want].filter((l) => statusLabels.includes(l) && !has.has(l)).sort(),
    remove: pr.labels.filter((l) => statusLabels.includes(l) && !want.has(l)).sort(),
  };
}
