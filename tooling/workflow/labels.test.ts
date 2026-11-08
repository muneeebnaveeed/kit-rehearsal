// Tests for the label scheme (labels.json, labels:sync) and the PR status labeller (labels:prs).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { allLabels, labelsOf, planLabelSync } from "./lib/labels.mjs";
import { isStacked, labelChanges, waitingOn } from "./lib/pr-labels.mjs";

const root = new URL("../../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, root), "utf8");
const scheme = JSON.parse(read("tooling/workflow/labels.json"));
const types = JSON.parse(read("tooling/workflow/types.json"));
const statusLabels = labelsOf(scheme, "status");

describe("labels.json", () => {
  it("only has team and status labels", () => {
    expect(scheme.groups.map((g: { group: string }) => g.group)).toEqual(["team", "status"]);
    expect(labelsOf(scheme, "team")).toEqual(types.teamLabels);
    expect(statusLabels).toEqual(["stackpile", "waiting-on.author", "waiting-on.review", "waiting-on.merge"]);
  });

  it("has unique names, 6-digit colours and a description for every label", () => {
    const labels = allLabels(scheme);
    expect(new Set(labels.map((l: { name: string }) => l.name)).size).toBe(labels.length);
    for (const l of labels) {
      expect(l.color, l.name).toMatch(/^[0-9a-f]{6}$/);
      expect(l.description.length, l.name).toBeGreaterThan(0);
      expect(l.description.length, l.name).toBeLessThanOrEqual(100);
    }
  });

  it("no issue template adds a label", () => {
    for (const [type, t] of Object.entries(types.types as Record<string, { issueTemplate: string | null }>)) {
      if (t.issueTemplate) expect(read(t.issueTemplate), type).not.toMatch(/^labels:/m);
    }
  });
});

describe("planLabelSync", () => {
  const def = (name: string) => ({ name, color: "aaaaaa", description: name });
  const repo = (name: string, color = "aaaaaa", description = name) => ({ name, color, description });

  it("creates, updates and deletes, and leaves unknown labels alone", () => {
    const plan = planLabelSync(
      { groups: [{ labels: [def("team-1"), def("stackpile")] }], remove: ["bug", "absent"] },
      [repo("team-1", "ffffff"), repo("bug"), repo("cross-team")],
    );
    expect(plan.map((c: { action: string; name: string }) => [c.action, c.name])).toEqual([
      ["update", "team-1"],
      ["create", "stackpile"],
      ["delete", "bug"],
    ]);
  });

  it("is empty when the repo already matches, and matches names case-insensitively", () => {
    expect(
      planLabelSync({ groups: [{ labels: [def("team-1")] }] }, [repo("Team-1", "aaaaaa", "team-1")]),
    ).toEqual([]);
  });
});

describe("waitingOn", () => {
  const pr = (over = {}) => ({ isDraft: false, author: "ana", reviews: [], unresolvedThreads: 0, ...over });

  it("waits on review until someone other than the author approves", () => {
    expect(waitingOn(pr())).toBe("review");
    expect(waitingOn(pr({ reviews: [{ author: "ana", state: "APPROVED" }] }))).toBe("review");
    expect(waitingOn(pr({ reviews: [{ author: "ben", state: "COMMENTED" }] }))).toBe("review");
    expect(waitingOn(pr({ reviews: [{ author: "ben", state: "APPROVED" }] }))).toBe("merge");
  });

  it("waits on the author for changes requested, an unresolved thread or a draft", () => {
    expect(waitingOn(pr({ reviews: [{ author: "ben", state: "CHANGES_REQUESTED" }] }))).toBe("author");
    expect(waitingOn(pr({ reviews: [{ author: "ben", state: "APPROVED" }], unresolvedThreads: 1 }))).toBe(
      "author",
    );
    expect(waitingOn(pr({ isDraft: true, reviews: [{ author: "ben", state: "APPROVED" }] }))).toBe("author");
  });

  it("uses each reviewer's latest decision, ignoring later comments", () => {
    const changed = [
      { author: "ben", state: "CHANGES_REQUESTED" },
      { author: "ben", state: "APPROVED" },
      { author: "ben", state: "COMMENTED" },
    ];
    expect(waitingOn(pr({ reviews: changed }))).toBe("merge");
    const dismissed = [
      { author: "ben", state: "APPROVED" },
      { author: "ben", state: "DISMISSED" },
    ];
    expect(waitingOn(pr({ reviews: dismissed }))).toBe("review");
    const mixed = [
      { author: "ben", state: "APPROVED" },
      { author: "cy", state: "CHANGES_REQUESTED" },
    ];
    expect(waitingOn(pr({ reviews: mixed }))).toBe("author");
  });
});

describe("isStacked", () => {
  it("is true only for bases that aren't main or a feature branch", () => {
    for (const base of ["main", "feature/team-1", "feature/team-4"])
      expect(isStacked(base), base).toBe(false);
    for (const base of ["team-1/23-time-loop", "platform/10-checks", "feature/team-9"])
      expect(isStacked(base), base).toBe(true);
  });
});

describe("labelChanges", () => {
  const open = {
    number: 1,
    state: "OPEN" as const,
    isDraft: false,
    author: "ana",
    base: "feature/team-2",
    labels: ["team-2"],
    reviews: [],
    unresolvedThreads: 0,
  };

  it("adds one waiting label to a new PR and never touches other labels", () => {
    expect(labelChanges(open, statusLabels)).toEqual({ add: ["waiting-on.review"], remove: [] });
  });

  it("swaps the waiting label when the state changes, and adds stackpile for a stacked PR", () => {
    const pr = {
      ...open,
      base: "team-2/1-login",
      labels: ["team-2", "waiting-on.review"],
      reviews: [{ author: "ben", state: "APPROVED" }],
    };
    expect(labelChanges(pr, statusLabels)).toEqual({
      add: ["stackpile", "waiting-on.merge"],
      remove: ["waiting-on.review"],
    });
  });

  it("removes stackpile once the PR is retargeted", () => {
    const pr = { ...open, labels: ["team-2", "stackpile", "waiting-on.review"] };
    expect(labelChanges(pr, statusLabels)).toEqual({ add: [], remove: ["stackpile"] });
  });

  it("clears every status label from closed PRs and keeps the rest", () => {
    const pr = {
      ...open,
      state: "MERGED" as const,
      labels: ["team-2", "stackpile", "waiting-on.merge", "cross-team"],
    };
    expect(labelChanges(pr, statusLabels)).toEqual({ add: [], remove: ["stackpile", "waiting-on.merge"] });
  });
});
