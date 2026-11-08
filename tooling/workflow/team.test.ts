// Tests for the team setting used by issue:start and pr:open (lib/team.mjs).
import { describe, expect, it } from "vitest";
import { parseTeamAnswer, resolveTeam, teamBase, teamMenu } from "./lib/team.mjs";

const teamLabels = ["team-1", "team-2", "team-3", "team-4", "platform", "team-instructor"];

describe("teamBase", () => {
  it("sends game teams to their feature branch and everyone else to main", () => {
    expect(teamBase("team-1")).toBe("feature/team-1");
    expect(teamBase("team-4")).toBe("feature/team-4");
    expect(teamBase("platform")).toBe("main");
    expect(teamBase("team-instructor")).toBe("main");
  });
});

describe("parseTeamAnswer", () => {
  it("accepts a label or its number in the menu", () => {
    expect(parseTeamAnswer("team-3", teamLabels)).toBe("team-3");
    expect(parseTeamAnswer("  platform \n", teamLabels)).toBe("platform");
    expect(parseTeamAnswer("2", teamLabels)).toBe("team-2");
    expect(parseTeamAnswer("6", teamLabels)).toBe("team-instructor");
  });

  it("rejects anything else", () => {
    expect(parseTeamAnswer("", teamLabels)).toBeNull();
    expect(parseTeamAnswer("7", teamLabels)).toBeNull();
    expect(parseTeamAnswer("0", teamLabels)).toBeNull();
    expect(parseTeamAnswer("team-5", teamLabels)).toBeNull();
    expect(parseTeamAnswer("Team-1", teamLabels)).toBeNull();
  });

  it("numbers the menu so the game teams keep their own number", () => {
    expect(teamMenu(teamLabels)).toEqual([
      "  1) team-1",
      "  2) team-2",
      "  3) team-3",
      "  4) team-4",
      "  5) platform",
      "  6) team-instructor",
    ]);
  });
});

describe("resolveTeam", () => {
  const base = { flag: null, saved: null, interactive: false, teamLabels };

  it("uses --team for this run, before the saved team", () => {
    expect(resolveTeam({ ...base, flag: "team-2", saved: "platform" })).toEqual({
      ok: true,
      team: "team-2",
      source: "flag",
    });
  });

  it("uses the saved team", () => {
    expect(resolveTeam({ ...base, saved: "team-4" })).toEqual({ ok: true, team: "team-4", source: "saved" });
  });

  it("asks in a terminal when nothing is saved", () => {
    expect(resolveTeam({ ...base, interactive: true })).toEqual({ ok: false, prompt: true });
  });

  it("stops with a usage error without a terminal, and never guesses", () => {
    const r = resolveTeam(base);
    expect(r).toMatchObject({ ok: false, prompt: false, exitCode: 2 });
    expect("message" in r && r.message).toMatch(/--team/);
  });

  it("rejects an unknown --team", () => {
    const r = resolveTeam({ ...base, flag: "team-9", saved: "team-1", interactive: true });
    expect(r).toMatchObject({ ok: false, prompt: false, exitCode: 2 });
  });

  it("treats an invalid saved value as unset", () => {
    expect(resolveTeam({ ...base, saved: "nonsense", interactive: true })).toEqual({
      ok: false,
      prompt: true,
    });
    const r = resolveTeam({ ...base, saved: "nonsense" });
    expect(r).toMatchObject({ ok: false, exitCode: 2 });
    expect("message" in r && r.message).toMatch(/nonsense/);
  });
});
