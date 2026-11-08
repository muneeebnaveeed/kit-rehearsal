// Tests for `pnpm pr:comments` (lib/pr-comments.ts).
import { describe, expect, it } from "vitest";
import { commentsMarkdown, normalize, type RawPullRequest, verdicts } from "./lib/pr-comments.ts";

const page = <T>(nodes: T[], hasNextPage = false) => ({ pageInfo: { hasNextPage }, nodes });
const by = (login: string, body: string, createdAt = "2026-11-07T10:00:00Z") => ({
  author: { login },
  body,
  url: `https://github.com/o/r/pull/7#${login}-${createdAt}`,
  createdAt,
});
const thread = (over: Partial<RawPullRequest["reviewThreads"]["nodes"][number]> = {}) => ({
  isResolved: false,
  isOutdated: false,
  path: "server/core/src/room.ts",
  line: 12,
  originalLine: 12,
  comments: page([by("reviewer", "Handle the empty room.")]),
  ...over,
});
const raw = (over: Partial<RawPullRequest> = {}): RawPullRequest => ({
  number: 7,
  title: "feat(team-2): add login page",
  url: "https://github.com/o/r/pull/7",
  author: { login: "student" },
  reviewThreads: page([]),
  reviews: page([]),
  comments: page([]),
  ...over,
});

describe("normalize", () => {
  it("marks an open thread waiting on the author when someone else spoke last", () => {
    const pr = normalize(
      raw({
        reviewThreads: page([
          thread(),
          thread({ comments: page([by("reviewer", "Why?"), by("student", "Because of #12.")]) }),
          thread({ isResolved: true }),
        ]),
      }),
    );
    expect(pr.threads.map((t) => t.waitingOnAuthor)).toEqual([true, false, false]);
  });

  it("uses the original line when the thread's line is gone", () => {
    expect(
      normalize(raw({ reviewThreads: page([thread({ line: null, originalLine: 9 })]) })).threads[0]?.line,
    ).toBe(9);
  });

  it("drops empty COMMENTED reviews, which only wrap inline comments", () => {
    const pr = normalize(
      raw({
        reviews: page([
          { author: { login: "a" }, state: "COMMENTED", body: "", url: "u1", submittedAt: "t1" },
          { author: { login: "b" }, state: "APPROVED", body: "", url: "u2", submittedAt: "t2" },
          { author: { login: "c" }, state: "COMMENTED", body: "Looks fine.", url: "u3", submittedAt: "t3" },
        ]),
      }),
    );
    expect(pr.reviews.map((r) => r.author)).toEqual(["b", "c"]);
  });

  it("names a deleted account ghost", () => {
    expect(
      normalize(raw({ comments: page([{ ...by("x", "hi"), author: null }]) })).discussion[0]?.author,
    ).toBe("ghost");
  });

  it("flags a PR with more than one page of anything", () => {
    expect(normalize(raw()).truncated).toBe(false);
    expect(normalize(raw({ comments: page([], true) })).truncated).toBe(true);
    expect(
      normalize(raw({ reviewThreads: page([thread({ comments: page([by("r", "x")], true) })]) })).truncated,
    ).toBe(true);
  });
});

describe("verdicts", () => {
  it("keeps each reviewer's latest verdict and ignores the author", () => {
    const pr = normalize(
      raw({
        reviews: page([
          {
            author: { login: "r" },
            state: "CHANGES_REQUESTED",
            body: "x",
            url: "u",
            submittedAt: "2026-11-07T09:00:00Z",
          },
          {
            author: { login: "r" },
            state: "APPROVED",
            body: "",
            url: "u",
            submittedAt: "2026-11-07T11:00:00Z",
          },
          {
            author: { login: "student" },
            state: "APPROVED",
            body: "",
            url: "u",
            submittedAt: "2026-11-07T12:00:00Z",
          },
        ]),
      }),
    );
    expect(verdicts(pr)).toEqual({ r: "APPROVED" });
  });
});

describe("commentsMarkdown", () => {
  const pr = normalize(
    raw({
      reviewThreads: page([
        thread({ path: "b.ts", comments: page([by("reviewer", "Fixed?"), by("student", "Yes.")]) }),
        thread({ path: "a.ts" }),
        thread({ path: "c.ts", isResolved: true }),
      ]),
      comments: page([by("teammate", "Ready for review.")]),
    }),
  );

  it("lists threads waiting on the author first, and only counts resolved ones", () => {
    const md = commentsMarkdown(pr);
    expect(md).toContain(
      "2 open review thread(s), 1 waiting on @student; 1 resolved (not shown; --all shows them).",
    );
    expect(md.indexOf("### a.ts:12 (waiting on author)")).toBeLessThan(md.indexOf("### b.ts:12"));
    expect(md).not.toContain("c.ts");
    expect(md).toContain("> Ready for review.");
  });

  it("shows resolved threads with --all", () => {
    expect(commentsMarkdown(pr, { all: true })).toContain("### c.ts:12 (resolved)");
  });

  it("quotes every line of a multi-line comment", () => {
    const md = commentsMarkdown(normalize(raw({ comments: page([by("r", "one\ntwo")]) })));
    expect(md).toContain("> one\n> two");
  });

  it("says so when there is nothing to answer", () => {
    expect(commentsMarkdown(normalize(raw()))).toContain("Nothing to answer.");
  });
});
