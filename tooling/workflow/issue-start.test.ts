// Tests for `pnpm issue:start` (lib/issue-start.mjs).
import { describe, expect, it } from "vitest";
import { planIssueStart, slugify } from "./lib/issue-start.mjs";
import { WORK_BRANCH } from "./lib/rules.mjs";

const teamLabels = ["team-1", "team-2", "team-3", "team-4", "platform", "team-instructor"];
const rules = (r: { problems: { rule: string }[] }) => r.problems.map((p) => p.rule);

describe("slugify", () => {
  it("drops the [team] prefix and keeps lowercase words joined by hyphens", () => {
    expect(slugify("[team-2] Add login page")).toBe("add-login-page");
    expect(slugify("Fix: the score   doesn't reset!")).toBe("fix-the-score-doesn-t-reset");
  });

  it("cuts long titles at a word boundary, at most 40 characters", () => {
    const slug = slugify("[platform] Add workflow commands: issue:start, pr:open, sync, release");
    expect(slug).toBe("add-workflow-commands-issue-start-pr");
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slugify("a".repeat(60))).toBe("a".repeat(40));
  });

  it("falls back to 'work' when nothing is left, and always makes a valid branch name", () => {
    expect(slugify("[team-1] !!!")).toBe("work");
    for (const title of ["Ünïcödé títle", "--- dashes ---", "[x] 42 is the answer"]) {
      expect(WORK_BRANCH.test(`team-1/9-${slugify(title)}`)).toBe(true);
    }
  });
});

describe("planIssueStart", () => {
  const issue = {
    number: 14,
    title: "[team-2] Add login page",
    state: "OPEN",
    labels: ["team-2", "enhancement"],
    assignees: [],
  };
  const plan = (over: Record<string, unknown> = {}) =>
    planIssueStart({
      issue,
      team: "team-2",
      teamLabels,
      user: "alice",
      existingBranches: [],
      dirty: false,
      ...over,
    });

  it("plans the branch from the team's base branch", () => {
    expect(plan()).toMatchObject({
      ok: true,
      branch: "team-2/14-add-login-page",
      base: "feature/team-2",
      label: "team-2",
      problems: [],
    });
  });

  it("starts platform and instructor work from main", () => {
    const r = plan({
      team: "platform",
      issue: { ...issue, labels: ["platform"], title: "[platform] Add CI" },
    });
    expect(r).toMatchObject({ ok: true, branch: "platform/14-add-ci", base: "main" });
  });

  it("uses --slug when given", () => {
    expect(plan({ slug: "login" }).branch).toBe("team-2/14-login");
    expect(rules(plan({ slug: "Bad Slug" }))).toEqual(["slug"]);
  });

  it("refuses an issue that is missing, closed or has no single team label", () => {
    expect(rules(plan({ issue: null }))).toEqual(["issue"]);
    expect(rules(plan({ issue: { ...issue, state: "CLOSED" } }))).toEqual(["issue"]);
    expect(rules(plan({ issue: { ...issue, labels: ["enhancement"] } }))).toEqual(["label"]);
    expect(rules(plan({ issue: { ...issue, labels: ["team-2", "team-3"] } }))).toEqual(["label"]);
  });

  it("refuses another team's issue, and says how to override", () => {
    const r = plan({ team: "team-3" });
    expect(rules(r)).toEqual(["team"]);
    expect(r.problems[0]?.fix).toMatch(/--team team-2/);
  });

  it("refuses when the branch already exists or the working tree has changes", () => {
    expect(rules(plan({ existingBranches: ["team-2/14-add-login-page"] }))).toEqual(["exists"]);
    expect(rules(plan({ dirty: true }))).toEqual(["dirty"]);
  });

  it("warns when someone else is already assigned", () => {
    expect(plan({ issue: { ...issue, assignees: ["bob"] } }).warnings.join()).toMatch(/bob/);
    expect(plan({ issue: { ...issue, assignees: ["alice"] } }).warnings).toEqual([]);
  });
});
