// The rules behind `pnpm issues:close-shipped`: which issues a merged promotion ships. GitHub only acts on
// "Closes #N" when a PR merges into the default branch, and work PRs merge into feature/team-N, so their
// issues would stay open. No I/O here.

const MERGE_SUBJECT = /^Merge pull request #(\d+) from \S+/;
// GitHub's closing keywords: close, closes, closed, fix, fixes, fixed, resolve, resolves, resolved.
const CLOSING = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)\b/gi;

/** A PR from feature/team-N into main. */
export function isPromotion(pr: { head: string; base: string }): boolean {
  return /^feature\/team-[1-4]$/.test(pr.head) && pr.base === "main";
}

/** The PRs whose merge commits a promotion carries, from its commit subjects, in order. */
export function mergedPrNumbers(subjects: string[]): number[] {
  const out: number[] = [];
  for (const s of subjects) {
    const n = Number(MERGE_SUBJECT.exec(s.trim())?.[1]);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/** The issues a PR body closes. Refs #N only refers to one, so it is left out. */
export function closingIssues(body: string | null): number[] {
  const html = /<!--[\s\S]*?-->/g;
  const found = [...(body ?? "").replace(html, "").matchAll(CLOSING)].map((m) => Number(m[1]));
  return [...new Set(found)];
}

export interface WorkPr {
  number: number;
  base: string;
  head: string;
  merged: boolean;
  body: string | null;
}

/**
 * Issue -> the work PR that closes it, for the PRs a promotion into main carries. Only merged work PRs
 * into that team's branch count: a sync PR (head main) carries main's own work, already shipped.
 */
export function shippedIssues(promotionHead: string, prs: WorkPr[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const pr of prs) {
    if (!pr.merged || pr.base !== promotionHead || pr.head === "main") continue;
    for (const issue of closingIssues(pr.body)) if (!out.has(issue)) out.set(issue, pr.number);
  }
  return out;
}

export function shippedComment(promotion: number, pr: number): string {
  return `Shipped to production in #${promotion}, which carried #${pr} into \`main\`.`;
}
