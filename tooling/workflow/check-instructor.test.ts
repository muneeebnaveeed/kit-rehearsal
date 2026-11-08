import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkInstructor,
  guardLabel,
  instructorClaims,
  isInstructor,
  itemFromEvent,
  loadInstructors,
} from "./lib/check-instructor.mjs";

const root = new URL("../../", import.meta.url);
const rootPath = fileURLToPath(root);
const instructors = ["instructor-a", "instructor-b", "instructor-c"];

const pr = (over: Record<string, unknown> = {}) => ({
  kind: "pr" as const,
  author: "student",
  labels: ["team-2"],
  title: "feat(team-2): add login",
  body: "## Team\n\nteam-2\n",
  instructors,
  ...over,
});
const issue = (over: Record<string, unknown> = {}) =>
  pr({ kind: "issue", title: "[team-2] Add login", ...over });

describe("instructorClaims", () => {
  it("is empty for an ordinary item", () => {
    expect(
      instructorClaims({ labels: ["team-2", "bug"], title: "fix(team-2): x", body: "## Team\n\nteam-2" }),
    ).toEqual([]);
  });

  it.each([
    ["the label", { labels: ["team-instructor"] }],
    ["a conventional title scope", { title: "docs(team-instructor): update readme" }],
    ["a scope with a breaking-change mark", { title: "feat(team-instructor)!: change the rule" }],
    ["the old [team-instructor] prefix", { title: "[team-instructor] Add a report" }],
    ["the Team section", { body: "## Summary\n\nx\n\n## Team\n\nteam-instructor\n" }],
    ["the Team section in backticks", { body: "## Team\n\n`team-instructor`\n" }],
    ["the Team section in capitals", { body: "## Team\n\nTeam-Instructor\n" }],
  ])("detects %s", (_name, over) => {
    expect(instructorClaims(over).length).toBeGreaterThan(0);
  });

  it("reports every way it is claimed", () => {
    const claims = instructorClaims({
      labels: ["team-instructor"],
      title: "feat(team-instructor): x",
      body: "## Team\n\nteam-instructor",
    });
    expect(claims).toHaveLength(3);
  });

  it("does not mistake a mention for a claim", () => {
    expect(
      instructorClaims({
        title: "docs(team-2): explain team-instructor rules",
        body: "## Summary\n\nteam-instructor owns course/",
      }),
    ).toEqual([]);
  });
});

describe("checkInstructor", () => {
  it("lets anyone use their own team", () => {
    expect(checkInstructor(pr())).toEqual({ ok: true, claims: [], problems: [] });
  });

  it("lets an instructor use the identity", () => {
    const r = checkInstructor(
      pr({ author: "instructor-a", labels: ["team-instructor"], title: "docs(team-instructor): x" }),
    );
    expect(r.ok).toBe(true);
    expect(r.claims.length).toBeGreaterThan(0);
  });

  it("compares logins case-insensitively", () => {
    expect(checkInstructor(pr({ author: "Instructor-A", labels: ["team-instructor"] })).ok).toBe(true);
  });

  it("blocks a student, and says what to do instead", () => {
    const r = checkInstructor(pr({ labels: ["team-instructor"] }));
    expect(r.ok).toBe(false);
    expect(r.problems[0]?.rule).toBe("identity");
    expect(r.problems[0]?.message).toContain("reserved for the instructors");
    expect(r.problems[0]?.message).toContain("student is not on the list");
    expect(r.problems[0]?.message).toContain("Cross-team: <why>");
  });

  it("blocks a title scope without the label", () => {
    expect(checkInstructor(pr({ title: "feat(team-instructor): add a report" })).ok).toBe(false);
  });

  it("blocks an issue the same way, and names it an issue", () => {
    const r = checkInstructor(
      issue({ labels: ["team-instructor"], title: "[team-instructor] Add a report" }),
    );
    expect(r.ok).toBe(false);
    expect(r.problems[0]?.message).toContain("This issue uses");
  });

  it("blocks when the author is unknown", () => {
    const r = checkInstructor(pr({ author: null, labels: ["team-instructor"] }));
    expect(r.ok).toBe(false);
    expect(r.problems[0]?.message).toContain("its author");
  });

  it("does not look at AI attribution: an instructor's agent-assisted PR passes", () => {
    const body =
      "## Team\n\nteam-instructor\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n\nCo-Authored-By: Claude <noreply@anthropic.com>";
    expect(checkInstructor(pr({ author: "instructor-b", labels: ["team-instructor"], body })).ok).toBe(true);
  });
});

