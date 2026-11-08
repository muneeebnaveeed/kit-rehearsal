import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { auditPr, formatReport, groupByTeam, linkedIssue, teamOf, uncheckedItems } from "./lib/pr-report.mjs";

const root = new URL("../../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, root), "utf8");
const config = JSON.parse(read("tooling/workflow/types.json"));

// The real templates, so a template change is covered by these tests.
const templates = Object.fromEntries(
  Object.entries(config.types as Record<string, { prTemplate: string | null }>)
    .filter(([, t]) => t.prTemplate)
    .map(([name, t]) => [name, read(t.prTemplate as string)]),
);

const template = (type: string) => {
  const md = templates[type];
  if (md === undefined) throw new Error(`no ${type} template`);
  return md;
};

/** A feature PR body that follows the template: placeholders filled, every box ticked. */
function body(linked = "Closes #12") {
  return template("feature")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\*\*Linked issue\*\*:.*$/m, `**Linked issue**: ${linked}`)
    .replace(/^\*\*Team\*\*:.*$/m, "**Team**: team-2")
    .replace(/- \[ \]/g, "- [x]")
    .replace(/^\*\*How to test\*\*:[ \t]*$/m, "**How to test**: pnpm test")
    .replace(/^\*\*Screenshots\*\*:[ \t]*$/m, "**Screenshots**: None, nothing visible changed")
    .replace(/^(\*\*(?!Checklist\*)[^*]+\*\*):[ \t]*$/gm, "$1: None");
}

const pr = {
  number: 30,
  title: "feat(team-2): add login",
  body: body(),
  head: "team-2/12-add-login",
  base: "feature/team-2",
  labels: ["team-2"],
  state: "OPEN",
  author: "someone",
};
const good = [{ message: "feat(team-2): add login\n\nRefs #12\n" }];
const issue = { number: 12, labels: ["team-2", "enhancement"] };
const audit = (over: Record<string, unknown> = {}) =>
  auditPr({ pr, commits: good, issue, config, templates, ...over });
const rules = (r: ReturnType<typeof audit>) => r.problems.map((p) => p.rule);

describe("linkedIssue", () => {
  it("reads the closing keyword", () => {
    expect(linkedIssue("Closes #14")).toBe(14);
    expect(linkedIssue("fixes #3 and more")).toBe(3);
  });
  it("accepts Refs only when allowed", () => {
    expect(linkedIssue("Refs #33")).toBeNull();
    expect(linkedIssue("Refs #33", { allowRefs: true })).toBe(33);
  });
  it("returns null without a body", () => {
    expect(linkedIssue(null)).toBeNull();
  });
});

describe("teamOf", () => {
  const labels = config.teamLabels;
  it("prefers the team label", () => {
    expect(teamOf({ title: "feat(team-1): x", head: "team-1/1-x", labels: ["team-3"] }, labels)).toBe(
      "team-3",
    );
  });
  it("falls back to the title scope, then the branch", () => {
    expect(teamOf({ title: "feat(team-1): x", head: "x", labels: [] }, labels)).toBe("team-1");
    expect(teamOf({ title: "feat(team-2): x", head: "team-1/1-x", labels: [] }, labels)).toBe("team-2");
    expect(teamOf({ title: "X", head: "platform/4-x", labels: [] }, labels)).toBe("platform");
    expect(teamOf({ title: "X", head: "feature/team-4", labels: [] }, labels)).toBe("team-4");
  });
  it("reads the team from a conventional title's scope", () => {
    expect(teamOf({ title: "feat(team-1): add x", head: "x", labels: [] }, labels)).toBe("team-1");
    expect(teamOf({ title: "fix(platform)!: drop y", head: "x", labels: [] }, labels)).toBe("platform");
    expect(teamOf({ title: "feat(game): add x", head: "x", labels: [] }, labels)).toBeNull();
  });
  it("returns null when nothing names a team", () => {
    expect(teamOf({ title: "[team-1] X", head: "1-x", labels: ["documentation"] }, labels)).toBeNull();
    expect(teamOf({ title: "feat(course): x", head: "1-x", labels: [] }, labels)).toBeNull();
  });
});

