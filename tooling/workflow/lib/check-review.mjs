// A PR has an approving review from someone other than its author (see "Review and merge" in
// CLAUDE.md). Pure: the caller passes the PR's author and its reviews, with each review's author as a
// login.

// Review states that change a reviewer's decision. COMMENTED and PENDING don't.
const DECISIVE = new Set(["APPROVED", "CHANGES_REQUESTED", "DISMISSED"]);

/**
 * @typedef {{ author: string | null, state: string, submittedAt?: string | null }} Review
 */

/**
 * Each reviewer's latest decisive review (approved, changes requested or dismissed), the way GitHub
 * counts them. The author's own reviews and reviews from deleted accounts are left out. Reviews are
 * taken in time order when they have `submittedAt`, else in list order. Also used by the labeller.
 * @param {string | null} author the PR's author
 * @param {Review[]} reviews
 * @returns {Map<string, string>} reviewer -> state
 */
export function latestDecisions(author, reviews) {
  const ordered = reviews
    .map((r, i) => ({ ...r, i }))
    .sort((a, b) => (a.submittedAt ?? "").localeCompare(b.submittedAt ?? "") || a.i - b.i);
  /** @type {Map<string, string>} */
  const latest = new Map();
  for (const r of ordered) {
    if (!r.author || r.author === author || !DECISIVE.has(r.state)) continue;
    latest.set(r.author, r.state);
  }
  return latest;
}

/**
 * @param {{ author: string, reviews: Review[] }} input
 */
export function checkReview({ author, reviews }) {
  /** @type {import("./report.mjs").Problem[]} */
  const problems = [];
  /** @type {string[]} */
  const warnings = [];
  const latest = latestDecisions(author, reviews);
  const approvers = [...latest].filter(([, s]) => s === "APPROVED").map(([login]) => login);
  const blocking = [...latest].filter(([, s]) => s === "CHANGES_REQUESTED").map(([login]) => login);
  if (approvers.length === 0) {
    problems.push({
      rule: "approval",
      message: `No approving review from someone other than the author (${author}).`,
      fix: "Ask a teammate to review the PR. Nobody approves their own PR.",
    });
  }
  if (blocking.length > 0) warnings.push(`Changes requested by ${blocking.join(", ")} are still open.`);

  const summary =
    approvers.length > 0 ? `approved by ${approvers.join(", ")}` : `no approval from anyone but ${author}`;
  return { ok: problems.length === 0, summary, problems, warnings, approvers };
}
