// Prints the planned fixes and, with --apply, makes them on GitHub. Shared by pr-report.mjs and
// issue-report.mjs, so both behave the same way: a dry run by default, one comment per PR or issue that
// is updated rather than repeated, and a second run that changes nothing.
import { applyChanges, hideAsOutdated, tempDir, upsertComment } from "./github.mjs";

/**
 * @param {{
 *   root: string,
 *   repo: string,
 *   kind: "pr" | "issue",
 *   apply: boolean,
 *   items: {
 *     plan: { number: number, state: string, team: string | null, changes: Record<string, unknown>, fixed: string[], remaining: { rule: string, message: string }[], comment: string | null },
 *     ownComment?: { id?: string, databaseId: number, body: string, isMinimized?: boolean } | null,
 *   }[],
 * }} input
 * @returns {{ edited: number, commented: number, hidden: number, failed: number, touched: number }}
 */
export function runFixes({ root, repo, kind, apply, items }) {
  const tmp = tempDir();
  const counts = { edited: 0, commented: 0, hidden: 0, failed: 0, touched: 0 };
  try {
    for (const item of [...items].sort((a, b) => b.plan.number - a.plan.number)) {
      const { ownComment } = item;
      const plan = { ...item.plan, comment: keepFixedSection(item.plan.comment, ownComment?.body) };
      const hasChanges = Object.keys(plan.changes).length > 0;
      const commentChanged = plan.comment !== null && !sameComment(plan.comment, ownComment?.body);
      const hide = shouldHide(plan, ownComment);
      if (!hasChanges && !commentChanged && !hide) continue;
      counts.touched++;

      console.log(`#${plan.number} (${plan.state.toLowerCase()}, ${plan.team ?? "no team"})`);
      for (const f of plan.fixed) console.log(`  fix:  ${f}`);
      for (const p of plan.remaining) console.log(`  left: [${p.rule}] ${p.message}`);
      if (commentChanged) console.log(`  ${ownComment ? "update" : "post"} comment`);
      if (hide) console.log("  hide the earlier comment as outdated");
      if (!apply) continue;

      try {
        if (hasChanges) {
          applyChanges(root, repo, kind, plan.number, plan.changes, tmp.dir);
          counts.edited++;
        }
        if (commentChanged) {
          upsertComment(root, repo, kind, plan.number, ownComment, plan.comment, tmp.dir);
          counts.commented++;
        }
        if (hide && ownComment?.id) {
          hideAsOutdated(root, ownComment.id);
          counts.hidden++;
        }
        console.log("  done");
      } catch (err) {
        counts.failed++;
        console.error(`  FAILED: ${err.stderr?.toString().trim() || err.message}`);
      }
    }
  } finally {
    tmp.remove();
  }
  const what = kind === "pr" ? "PR(s)" : "issue(s)";
  console.log(
    apply
      ? `\nEdited ${counts.edited} ${what}, commented on ${counts.commented}, hid ${counts.hidden} outdated comment(s), ${counts.failed} failed.`
      : `\nDry run: ${counts.touched} ${what} would change. Nothing was changed; add --apply to make these changes on GitHub.`,
  );
  return counts;
}

/**
 * On a merged or closed PR or issue the author can no longer act, so this tool's earlier comment there is
 * hidden as outdated. It stays on GitHub and anyone can expand it.
 * @param {{ state: string }} plan
 * @param {{ id?: string, isMinimized?: boolean } | null | undefined} ownComment
 */
export const shouldHide = (plan, ownComment) =>
  plan.state !== "OPEN" && Boolean(ownComment?.id) && !ownComment?.isMinimized;

const FIXED_SECTION = /\nFixed automatically:\n(?:- .*\n)+\n/;

/**
 * A run that fixes nothing new keeps the "Fixed automatically" list of the earlier comment, so the record
 * of what was changed stays and the comment is not rewritten for nothing.
 * @param {string | null} comment the new comment
 * @param {string | null | undefined} previous the comment this tool left before
 */
export function keepFixedSection(comment, previous) {
  if (!comment || !previous || FIXED_SECTION.test(comment)) return comment;
  const old = FIXED_SECTION.exec(previous.replace(/\r\n/g, "\n"));
  if (!old) return comment;
  // The section goes after the bold title line and its blank line.
  return comment.replace(/^(.*\n.*\n)\n/, `$1${old[0]}`);
}

const sameComment = (a, b) =>
  (a ?? "").replace(/\r\n/g, "\n").trim() === (b ?? "").replace(/\r\n/g, "\n").trim();