describe("auditPr", () => {
  it("passes a well-documented PR", () => {
    const r = audit();
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r).toMatchObject({ team: "team-2", linkedIssue: 12, type: "feature" });
  });

  it("reports the check:pr template problems", () => {
    expect(rules(audit({ pr: { ...pr, body: "**Summary**: Stuff" } }))).toContain("heading");
    expect(rules(audit({ pr: { ...pr, labels: [] } }))).toContain("labels");
  });

  it("reports a linked issue with another team label", () => {
    const r = audit({ issue: { number: 12, labels: ["team-3"] } });
    expect(rules(r)).toEqual(["issue-label"]);
    expect(r.problems[0]?.message).toContain("team-3");
  });

  it("reports a linked issue without a team label", () => {
    expect(rules(audit({ issue: { number: 12, labels: [] } }))).toEqual(["issue-label"]);
  });

  it("reports a linked issue that does not exist", () => {
    expect(rules(audit({ issue: null }))).toEqual(["issue"]);
  });

  it("reports commits that do not reference the linked issue", () => {
    const r = audit({
      commits: [
        ...good,
        { message: "feat(team-2): add logout\n\nRefs #99" },
        { message: "Add styles" },
        { message: "Merge branch 'feature/team-2' into team-2/12-add-login" },
      ],
    });
    expect(rules(r)).toEqual(["commit-refs"]);
    expect(r.problems[0]?.message).toMatch(/^2 of 3 commit/);
  });

  it("does not check commits or the issue label of sync and integration PRs", () => {
    const sync = auditPr({
      pr: { ...pr, head: "main", base: "feature/team-2", body: "Refs #33" },
      commits: [{ message: "whatever" }],
      issue: { number: 33, labels: [] },
      config,
      templates,
    });
    expect(rules(sync)).not.toContain("commit-refs");
    expect(rules(sync)).not.toContain("issue-label");
    const integration = audit({
      pr: { ...pr, head: "feature/team-2", base: "main" },
      commits: [{ message: "x" }],
    });
    expect(rules(integration)).not.toContain("commit-refs");
  });

  it("requires the Conventional title on merged PRs too", () => {
    const r = audit({ pr: { ...pr, title: "[team-2] Add login", state: "MERGED" } });
    expect(rules(r)).toContain("title");
  });

  it("warns when not every commit was read", () => {
    expect(audit({ commitsTruncated: true }).warnings).toHaveLength(1);
  });
});

describe("groupByTeam and formatReport", () => {
  const results = [
    audit(),
    audit({ pr: { ...pr, number: 31, labels: [], title: "Untitled", head: "x" } }),
    audit({ pr: { ...pr, number: 32 }, issue: { number: 12, labels: ["team-3"] } }),
  ];
  const groups = groupByTeam(results, config.teamLabels);

  it("groups per team, in label order, with PRs of no team last", () => {
    expect(groups.map((g) => g.team)).toEqual(["team-2", null]);
    expect(groups[0]).toMatchObject({ total: 2, passCount: 1, failCount: 1 });
    expect(groups[0]?.failing.map((r) => r.number)).toEqual([32]);
  });

  it("renders a summary table and the reasons per failing PR", () => {
    const md = formatReport(groups, { repo: "o/r", state: "all", generatedAt: "now" });
    expect(md).toContain("1 of 3 pull requests pass.");
    expect(md).toContain("| team-2 | 2 | 1 | 1 |");
    expect(md).toContain("| (no team) | 1 | 0 | 1 |");
    expect(md).toContain("**issue-label:**");
    expect(md).toContain("Passing: #30");
  });

  it("leaves out the passing list with failingOnly", () => {
    const md = formatReport(groups, { repo: "o/r", state: "all", generatedAt: "now", failingOnly: true });
    expect(md).not.toContain("Passing:");
  });
});

