import { describe, expect, it } from "vitest";
import { keepFixedSection, shouldHide } from "./lib/fix-runner.mjs";
import { issueCommentFor } from "./lib/issue-fix.mjs";
import { commentFor } from "./lib/pr-fix.mjs";

const left = [{ rule: "checklist", message: "1 checklist item(s) are not ticked." }];

describe("keepFixedSection", () => {
  it("keeps the earlier fixed list when a run fixes nothing new, so the comment stays the same", () => {
    const first = commentFor({ number: 125 }, ["added the `team-4` label"], left);
    const second = commentFor({ number: 125 }, [], left);
    expect(second).not.toBe(first);
    expect(keepFixedSection(second, first)).toBe(first);
  });

  it("works for issue comments, and with CRLF line endings from GitHub", () => {
    const first = issueCommentFor(["added the `team-1` label"], left);
    expect(keepFixedSection(issueCommentFor([], left), first.replace(/\n/g, "\r\n"))).toBe(first);
  });

  it("uses the new fixed list when there is one", () => {
    const first = commentFor({ number: 1 }, ["added the `team-4` label"], left);
    const next = commentFor({ number: 1 }, ["fixed the title: `x`"], left);
    expect(keepFixedSection(next, first)).toBe(next);
  });

  it("leaves the comment alone without an earlier one or a comment", () => {
    const next = commentFor({ number: 1 }, [], left);
    expect(keepFixedSection(next, undefined)).toBe(next);
    expect(keepFixedSection(null, next)).toBeNull();
  });
});

describe("shouldHide", () => {
  const comment = { id: "IC_1", isMinimized: false };
  it("hides this tool's comment once the PR or issue is merged or closed", () => {
    expect(shouldHide({ state: "MERGED" }, comment)).toBe(true);
    expect(shouldHide({ state: "CLOSED" }, comment)).toBe(true);
  });
  it("keeps it on open items, and does nothing twice or without a comment", () => {
    expect(shouldHide({ state: "OPEN" }, comment)).toBe(false);
    expect(shouldHide({ state: "MERGED" }, { ...comment, isMinimized: true })).toBe(false);
    expect(shouldHide({ state: "MERGED" }, null)).toBe(false);
  });
});
