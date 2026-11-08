import { describe, expect, it } from "vitest";
import { checkCommit, commitRangeArgs, parseLog } from "./lib/check-commit.mjs";

const valid = "feat(team-2): add login page\n\nPlayers need an account.\n\nRefs #14\n";
const rules = (msg: string, opts = {}) => checkCommit(msg, opts).problems.map((p) => p.rule);

describe("checkCommit", () => {
  it("accepts a correct message", () => {
    expect(checkCommit(valid)).toMatchObject({ ok: true, exempt: false, problems: [] });
  });

  it.each([
    ["no scope", "fix: stop the crash\n\nRefs #3"],
    ["a breaking-change mark", "feat(platform)!: drop node 20\n\nRefs #3"],
    ["Closes instead of Refs", "docs: explain branches\n\nCloses #3"],
    ["a trailer after the reference", "chore: pin node\n\nRefs #3\n\nCo-Authored-By: A <a@b.c>"],
    ["CRLF line endings", "feat: add x\r\n\r\nRefs #3\r\n"],
    ["every allowed type", "perf(team-1): batch updates\n\nRefs #9"],
  ])("accepts %s", (_name, msg) => {
    expect(checkCommit(msg).problems).toEqual([]);
  });

  it.each([
    ["a missing type", "add login page\n\nRefs #1", "format"],
    ["an unknown type", "feature: add login\n\nRefs #1", "type"],
    ["an uppercase description", "feat: Add login page\n\nRefs #1", "case"],
    ["a trailing period", "feat: add login page.\n\nRefs #1", "period"],
    ["a past-tense verb", "feat: added login page\n\nRefs #1", "mood"],
    ["an -ing verb", "fix: fixing the crash\n\nRefs #1", "mood"],
    ["no blank line after the subject", "feat: add login\nRefs #1", "blank-line"],
    ["no issue reference", "feat: add login\n\nWhy not.", "issue"],
    ["a bare Refs #", "feat: add login\n\nRefs #", "issue"],
    ["an uppercase type", "Feat: add login\n\nRefs #1", "format"],
    ["a scope with spaces", "feat(team 2): add login\n\nRefs #1", "format"],
  ])("rejects %s", (_name, msg, rule) => {
    expect(rules(msg)).toContain(rule);
  });

  it("rejects a subject over 72 characters", () => {
    expect(rules(`feat: ${"a".repeat(70)}\n\nRefs #1`)).toContain("length");
  });

  it("rejects an empty message", () => {
    expect(rules("  \n")).toEqual(["empty"]);
  });

  it.each([
    "Merge branch 'main' into platform/1-x",
    "Merge pull request #5 from owner/x",
    'Revert "feat: add login"',
    "fixup! feat: add login",
    "squash! feat: add login",
  ])("exempts %s", (msg) => {
    expect(checkCommit(msg)).toMatchObject({ ok: true, exempt: true });
  });

  it("ignores # comment lines in an editor message only when asked to", () => {
    const edited = `# a hint line\n${valid}# Please enter the commit message\n`;
    expect(checkCommit(edited, { stripComments: true }).ok).toBe(true);
    expect(rules(edited)).toContain("format");
  });

  it("does not count a commented-out reference", () => {
    expect(rules("feat: add login\n\n# Refs #99\n", { stripComments: true })).toContain("issue");
  });

  it("skips blank lines before the subject", () => {
    expect(checkCommit(`\n\n${valid}`).ok).toBe(true);
  });
});

describe("parseLog", () => {
  it("splits git log output into commits", () => {
    const out = `abc123\x1ffeat: one\n\nRefs #1\n\x1e\ndef456\x1ffix: two\n\nRefs #2\n\x1e`;
    expect(parseLog(out)).toEqual([
      { sha: "abc123", message: "feat: one\n\nRefs #1\n" },
      { sha: "def456", message: "fix: two\n\nRefs #2\n" },
    ]);
  });

  it("returns nothing for an empty range", () => {
    expect(parseLog("")).toEqual([]);
  });
});

describe("commitRangeArgs", () => {
  it("can exclude commits already reachable from a trusted ref", () => {
    expect(commitRangeArgs(["base..HEAD"], "origin/main")).toEqual([
      "log",
      "--no-merges",
      "--format=%H%x1f%B%x1e",
      "base..HEAD",
      "--not",
      "origin/main",
    ]);
  });

  it("keeps the existing range behavior when there is no exclusion", () => {
    expect(commitRangeArgs(["-1", "HEAD"], undefined)).toEqual([
      "log",
      "--no-merges",
      "--format=%H%x1f%B%x1e",
      "-1",
      "HEAD",
    ]);
  });
});
