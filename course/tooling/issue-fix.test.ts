import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ISSUE_COMMENT_MARKER, planIssueFix, prefixTeam } from "./lib/issue-fix.mjs";

const config = JSON.parse(
  readFileSync(new URL("../../tooling/workflow/types.json", import.meta.url), "utf8"),
);
const labels = config.teamLabels as string[];
const issue = (title: string, issueLabels: string[]) => ({
  number: 32,
  title,
  state: "OPEN",
  author: "someone",
  labels: issueLabels,
});
const plan = (title: string, issueLabels: string[]) =>
  planIssueFix({ issue: issue(title, issueLabels), config });

describe("prefixTeam", () => {
  it("reads well-formed and malformed team prefixes", () => {
    expect(prefixTeam("[team-4] X", labels).team).toBe("team-4");
    expect(prefixTeam("[team : 4] X", labels).team).toBe("team-4");
    expect(prefixTeam("[Team 4] X", labels).team).toBe("team-4");
    expect(prefixTeam("[TEAM4] X", labels).team).toBe("team-4");
    expect(prefixTeam("[Platform] X", labels).team).toBe("platform");
    expect(prefixTeam("[team instructor] X", labels).team).toBe("team-instructor");
  });
  it("returns no team for other prefixes or none", () => {
    expect(prefixTeam("[course] X", labels)).toEqual({ team: null, prefix: "[course]" });
    expect(prefixTeam("[team-9] X", labels).team).toBeNull();
    expect(prefixTeam("X", labels)).toEqual({ team: null, prefix: null });
  });
});

describe("planIssueFix", () => {
  it("changes nothing on an issue that follows the rules", () => {
    const p = plan("[team-2] Add login", ["team-2", "enhancement"]);
    expect(p.changes).toEqual({});
    expect(p.comment).toBeNull();
  });

  it("fixes a malformed prefix when the label names the team", () => {
    const p = plan("[team : 4] Game state/Clues", ["team-4"]);
    expect(p.changes).toEqual({ title: "[team-4] Game state/Clues" });
    expect(p.remaining).toEqual([]);
    expect(p.comment).toContain(ISSUE_COMMENT_MARKER);
  });

  it("adds the label the title names", () => {
    expect(plan("[team-1] Add x", []).changes).toEqual({ addLabels: ["team-1"] });
    expect(plan("[platform] Extend .gitignore", ["chore"]).changes).toEqual({ addLabels: ["platform"] });
  });

  it("adds the prefix when only the label names the team", () => {
    expect(plan("Add x", ["team-3"]).changes).toEqual({ title: "[team-3] Add x" });
    expect(plan("[course] Add x", ["team-3"]).changes).toEqual({ title: "[team-3] Add x" });
  });

  it("does both for a malformed prefix without a label", () => {
    expect(plan("[Team 2] Add x", []).changes).toEqual({ addLabels: ["team-2"], title: "[team-2] Add x" });
  });

  it("leaves a prefix that disagrees with the label to the author", () => {
    const p = plan("[team-1] Add x", ["team-2"]);
    expect(p.changes).toEqual({});
    expect(p.remaining.map((r) => r.rule)).toContain("labels");
    expect(p.comment).toContain("Still to do by the author");
  });

  it("can't fix an issue that names no team at all", () => {
    const p = plan("Document the branching workflow", ["documentation"]);
    expect(p.changes).toEqual({});
    expect(p.remaining.map((r) => r.rule).sort()).toEqual(["labels", "title"]);
    expect(p.comment).not.toBeNull();
    const closed = planIssueFix({
      issue: { ...issue("Document the branching workflow", ["documentation"]), state: "CLOSED" },
      config,
    });
    expect(closed.comment).toBeNull();
  });

  it("leaves several team labels to the author", () => {
    const p = plan("[team-1] Add x", ["team-1", "team-2"]);
    expect(p.changes).toEqual({});
    expect(p.remaining.length).toBeGreaterThan(0);
  });

  it("changes nothing on a second run", () => {
    const first = plan("[Team 2] Add x", []);
    const c = first.changes as { title: string; addLabels: string[] };
    const second = plan(c.title, c.addLabels);
    expect(second.changes).toEqual({});
    expect(second.comment).toBeNull();
  });
});

describe("planIssueFix on closed issues", () => {
  it("fixes a closed issue but never comments on it", () => {
    const p = planIssueFix({ issue: { ...issue("[team-1] Add x", []), state: "CLOSED" }, config });
    expect(p.changes).toEqual({ addLabels: ["team-1"] });
    expect(p.comment).toBeNull();
  });
});

describe("planIssueFix with an earlier comment", () => {
  it("updates the comment of an open issue that now passes", () => {
    const p = planIssueFix({ issue: issue("[team-2] Add x", ["team-2"]), config, hadComment: true });
    expect(p.comment).toContain("Nothing left to do");
  });
});
