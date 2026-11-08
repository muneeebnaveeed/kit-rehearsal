// Tests for `pnpm pipeline` (lib/pipeline.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkIssue } from "./lib/check-issue.mjs";
import { outcome, summaryLine, syncOutcome, trackingIssue } from "./lib/pipeline.ts";

const root = new URL("../../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, root), "utf8");
const config = JSON.parse(read("tooling/workflow/types.json"));
const templates = Object.fromEntries(
  Object.entries(config.types as Record<string, { issueTemplate: string | null }>)
    .filter(([, t]) => t.issueTemplate)
    .map(([name, t]) => [name, read(t.issueTemplate as string)]),
);

describe("trackingIssue", () => {
  it("names one issue per team and step", () => {
    expect(trackingIssue({ kind: "promote", team: "team-3" })).toMatchObject({
      title: "[team-3] Promotions from feature/team-3",
      label: "team-3",
    });
    expect(trackingIssue({ kind: "sync", team: "team-3" })).toMatchObject({
      title: "[platform] Syncs from main into feature/team-3",
      // branches:sync only accepts a platform issue.
      label: "platform",
    });
  });

  it.each(["promote", "sync"] as const)("gives %s an issue check:issue accepts", (kind) => {
    const { title, label, body } = trackingIssue({ kind, team: "team-1" });
    expect(checkIssue({ title, body, labels: [label], type: "chore", config, templates }).problems).toEqual(
      [],
    );
  });
});

describe("outcome", () => {
  const refused = (...rules: string[]) => ({
    summary: "no promotion PR was opened",
    problems: rules.map((rule) => ({ rule, message: `${rule} happened.` })),
  });

  it("reports an opened PR by its URL", () => {
    expect(outcome(0, { url: "https://github.com/o/r/pull/9" })).toEqual({
      status: "opened",
      message: "https://github.com/o/r/pull/9",
    });
  });

  it("skips the hour when there is nothing new, a PR is open or the branch is missing", () => {
    for (const rule of ["nothing", "already-open", "branch"]) {
      expect(outcome(1, refused(rule)).status).toBe("skipped");
    }
  });

  it("fails on any other refusal, a usage or environment error, or a crash", () => {
    expect(outcome(1, refused("issue")).status).toBe("failed");
    expect(outcome(1, refused("nothing", "drift")).status).toBe("failed");
    expect(outcome(3, null)).toEqual({ status: "failed", message: "exit code 3" });
    expect(outcome(1, null).status).toBe("failed");
  });
});

describe("syncOutcome", () => {
  const url = "https://github.com/o/r/pull/12";
  const synced = (b: {
    status: string;
    url?: string;
    conflicts?: string[];
    autoMerge?: boolean;
    behind?: number;
  }) => ({
    summary: "",
    problems: [],
    branches: [{ branch: "feature/team-2", ...b }],
  });

  it("reports a clean sync with auto-merge by its URL", () => {
    expect(syncOutcome(0, synced({ status: "opened", url, conflicts: [], autoMerge: true }))).toEqual({
      status: "opened",
      message: url,
    });
  });

  it("opens a sync that conflicts without auto-merge, and says a person must resolve it", () => {
    const res = syncOutcome(0, synced({ status: "opened", url, conflicts: ["a.ts"], autoMerge: false }));
    expect(res.status).toBe("conflicted");
    expect(res.message).toContain(url);
    expect(res.message).toContain("Auto-merge is off: merging conflicts in `a.ts`");
    expect(res.message).toContain("team branch");
    expect(
      syncOutcome(0, synced({ status: "opened", url, conflicts: [], autoMerge: false })).message,
    ).toContain("can't predict conflicts");
  });

  it("skips the hour when the branch is current, already has a sync PR, or is missing", () => {
    expect(syncOutcome(0, synced({ status: "up-to-date", behind: 0 }))).toEqual({
      status: "skipped",
      message: "feature/team-2 already has everything on main.",
    });
    expect(syncOutcome(0, synced({ status: "already-open", url })).message).toContain(url);
    expect(syncOutcome(0, synced({ status: "missing" })).message).toContain("origin has no feature/team-2");
  });

  it("fails on a wrong issue, an invalid draft, an environment error or a crash", () => {
    const wrongIssue = { summary: "no PRs were opened", problems: [{ rule: "issue", message: "Issue #3." }] };
    expect(syncOutcome(1, wrongIssue)).toEqual({ status: "failed", message: "Issue #3." });
    expect(syncOutcome(1, synced({ status: "invalid" })).status).toBe("failed");
    expect(syncOutcome(3, null)).toEqual({ status: "failed", message: "exit code 3" });
    expect(syncOutcome(0, { branches: [] }).status).toBe("failed");
  });
});

describe("summaryLine", () => {
  it("says which step it was and what happened", () => {
    expect(
      summaryLine({ kind: "promote", team: "team-2" }, { status: "skipped", message: "nothing happened." }),
    ).toBe("- **Promotion (feature/team-2 into main)**: skipped. nothing happened.");
    expect(summaryLine({ kind: "sync", team: "team-2" }, { status: "conflicted", message: "x" })).toBe(
      "- **Sync (main into feature/team-2)**: opened, NEEDS A PERSON. x",
    );
  });
});
