// Tests for `pnpm check:review` (lib/check-review.mjs).
import { describe, expect, it } from "vitest";
import { checkReview, latestDecisions } from "./lib/check-review.mjs";

const review = (login: string, state: string, submittedAt: string) => ({
  author: login,
  state,
  submittedAt,
});

describe("check:review", () => {
  it("passes with an approval from someone other than the author", () => {
    const r = checkReview({ author: "alice", reviews: [review("bob", "APPROVED", "2026-11-01T10:00:00Z")] });
    expect(r.ok).toBe(true);
    expect(r.approvers).toEqual(["bob"]);
  });

  it("fails without reviews", () => {
    const r = checkReview({ author: "alice", reviews: [] });
    expect(r.ok).toBe(false);
    expect(r.problems.map((p) => p.rule)).toEqual(["approval"]);
  });

  it("ignores the author's own approval", () => {
    const r = checkReview({
      author: "alice",
      reviews: [review("alice", "APPROVED", "2026-11-01T10:00:00Z")],
    });
    expect(r.ok).toBe(false);
  });

  it("ignores comments and only counts each reviewer's latest decision", () => {
    expect(
      checkReview({
        author: "alice",
        reviews: [
          review("bob", "APPROVED", "2026-11-01T10:00:00Z"),
          review("bob", "CHANGES_REQUESTED", "2026-11-02T10:00:00Z"),
          review("carol", "COMMENTED", "2026-11-02T11:00:00Z"),
        ],
      }).ok,
    ).toBe(false);
    expect(
      checkReview({
        author: "alice",
        reviews: [
          review("bob", "CHANGES_REQUESTED", "2026-11-01T10:00:00Z"),
          review("bob", "COMMENTED", "2026-11-02T10:00:00Z"),
          review("bob", "APPROVED", "2026-11-03T10:00:00Z"),
          review("bob", "COMMENTED", "2026-11-04T10:00:00Z"),
        ],
      }).ok,
    ).toBe(true);
  });

  it("drops a dismissed approval", () => {
    const r = checkReview({
      author: "alice",
      reviews: [
        review("bob", "APPROVED", "2026-11-01T10:00:00Z"),
        review("bob", "DISMISSED", "2026-11-02T10:00:00Z"),
      ],
    });
    expect(r.ok).toBe(false);
  });

  it("sorts by time, not by list order", () => {
    const r = checkReview({
      author: "alice",
      reviews: [
        review("bob", "APPROVED", "2026-11-03T10:00:00Z"),
        review("bob", "CHANGES_REQUESTED", "2026-11-01T10:00:00Z"),
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("passes with one approval but warns about outstanding change requests", () => {
    const r = checkReview({
      author: "alice",
      reviews: [
        review("bob", "APPROVED", "2026-11-01T10:00:00Z"),
        review("carol", "CHANGES_REQUESTED", "2026-11-01T11:00:00Z"),
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.warnings.join("\n")).toMatch(/carol/);
  });

  it("ignores reviews from deleted accounts", () => {
    const r = checkReview({
      author: "alice",
      reviews: [{ author: null, state: "APPROVED", submittedAt: "2026-11-01T10:00:00Z" }],
    });
    expect(r.ok).toBe(false);
  });

  it("exposes each reviewer's latest decision", () => {
    const latest = latestDecisions("alice", [
      review("bob", "APPROVED", "2026-11-01T10:00:00Z"),
      review("carol", "COMMENTED", "2026-11-01T11:00:00Z"),
      review("alice", "APPROVED", "2026-11-01T12:00:00Z"),
    ]);
    expect([...latest]).toEqual([["bob", "APPROVED"]]);
  });
});