describe("guardLabel", () => {
  it("ignores every other label", () => {
    expect(guardLabel({ label: "platform", actor: "student", instructors })).toBeNull();
    expect(guardLabel({ label: null, actor: "student", instructors })).toBeNull();
  });

  it("refuses team-instructor to someone who is not an instructor", () => {
    const g = guardLabel({ label: "team-instructor", actor: "student", instructors });
    expect(g && "error" in g && g.error).toContain("student is not on the list");
  });

  it("allows an instructor", () => {
    expect(guardLabel({ label: "team-instructor", actor: "Instructor-C", instructors })).toBeNull();
  });

  it("only warns when the account is unknown, because CI decides", () => {
    const g = guardLabel({ label: "team-instructor", actor: null, instructors });
    expect(g && "warning" in g).toBe(true);
  });
});

describe("itemFromEvent", () => {
  it("reads a pull_request event", () => {
    const e = {
      pull_request: { user: { login: "a" }, labels: [{ name: "team-1" }], title: "t", body: null },
    };
    expect(itemFromEvent(e)).toEqual({ kind: "pr", author: "a", labels: ["team-1"], title: "t", body: "" });
  });

  it("reads an issues event", () => {
    const e = { issue: { user: { login: "b" }, labels: [], title: "[team-1] t", body: "x" } };
    expect(itemFromEvent(e)).toEqual({
      kind: "issue",
      author: "b",
      labels: [],
      title: "[team-1] t",
      body: "x",
    });
  });

  it("returns null for anything else", () => {
    expect(itemFromEvent({ push: {} })).toBeNull();
  });
});

describe("the allowlist", () => {
  it("is a non-empty list of lower-case logins", () => {
    const logins = loadInstructors(rootPath);
    expect(logins.length).toBeGreaterThan(0);
    expect(logins.every((l: string) => l === l.toLowerCase() && /^[a-z0-9-]+$/.test(l))).toBe(true);
    expect(isInstructor((logins[0] ?? "").toUpperCase(), logins)).toBe(true);
    expect(isInstructor("someone-else", logins)).toBe(false);
    expect(isInstructor(null, logins)).toBe(false);
  });

  it("matches the owners in CODEOWNERS, so the review gate and the identity gate agree", () => {
    const logins = loadInstructors(rootPath).sort();
    const codeowners = readFileSync(new URL(".github/CODEOWNERS", root), "utf8")
      .split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("#"));
    expect(codeowners.length).toBeGreaterThan(0);
    for (const line of codeowners) {
      const owners = line
        .trim()
        .split(/\s+/)
        .slice(1)
        .map((o) => o.replace(/^@/, "").toLowerCase())
        .sort();
      expect(owners, `owners on "${line.trim()}"`).toEqual(logins);
    }
  });

  it("is protected by CODEOWNERS, together with the code that enforces it", () => {
    const text = readFileSync(new URL(".github/CODEOWNERS", root), "utf8");
    const paths = text
      .split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("#"))
      .map((l) => l.trim().split(/\s+/)[0]);
    for (const p of [
      "/course/",
      "/.github/instructors.json",
      "/.github/CODEOWNERS",
      "/.github/workflows/instructor-gate.yml",
      "/tooling/workflow/check-instructor.mjs",
      "/tooling/workflow/lib/check-instructor.mjs",
    ]) {
      expect(paths, `${p} in CODEOWNERS`).toContain(p);
      // A renamed or deleted file would leave CODEOWNERS protecting nothing.
      expect(existsSync(new URL(p.slice(1), root)), `${p} exists`).toBe(true);
    }
  });

  it("runs the pull request gate from the base branch, so a PR cannot edit the gate that judges it", () => {
    const workflow = readFileSync(new URL(".github/workflows/instructor-gate.yml", root), "utf8");
    expect(workflow).toMatch(/^ {2}pull_request_target:/m);
    expect(workflow).not.toMatch(/^ {2}pull_request:/m);
    // Only the issues job may write issues.
    expect(workflow.match(/issues: write/g)).toHaveLength(1);
  });
});