describe("Exception notes", () => {
  const withException = (item: string, note = "  Exception: pushed before the review, kept as asked.") =>
    body().replace(`- [x] ${item}`, `- [ ] ${item}\n\n${note}`);
  const commitsItem = "Commits follow Conventional Commits and reference the issue (`Refs #N`)";

  it("finds unticked items with and without an Exception note", () => {
    const b = withException(commitsItem).replace("- [x] I tested", "- [ ] I tested");
    const u = uncheckedItems(b);
    expect(u.open).toBe(1);
    expect(u.excepted).toEqual([commitsItem]);
    expect([...u.exceptedRules]).toEqual(["commit-refs"]);
  });

  it("accepts an unticked item with an Exception note, and the rule it covers", () => {
    const r = audit({
      pr: { ...pr, body: withException(commitsItem) },
      commits: [...good, { message: "feat(team-2): add logout (Refs #12)" }],
    });
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.accepted.map((p) => p.rule)).toEqual(["commit-refs"]);
    expect(r.warnings.join(" ")).toContain("Exception");
  });

  it("still fails an unticked item without a note", () => {
    const r = audit({ pr: { ...pr, body: body().replace("- [x] I tested", "- [ ] I tested") } });
    expect(r.problems.map((p) => p.rule)).toEqual(["checklist"]);
    expect(r.problems[0]?.message).toMatch(/^1 checklist item/);
  });

  it("does not excuse a wrong base branch with an Exception on the up-to-date item", () => {
    const upToDate = "The branch is up to date with its base branch";
    const u = uncheckedItems(withException(upToDate, "  Exception: couldn't merge main in yet."));
    expect(u.excepted).toEqual([upToDate]);
    expect([...u.exceptedRules]).toEqual([]);
    const r = audit({ pr: { ...pr, base: "main", body: withException(upToDate) } });
    expect(r.problems.map((p) => p.rule)).toContain("base");
    expect(r.accepted).toEqual([]);
  });

  it("accepts the base rule with an Exception on the base-branch item", () => {
    const item = body().match(/- \[x\] (The base branch is correct[^\n]*)/)?.[1] ?? "";
    expect(item).not.toBe("");
    expect([...uncheckedItems(withException(item)).exceptedRules]).toEqual(["base"]);
  });

  it("lists passing PRs with an Exception in the Markdown report", () => {
    const r = audit({
      pr: { ...pr, number: 91, body: withException(commitsItem) },
      commits: [...good, { message: "feat(team-2): add logout (Refs #12)" }],
    });
    const md = formatReport(groupByTeam([r], config.teamLabels), {
      repo: "o/r",
      state: "all",
      generatedAt: "now",
    });
    expect(md).toContain("Passing: #91");
    expect(md).toMatch(
      /Passing with an "Exception:" note[^\n]*\n- #91: "Commits follow .*\(accepts commit-refs\)/,
    );
    const failingOnly = formatReport(groupByTeam([r], config.teamLabels), {
      repo: "o/r",
      state: "all",
      generatedAt: "now",
      failingOnly: true,
    });
    expect(failingOnly).not.toContain("Exception");
  });

  it("does not take an empty Exception or a ticked item as a note", () => {
    expect(uncheckedItems(withException(commitsItem, "  Exception:")).open).toBe(1);
    expect(uncheckedItems(withException(commitsItem, "- [x] Exception: x")).open).toBe(1);
  });
});

describe("commits from an earlier merged PR", () => {
  const missingRefs = [
    ...good,
    { oid: "a1", message: "Add the lobby" },
    { oid: "b2", message: "Fix the timer" },
  ];

  it("does not check commits that an earlier merged PR already has", () => {
    const r = audit({ commits: missingRefs, judgedElsewhere: new Set(["a1", "b2"]) });
    expect(rules(r)).not.toContain("commit-refs");
    expect(r.warnings.join(" ")).toMatch(/2 commit\(s\) already belong to an earlier merged PR/);
  });

  it("still fails the PR's own commits without a reference", () => {
    const r = audit({ commits: missingRefs, judgedElsewhere: new Set(["a1"]) });
    expect(rules(r)).toEqual(["commit-refs"]);
    expect(r.problems[0]?.message).toMatch(/^1 of 2 commit/);
  });
});
