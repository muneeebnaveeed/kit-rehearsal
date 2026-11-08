// Tests for `pnpm sync`: which base a branch is brought up to date with, and how conflicts are read.
import { describe, expect, it } from "vitest";
import { parseConflictNames, syncBaseFor, syncResult } from "./lib/sync.mjs";

const teamLabels = ["team-1", "team-2", "team-3", "team-4", "platform", "team-instructor"];

describe("syncBaseFor", () => {
  it("brings a team work branch up to date with its feature branch, platform work with main", () => {
    expect(syncBaseFor("team-2/14-add-login", teamLabels)).toEqual({ base: "feature/team-2" });
    expect(syncBaseFor("platform/70-sync", teamLabels)).toEqual({ base: "main" });
    expect(syncBaseFor("team-instructor/20-rules", teamLabels)).toEqual({ base: "main" });
  });

  it("takes --base for a branch the model doesn't know", () => {
    expect(syncBaseFor("spike", teamLabels, "main")).toEqual({ base: "main" });
    expect(syncBaseFor("team-2/14-add-login", teamLabels, "main")).toEqual({ base: "main" });
  });

  it("refuses main and the feature branches, which only change through PRs", () => {
    expect(syncBaseFor("main", teamLabels).error).toContain("only change through pull requests");
    const feature = syncBaseFor("feature/team-3", teamLabels);
    expect(feature.error).toContain("pnpm branches:sync");
    // Even with --base: merging into a long-lived branch locally would mean pushing to it.
    expect(syncBaseFor("main", teamLabels, "feature/team-1").error).toBeDefined();
  });

  it("asks for --base when the branch name doesn't say", () => {
    expect(syncBaseFor("fix-stuff", teamLabels).error).toContain("--base");
    expect(syncBaseFor("HEAD", teamLabels).error).toContain("detached");
  });
});

describe("parseConflictNames", () => {
  it("reads the conflicted files from git merge-tree --name-only output", () => {
    const out = "4b825dc642cb6eb9a060e54bf8d69288fbee4904\nserver/a.ts\nserver/b.ts\nserver/a.ts\n\n";
    expect(parseConflictNames(out, { mergeTree: true })).toEqual(["server/a.ts", "server/b.ts"]);
  });

  it("reads the unmerged files from git diff --name-only --diff-filter=U", () => {
    expect(parseConflictNames("games/team-2/a.ts\ngames/team-2/b.ts\n")).toEqual([
      "games/team-2/a.ts",
      "games/team-2/b.ts",
    ]);
    expect(parseConflictNames("")).toEqual([]);
  });
});

describe("syncResult", () => {
  const base = { branch: "team-2/14-add-login", base: "feature/team-2", behind: 3, dryRun: false };

  it("is ok when the branch is already up to date", () => {
    const r = syncResult({ ...base, behind: 0, conflicts: [] });
    expect(r).toMatchObject({ ok: true, merged: false, behind: 0 });
    expect(r.summary).toContain("already up to date");
  });

  it("is ok after a clean merge, and says to push", () => {
    const r = syncResult({ ...base, conflicts: [] });
    expect(r).toMatchObject({ ok: true, merged: true, conflicts: [] });
    expect(r.summary).toContain("merged 3 commit(s) from origin/feature/team-2");
    expect(r.warnings.join()).toContain("git push");
  });

  it("reports every conflicted file and how to finish or abort, without resolving anything", () => {
    const r = syncResult({ ...base, conflicts: ["games/team-2/a.ts", "games/team-2/b.ts"] });
    expect(r.ok).toBe(false);
    expect(r.problems.map((p) => p.rule)).toEqual(["conflict", "conflict"]);
    expect(r.problems[0]).toMatchObject({ file: "games/team-2/a.ts" });
    expect(r.problems[0]?.fix).toContain("git merge --abort");
  });

  it("in a dry run predicts the merge without making it", () => {
    const clean = syncResult({ ...base, dryRun: true, conflicts: [] });
    expect(clean).toMatchObject({ ok: true, merged: false, dryRun: true });
    expect(clean.summary).toContain("would merge 3 commit(s)");
    const conflicted = syncResult({ ...base, dryRun: true, conflicts: ["a.ts"] });
    expect(conflicted.ok).toBe(false);
    expect(conflicted.problems[0]?.message).toContain("would conflict");
  });

  it("refuses to start with uncommitted changes", () => {
    const r = syncResult({ ...base, dirty: ["server/x.ts"], conflicts: [] });
    expect(r.ok).toBe(false);
    expect(r.problems.map((p) => p.rule)).toEqual(["dirty"]);
    expect(r.merged).toBe(false);
  });

  it("refuses while another merge is still in progress", () => {
    const r = syncResult({ ...base, mergeInProgress: true, conflicts: [] });
    expect(r.problems.map((p) => p.rule)).toEqual(["merge-in-progress"]);
  });
});
