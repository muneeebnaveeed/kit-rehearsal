// Tests for `pnpm pr:rubric` (lib/rubric.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  codeNamesIn,
  MARKER,
  type PrFile,
  type RubricInput,
  rubricMarkdown,
  scoreRubric,
  sentencesOf,
} from "./lib/rubric.ts";

const config = JSON.parse(readFileSync(new URL("./types.json", import.meta.url), "utf8"));
const file = (path: string, additions = 10, deletions = 0): PrFile => ({ path, additions, deletions });
const body = (fields: Record<string, string>) =>
  Object.entries(fields)
    .map(([k, v]) => `**${k}**: ${v}`)
    .join("\n");
const good = {
  "Linked issue": "Closes #14",
  Team: "team-2",
  Summary: "Players lost their score when the connection dropped. Now the score survives a reconnect.",
  "How to test": "1. Run `pnpm dev`\n2. Join a room, kill the network, rejoin\n3. The score is still there",
  Screenshots: "None, only the room logic changed",
};
const input = (over: Partial<RubricInput> = {}): RubricInput => ({
  title: "feat(team-2): keep score",
  body: body(good),
  head: "team-2/14-keep-score",
  base: "feature/team-2",
  files: [file("games/team-2/room/score.ts"), file("games/team-2/room/score.test.ts")],
  config,
  ...over,
});
const byId = (r: ReturnType<typeof scoreRubric>, id: string) => r.criteria.find((c) => c.id === id);

describe("scoreRubric", () => {
  it("passes a well-documented, tested, small PR", () => {
    const r = scoreRubric(input());
    expect(r.skipped).toBeNull();
    expect(r).toMatchObject({ score: 4, total: 4, changedLines: 10 });
  });

  it("skips sync PRs and promotions", () => {
    expect(scoreRubric(input({ head: "main", base: "feature/team-2" })).skipped).toMatch(/sync/);
    expect(scoreRubric(input({ head: "feature/team-2", base: "main" })).skipped).toMatch(/promotion/);
  });

  it("wants a test file when game or platform code changes, and not otherwise", () => {
    expect(byId(scoreRubric(input({ files: [file("server/host/src/room.ts")] })), "tests")).toMatchObject({
      applies: true,
      pass: false,
    });
    expect(byId(scoreRubric(input({ files: [file("course/README.md")] })), "tests")?.applies).toBe(false);
  });

  it("rejects an empty or placeholder How to test", () => {
    for (const value of ["", "None", "tested", "Works"]) {
      expect(
        byId(scoreRubric(input({ body: body({ ...good, "How to test": value }) })), "how-to-test")?.pass,
      ).toBe(false);
    }
    expect(
      byId(
        scoreRubric(
          input({ body: body({ ...good, "How to test": "<!-- steps a reviewer can follow -->" }) }),
        ),
        "how-to-test",
      )?.pass,
    ).toBe(false);
  });

  it("wants an image, or None with a reason, when client files change", () => {
    const files = [file("games/team-2/client/Hud.tsx"), file("games/team-2/client/Hud.test.ts")];
    const shots = (Screenshots: string) =>
      byId(scoreRubric(input({ files, body: body({ ...good, Screenshots }) })), "screenshots");
    expect(shots("None")).toMatchObject({
      applies: true,
      pass: false,
      detail: "2 client file(s) changed, no image and no reason.",
    });
    expect(shots("Looks the same")).toMatchObject({ pass: false });
    expect(shots("![hud](https://github.com/user-attachments/assets/1)")).toMatchObject({
      pass: true,
      detail: "Has an image or link.",
    });
    expect(shots("None, only a test helper moved")).toMatchObject({
      pass: true,
      detail: "No image, with a reason: only a test helper moved",
    });
    expect(shots("n/a: the HUD reads the same")?.pass).toBe(true);
  });

  it("misses a summary that names code or runs long", () => {
    const named = body({ ...good, Summary: "Changed `scoreStore` in games/team-2/room/score.ts." });
    expect(byId(scoreRubric(input({ body: named })), "summary")?.pass).toBe(false);
    const long = body({ ...good, Summary: "One. Two. Three. Four. Five." });
    expect(byId(scoreRubric(input({ body: long })), "summary")?.pass).toBe(false);
  });

  it("counts changed lines of code, without tests, docs, lockfiles and generated files", () => {
    const files = [
      file("games/team-2/room/a.ts", 900, 150),
      file("games/team-2/room/a.test.ts", 700, 0),
      file("games/team-2/README.md", 300, 0),
      file("pnpm-lock.yaml", 5000, 0),
      file("server/docs/generated/api.schema.json", 900, 0),
    ];
    const r = scoreRubric(input({ files }));
    expect(r.changedLines).toBe(1050);
    expect(byId(r, "size")).toMatchObject({ pass: false });
    expect(byId(r, "size")?.tip).toMatch(/splitting/);
  });

  it("wants a root cause on bug PRs only", () => {
    expect(byId(scoreRubric(input()), "root-cause")?.applies).toBe(false);
    const bug = input({ title: "fix(team-2): keep score", body: body({ ...good, "Root cause": "None" }) });
    expect(byId(scoreRubric(bug), "root-cause")).toMatchObject({ applies: true, pass: false });
    const explained = body({
      ...good,
      "Root cause": "The room assumed a client never rejoins with the same id.",
    });
    expect(byId(scoreRubric({ ...bug, body: explained }), "root-cause")?.pass).toBe(true);
  });
});

describe("codeNamesIn", () => {
  it("finds backticks, paths, files and identifiers but not prose slashes", () => {
    expect(codeNamesIn("See `x`, games/team-2/room, score.ts, scoreStore, max_hp and reset().")).toEqual([
      "`x`",
      "games/team-2/room",
      "score.ts",
      "scoreStore",
      "max_hp",
      "reset()",
    ]);
    expect(codeNamesIn("Players and/or teams, client/server, players/teams.")).toEqual([]);
  });
});

describe("sentencesOf", () => {
  it("splits on sentence ends", () => {
    expect(sentencesOf("It broke. Now it works! Why? Because.")).toHaveLength(4);
  });
});

describe("rubricMarkdown", () => {
  it("starts with the marker and lists only counted criteria in the table", () => {
    const md = rubricMarkdown(scoreRubric(input({ files: [file("games/team-2/room/a.ts", 1000, 0)] })));
    expect(md.startsWith(MARKER)).toBe(true);
    expect(md).toMatch(/PR rubric: 2 of 4/);
    expect(md).toMatch(/\| Passed \| Criterion \| Details \|/);
    expect(md).toMatch(/\| ❌ \| Tests changed with the code \|/);
    expect(md).toMatch(/\| ✅ \| How to test has concrete steps \|/);
    expect(md).not.toMatch(/\| (?:pass|miss) \|/);
    expect(md).toMatch(/Not counted: screenshots of client changes/);
  });

  it("says why it was skipped", () => {
    expect(rubricMarkdown(scoreRubric(input({ head: "main" })))).toMatch(/skipped[\s\S]*sync PR/);
  });
});
