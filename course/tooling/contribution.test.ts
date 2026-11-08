import { describe, expect, it } from "vitest";
import {
  areaOf,
  cleanTitle,
  collectContributions,
  contributionCells,
  contributionOf,
  isRepeat,
  withContributions,
  workType,
} from "./lib/contribution.mjs";

const pr = (over: Record<string, unknown> = {}) => ({
  number: 30,
  title: "feat(team-2): add login",
  head: "team-2/12-add-login",
  state: "MERGED",
  author: "alice",
  files: [
    { path: "games/team-2/client/login.ts", additions: 80 },
    { path: "games/team-2/room/auth.ts", additions: 20 },
  ],
  ...over,
});
const cell = (t: string) => t.replace(/\|/g, "\\|");

describe("areaOf", () => {
  it("names the parts of a game and of the platform", () => {
    expect(areaOf("games/team-2/client/ui/hud.ts")).toBe("team-2: game client (UI, rendering, input)");
    expect(areaOf("games/team-4/room/index.ts")).toBe("team-4: game server room (rules, state)");
    expect(areaOf("games/team-4/multiplayer/lobby.ts")).toBe("team-4: multiplayer/");
    expect(areaOf("games/team-1/package.json")).toBe("team-1: game app setup");
    expect(areaOf("games/team-1/README.md")).toBe("team-1: game docs");
    expect(areaOf("server/core/src/client/netSim.ts")).toBe("platform: client/server core");
    expect(areaOf("tooling/qa/bots.mjs")).toBe("QA: bots, load, tests");
    expect(areaOf("server/tests/qa/room.test.ts")).toBe("QA: bots, load, tests");
    expect(areaOf("tooling/workflow/pr-open.mjs")).toBe("platform: workflow tooling and checks");
    expect(areaOf("course/tooling/pr-report.mjs")).toBe("instructor tooling");
  });
});

describe("workType and cleanTitle", () => {
  it("reads the Conventional Commits type", () => {
    expect(workType("feat(team-2): add login")).toBe("feature");
    expect(workType("fix(team-2): stop the timer")).toBe("fix");
    expect(workType("chore(team-2): bump deps")).toBe("chore");
  });

  it("counts a title without a Conventional type as a chore", () => {
    expect(workType("Add login")).toBe("chore");
  });

  it("strips the prefix from a title", () => {
    expect(cleanTitle("feat(team-2): add login")).toBe("add login");
    expect(cleanTitle("fix(team-2)!: drop x")).toBe("drop x");
  });
});

describe("isRepeat", () => {
  it("finds syncs and integration PRs, and only those", () => {
    expect(
      isRepeat({ title: "chore(platform): bring feature/team-1 up to date with main", head: "main" }),
    ).toBe(true);
    expect(isRepeat({ title: "chore(team-1): merge feature/team-1 into main", head: "feature/team-1" })).toBe(
      true,
    );
    expect(
      isRepeat({ title: "chore(team-3): bring main into feature/team-3", head: "team-3/312-bring-main" }),
    ).toBe(true);
    expect(
      isRepeat({
        title: "feat(platform): open sync prs from main automatically",
        head: "platform/222-sync-prs",
      }),
    ).toBe(false);
  });
});

describe("collectContributions", () => {
  it("adds up merged work PRs and leaves out repeats, generated files and unmerged PRs", () => {
    const { people, repeats } = collectContributions([
      pr({ files: [...pr().files, { path: "pnpm-lock.yaml", additions: 5000 }] }),
      pr({
        number: 31,
        title: "fix(team-2): keep the session",
        files: [{ path: "games/team-2/room/a.ts", additions: 50 }],
      }),
      pr({ number: 32, state: "OPEN" }),
      pr({ number: 33, head: "main", title: "chore(platform): bring feature/team-2 up to date with main" }),
    ]);
    const c = contributionOf(people.get("alice"), 150);
    expect(c.lines).toBe(150);
    expect(c.featureShare).toBeCloseTo(100 / 150);
    expect(c.areas[0]).toEqual({ area: "team-2: game client (UI, rendering, input)", share: 80 / 150 });
    expect(c.items.map((i) => i.number)).toEqual([30, 31]);
    expect(repeats).toEqual([33]);
  });
});

describe("withContributions and contributionCells", () => {
  it("counts the share within each team and renders the cells", () => {
    const { people } = collectContributions([
      pr(),
      pr({ number: 31, author: "bob", files: [{ path: "games/team-2/client/b.ts", additions: 300 }] }),
    ]);
    const rows = withContributions(
      [
        { login: "alice", team: "team-2" },
        { login: "bob", team: "team-2" },
        { login: "erin", team: "team-1" },
      ],
      people,
    );
    const [alice, bob, erin] = rows;
    if (!alice || !bob || !erin) throw new Error("expected a row per student");
    expect(alice.contribution.teamShare).toBeCloseTo(0.25);
    expect(bob.contribution.teamShare).toBeCloseTo(0.75);
    const [lines, share, feature, areas, work] = contributionCells(alice.contribution, cell);
    expect([lines, share, feature]).toEqual(["100", "25%", "100%"]);
    expect(areas).toBe(
      "team-2: game client (UI, rendering, input) (80%)<br>team-2: game server room (rules, state) (20%)",
    );
    expect(work).toBe("#30 add login (feature, +100)");
    expect(contributionCells(erin.contribution, cell)).toEqual(["0", "–", "–", "–", "no merged work PRs"]);
  });
});
