// The rules behind `pnpm pipeline`: which tracking issue each step refers to, and whether a run of
// pnpm team:promote or pnpm branches:sync is a skipped hour, a PR opened, or a real failure. No I/O here.

export interface Step {
  kind: "promote" | "sync";
  team: string;
}

const issueBody = (goal: string, why: string, what: string, done: string) =>
  `## Goal\n\n${goal}\n\n## Why now\n\n${why}\n\n## What changes\n\n${what}\n\n## Done when\n\n- [ ] ${done}\n`;

/** The standing issue each automatic PR refers to with Refs #N, and the label it carries. */
export function trackingIssue(step: Step): { title: string; label: string; body: string } {
  const branch = `feature/${step.team}`;
  if (step.kind === "sync") {
    // branches:sync only accepts a platform issue: a sync merges every owner's files.
    return {
      title: `[platform] Syncs from main into ${branch}`,
      label: "platform",
      body: issueBody(
        `${branch} gets main's platform fixes, hooks and other teams' work as soon as they land.`,
        `A branch that falls behind main gets conflicted promotions.`,
        `The hourly pipeline refers every sync PR (main into ${branch}) to this issue. Keep it open.`,
        `${branch} stays current with main.`,
      ),
    };
  }
  return {
    title: `[${step.team}] Promotions from ${branch}`,
    label: step.team,
    body: issueBody(
      `${step.team}'s finished work reaches production every hour.`,
      `Every promotion PR must refer to an issue.`,
      `The hourly pipeline refers every promotion PR (${branch} into main) to this issue. Keep it open.`,
      `The event is over and the pipeline is off.`,
    ),
  };
}

/** Refusals of team:promote that only mean "not this hour". Anything else is a failure someone should look at. */
export const SKIP_RULES = ["nothing", "already-open", "branch"];

/** Branch states of branches:sync that only mean "not this hour". */
export const SYNC_SKIPS = ["missing", "up-to-date", "already-open"];

const skipText = (b: { branch: string; status: string; url?: string }) =>
  ({
    missing: `origin has no ${b.branch} branch.`,
    "up-to-date": `${b.branch} already has everything on main.`,
    "already-open": `A sync PR into ${b.branch} is already open: ${b.url}`,
  })[b.status];

interface Report {
  summary?: string;
  url?: string;
  problems?: { rule: string; message: string }[];
  warnings?: string[];
  branches?: { branch: string; status: string; url?: string; conflicts?: string[]; autoMerge?: boolean }[];
}

export interface Outcome {
  status: "opened" | "conflicted" | "skipped" | "failed";
  message: string;
}

const problemText = (exitCode: number, report: Report | null) =>
  (report?.problems ?? []).map((p) => p.message).join(" ") || report?.summary || `exit code ${exitCode}`;

/** What one run of pnpm team:promote --json came to. */
export function outcome(exitCode: number, report: Report | null): Outcome {
  if (exitCode === 0) return { status: "opened", message: report?.url ?? report?.summary ?? "opened" };
  const problems = report?.problems ?? [];
  const text = problemText(exitCode, report);
  if (exitCode === 1 && problems.length > 0 && problems.every((p) => SKIP_RULES.includes(p.rule))) {
    return { status: "skipped", message: text };
  }
  return { status: "failed", message: text };
}

/** What one run of pnpm branches:sync <N> --auto-merge --json came to. */
export function syncOutcome(exitCode: number, report: Report | null): Outcome {
  const branch = report?.branches?.length === 1 ? report.branches[0] : undefined;
  if (exitCode !== 0 || !branch) return { status: "failed", message: problemText(exitCode, report) };
  if (SYNC_SKIPS.includes(branch.status)) return { status: "skipped", message: skipText(branch) ?? "" };
  if (branch.status !== "opened") return { status: "failed", message: problemText(exitCode, report) };
  const url = branch.url ?? "opened";
  if (branch.autoMerge) return { status: "opened", message: url };
  // Its head is main, which nobody may push to, so the conflicts are resolved on a team branch.
  const why = branch.conflicts?.length
    ? `merging conflicts in ${branch.conflicts.map((f) => `\`${f}\``).join(", ")}`
    : "this git can't predict conflicts";
  return {
    status: "conflicted",
    message: `${url} Auto-merge is off: ${why}. Bring main in through a team branch (CLAUDE.md, Branches, step 3).`,
  };
}

/** One line for the run's summary page. */
export function summaryLine(step: Step, result: Outcome): string {
  const what =
    step.kind === "sync"
      ? `Sync (main into feature/${step.team})`
      : `Promotion (feature/${step.team} into main)`;
  const label = {
    opened: "opened",
    conflicted: "opened, NEEDS A PERSON",
    skipped: "skipped",
    failed: "FAILED",
  }[result.status];
  return `- **${what}**: ${label}. ${result.message}`;
}
