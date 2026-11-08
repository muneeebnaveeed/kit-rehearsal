import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { auditIssue, formatReport, groupByTeam, teamOf } from "./lib/issue-report.mjs";

const config = JSON.parse(
  readFileSync(new URL("../../tooling/workflow/types.json", import.meta.url), "utf8"),
);
const teamLabels: string[] = config.teamLabels;

const issue = (over: Record<string, unknown> = {}) => ({
  number: 10,
  title: "Add login",
  url: "https://example.test/10",
  state: "OPEN",
  author: "someone",
  labels: ["team-2"],
  ...over,
});
const audit = (over: Record<string, unknown> = {}) => auditIssue({ issue: issue(over), config });
const rules = (r: { problems: { rule: string }[] }) => r.problems.map((p) => p.rule);

describe("auditIssue", () => {
  it("passes an issue with one team label and no prefix", () => {
    expect(audit()).toMatchObject({ ok: true, team: "team-2", problems: [] });
  });

  it("ignores extra non-team labels", () => {
    expect(audit({ labels: ["team-2", "bug", "help wanted"] }).ok).toBe(true);
  });

  it("flags an issue with no team label", () => {
    const r = audit({ title: "Scaffold the game", labels: [] });
    expect(rules(r)).toEqual(["labels"]);
    expect(r.problems[0]?.message).toContain("has 0");
    expect(r.team).toBeNull();
  });

  it("flags a malformed prefix such as [team : 4]", () => {
    const r = audit({ title: "[team : 4] Game state", labels: ["team-4"] });
    expect(rules(r)).toEqual(["title"]);
    expect(r.problems[0]?.message).toContain('Drop "[team : 4]"');
    expect(r.team).toBe("team-4");
  });

  it("flags a prefix and a missing team label", () => {
    const r = audit({ title: "[docs] Document the branching workflow", labels: ["documentation"] });
    expect(rules(r)).toEqual(["title", "labels"]);
    expect(r.team).toBeNull();
  });

  it("flags two team labels", () => {
    const r = audit({ labels: ["team-1", "team-2"] });
    expect(r.problems[0]?.message).toContain("has 2");
    expect(r.team).toBeNull(); // two labels name no team, and the title never does
    expect(audit({ title: "[team-2] x", labels: ["team-1", "team-2"] }).team).toBeNull();
  });

  it("flags a prefix that disagrees with the label as a prefix only", () => {
    const r = audit({ title: "[team-1] Add login", labels: ["team-2"] });
    expect(rules(r)).toEqual(["title"]);
    expect(r.team).toBe("team-2");
  });

  it("does not check the body, because old issues predate the templates", () => {
    expect(rules(audit())).not.toContain("heading");
    expect(rules(audit())).not.toContain("template");
  });

  it.each(teamLabels)("accepts the %s label", (label) => {
    expect(audit({ title: "Something", labels: [label] }).ok).toBe(true);
  });
});

describe("teamOf", () => {
  it("is the single team label", () => {
    expect(teamOf({ labels: ["team-2", "bug"] }, teamLabels)).toBe("team-2");
  });

  it("ignores a title prefix", () => {
    const prefixed = { title: "[platform] x", labels: [] };
    expect(teamOf(prefixed, teamLabels)).toBeNull();
  });

  it("is null without exactly one team label", () => {
    expect(teamOf({ labels: ["bug"] }, teamLabels)).toBeNull();
    expect(teamOf({ labels: ["team-1", "team-2"] }, teamLabels)).toBeNull();
  });
});

describe("groupByTeam and formatReport", () => {
  const results = [
    audit({ number: 3 }),
    audit({ number: 7, title: "[team-2] Bad" }),
    audit({ number: 5, title: "No team", labels: [] }),
    audit({ number: 9, title: "Fine", labels: ["platform"] }),
  ];
  const groups = groupByTeam(results, teamLabels);

  it("orders teams as configured, with issues that have no team last", () => {
    expect(groups.map((g) => g.team)).toEqual(["team-2", "platform", null]);
  });

  it("counts passes and failures and sorts newest first", () => {
    const team2 = groups[0];
    expect(team2).toMatchObject({ total: 2, passCount: 1, failCount: 1 });
    expect(team2?.failing.map((r) => r.number)).toEqual([7]);
  });

  it("renders a Markdown report with the reasons", () => {
    const md = formatReport(groups, { repo: "o/r", state: "all", generatedAt: "2026-01-01 00:00 UTC" });
    expect(md).toContain("2 of 4 issues pass");
    expect(md).toContain("| (no team) | 1 | 0 | 1 |");
    expect(md).toContain("- [#7](https://example.test/10) [team-2] Bad (open, someone, labels: team-2)");
    expect(md).toContain('  - **title:** Drop "[team-2]" from the title');
    expect(md).toContain("  - **labels:** Needs exactly one team label");
    expect(md).toContain("Passing: #3");
  });

  it("leaves out the passing list in failing-only mode", () => {
    const only = groups.map((g) => ({ ...g, passing: [] }));
    const md = formatReport(only, { repo: "o/r", state: "all", generatedAt: "x", failingOnly: true });
    expect(md).not.toContain("Passing:");
  });
});
