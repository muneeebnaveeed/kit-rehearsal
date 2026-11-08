// Tests for `pnpm issues:close-shipped` (lib/close-shipped.ts).
import { describe, expect, it } from "vitest";
import {
  closingIssues,
  isPromotion,
  mergedPrNumbers,
  shippedComment,
  shippedIssues,
  type WorkPr,
} from "./lib/close-shipped.ts";

describe("isPromotion", () => {
  it("is a team branch into main, nothing else", () => {
    expect(isPromotion({ head: "feature/team-2", base: "main" })).toBe(true);
    expect(isPromotion({ head: "team-2/14-add-login", base: "feature/team-2" })).toBe(false);
    expect(isPromotion({ head: "main", base: "feature/team-2" })).toBe(false);
    expect(isPromotion({ head: "platform/9-ci", base: "main" })).toBe(false);
  });
});

describe("mergedPrNumbers", () => {
  it("reads GitHub's merge commit subjects once each, skipping other commits", () => {
    expect(
      mergedPrNumbers([
        "feat(team-2): add login page",
        "Merge pull request #14 from org/team-2/14-add-login",
        "Merge pull request #19 from org/main",
        "Merge branch 'main' into team-2/20-fix",
        "Merge pull request #14 from org/team-2/14-add-login",
      ]),
    ).toEqual([14, 19]);
  });
});

describe("closingIssues", () => {
  it("finds every closing keyword, but not Refs or a template comment", () => {
    expect(closingIssues("**Linked issue**: Closes #12\nAlso fixes #3, resolved: #4. Refs #7")).toEqual([
      12, 3, 4,
    ]);
    expect(closingIssues("**Linked issue**: Closes # <!-- e.g. Closes #1 -->")).toEqual([]);
    expect(closingIssues(null)).toEqual([]);
  });
});

describe("shippedIssues", () => {
  const pr = (over: Partial<WorkPr>): WorkPr => ({
    number: 14,
    base: "feature/team-2",
    head: "team-2/12-add-login",
    merged: true,
    body: "**Linked issue**: Closes #12",
    ...over,
  });

  it("maps each issue to the first work PR into the team branch that closes it", () => {
    const got = shippedIssues("feature/team-2", [pr({}), pr({ number: 15, body: "Fixes #12, fixes #13" })]);
    expect([...got]).toEqual([
      [12, 14],
      [13, 15],
    ]);
  });

  it("ignores syncs, unmerged PRs and PRs into another branch", () => {
    const got = shippedIssues("feature/team-2", [
      pr({ head: "main", body: "Closes #1" }),
      pr({ merged: false, body: "Closes #2" }),
      pr({ base: "feature/team-3", body: "Closes #3" }),
    ]);
    expect(got.size).toBe(0);
  });
});

describe("shippedComment", () => {
  it("names the promotion and the work PR", () => {
    expect(shippedComment(30, 14)).toBe("Shipped to production in #30, which carried #14 into `main`.");
  });
});
