// Tests for the branch-level checks run by `pnpm preflight` (check:branch, check:ownership,
// check:files, check:secrets, check:docs, check:config, check:determinism, check:contract).
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { checkBranch } from "./lib/check-branch.mjs";
import { checkGameConfig } from "./lib/check-config.mjs";
import { contractWarnings } from "./lib/check-contract.mjs";
import { isSimulationFile, scanSource } from "./lib/check-determinism.mjs";
import { checkDocs, extractLinks, slugify } from "./lib/check-docs.mjs";
import { addedLines, checkFiles, findSecrets } from "./lib/check-files.mjs";
import { checkOwnership, explainsCrossTeam } from "./lib/check-ownership.mjs";

const teamLabels = ["team-1", "team-2", "team-3", "team-4", "platform", "team-instructor"];
const rules = (problems: { rule: string }[]) => problems.map((p) => p.rule);

describe("check:branch", () => {
  const issue = { number: 14, state: "OPEN", labels: ["team-2"] };

  it("passes a work branch with the right base and a matching open issue", () => {
    expect(checkBranch({ branch: "team-2/14-add-login", base: "feature/team-2", teamLabels, issue })).toEqual(
      [],
    );
    expect(
      checkBranch({
        branch: "platform/10-checks",
        base: "main",
        teamLabels,
        issue: { ...issue, labels: ["platform"] },
      }),
    ).toEqual([]);
  });

  it("accepts the long-lived flows: feature to main, main to a feature branch", () => {
    expect(checkBranch({ branch: "feature/team-1", base: "main", teamLabels })).toEqual([]);
    expect(checkBranch({ branch: "main", base: "feature/team-3", teamLabels })).toEqual([]);
  });

  it("rejects a bad name, a wrong base, and a missing, closed or differently labelled issue", () => {
    expect(rules(checkBranch({ branch: "fix-stuff", base: "main", teamLabels }))).toEqual(["branch"]);
    expect(rules(checkBranch({ branch: "team-2/14-add-login", base: "main", teamLabels, issue }))).toEqual([
      "base",
    ]);
    expect(rules(checkBranch({ branch: "feature/team-1", base: "prod", teamLabels }))).toEqual(["base"]);
    expect(rules(checkBranch({ branch: "main", base: "feature/team-9", teamLabels }))).toEqual(["base"]);
    expect(rules(checkBranch({ branch: "main", base: "prod", teamLabels }))).toEqual(["base"]);
    expect(
      rules(checkBranch({ branch: "team-2/14-add-login", base: "feature/team-2", teamLabels, issue: null })),
    ).toEqual(["issue"]);
    expect(
      rules(
        checkBranch({
          branch: "team-2/14-add-login",
          base: "feature/team-2",
          teamLabels,
          issue: { ...issue, state: "CLOSED" },
        }),
      ),
    ).toEqual(["issue"]);
    expect(
      rules(
        checkBranch({
          branch: "team-2/14-add-login",
          base: "feature/team-2",
          teamLabels,
          issue: { ...issue, labels: ["team-3"] },
        }),
      ),
    ).toEqual(["label"]);
  });
});

describe("check:ownership", () => {
  const ownership = [
    { path: "games/team-1/**", owner: "team-1" },
    { path: "games/team-2/**", owner: "team-2" },
    { path: "server/**", owner: "platform" },
    { path: "**", owner: "shared" },
  ];

  it("allows the label's own files and shared files", () => {
    const res = checkOwnership({
      label: "team-1",
      files: ["games/team-1/a.ts", "pnpm-lock.yaml"],
      ownership,
      crossTeam: false,
    });
    expect(res).toEqual({ problems: [], warnings: [] });
  });

  it("fails on other owners' files, and only warns when the issue is cross-team", () => {
    const files = ["games/team-1/a.ts", "games/team-2/b.ts", "server/core/x.ts"];
    expect(
      checkOwnership({ label: "team-1", files, ownership, crossTeam: false }).problems.map((p) => p.file),
    ).toEqual(["games/team-2/b.ts", "server/core/x.ts"]);
    const allowed = checkOwnership({ label: "team-1", files, ownership, crossTeam: true });
    expect(allowed.problems).toEqual([]);
    expect(allowed.warnings).toHaveLength(2);
  });
});

describe("explainsCrossTeam", () => {
  it('finds a "Cross-team: <why>" line, in any case and as a list item or bold', () => {
    expect(explainsCrossTeam("## What changes\n\nCross-team: the fix needs the report's tests\n")).toBe(true);
    expect(explainsCrossTeam("- cross-team: shared fixture")).toBe(true);
    expect(explainsCrossTeam("**Cross-team:** shared fixture")).toBe(true);
  });

  it("needs a reason, on its own line", () => {
    expect(explainsCrossTeam("Cross-team:")).toBe(false);
    expect(explainsCrossTeam("This is not cross-team: work")).toBe(false);
    expect(explainsCrossTeam(null)).toBe(false);
  });
});

describe("check:files", () => {
  it("rejects dependencies, build output, env files and files over 1 MB", () => {
    const problems = checkFiles([
      { path: "games/team-1/node_modules/x/index.js", bytes: 10 },
      { path: "games/team-1/dist/index.js", bytes: 10 },
      { path: ".env", bytes: 10 },
      { path: "games/team-1/.env.local", bytes: 10 },
      { path: ".env.example", bytes: 10 },
      { path: "games/team-1/assets/music.wav", bytes: 5_000_000 },
      { path: "games/team-1/client/main.ts", bytes: 2_000 },
    ]);
    expect(problems.map((p) => [p.rule, p.file])).toEqual([
      ["forbidden", "games/team-1/node_modules/x/index.js"],
      ["forbidden", "games/team-1/dist/index.js"],
      ["forbidden", ".env"],
      ["forbidden", "games/team-1/.env.local"],
      ["size", "games/team-1/assets/music.wav"],
    ]);
  });
});

describe("check:secrets", () => {
  // Built from pieces so this file doesn't trip the check itself.
  const fakes = [
    `gh${"p"}_${"a".repeat(36)}`,
    `AK${"IA"}${"B".repeat(16)}`,
    `-----BEGIN ${"PRIVATE"} KEY-----`,
    `const api${"Key"} = "${"q".repeat(20)}";`,
  ];

  it("finds common token formats and hard-coded credentials", () => {
    expect(findSecrets(fakes.map((line) => ({ file: "x.ts", line })))).toHaveLength(4);
  });

  it("ignores ordinary code and placeholders", () => {
    const lines = [
      "const token = process.env.RAILWAY_TOKEN;",
      `const api${"Key"} = "your-api-key-here-please";`,
      "password: z.string().min(8),",
    ];
    expect(findSecrets(lines.map((line) => ({ file: "x.ts", line })))).toEqual([]);
  });

  it("reads added lines and their file from a unified diff", () => {
    const diff = [
      "diff --git a/x.ts b/x.ts",
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -1 +1,2 @@",
      "-old",
      "+new line",
      "+another",
    ].join("\n");
    expect(addedLines(diff)).toEqual([
      { file: "x.ts", line: "new line" },
      { file: "x.ts", line: "another" },
    ]);
  });
});

describe("check:docs", () => {
  const files: Record<string, string> = {
    "README.md":
      "# Readme\n\n[ok](docs/guide.md#set-up) [web](https://x.test) [self](#readme) [up](../outside.md) [bad](docs/nope.md) [bad anchor](docs/guide.md#missing) `[code](no.md)`\n",
    "docs/guide.md": "# Guide\n\n## Set up\n\n[back](../README.md)\n",
  };
  const fs = {
    read: (rel: string) => files[rel] ?? "",
    exists: (rel: string) => rel in files || rel === "docs",
    isFile: (rel: string) => rel in files,
  };

  it("builds GitHub-style anchors", () => {
    expect(slugify("4. Start your team's game")).toBe("4-start-your-teams-game");
    expect(slugify("`pnpm dev` and more")).toBe("pnpm-dev-and-more");
  });

  it("ignores links in code", () => {
    expect(extractLinks("[a](a.md) `[b](b.md)`\n```\n[c](c.md)\n```")).toEqual(["a.md"]);
  });

  it("reports broken paths and anchors, and accepts valid ones", () => {
    expect(checkDocs(Object.keys(files), fs).map((p) => p.message)).toEqual([
      "Broken link: ../outside.md",
      "Broken link: docs/nope.md",
      "Broken anchor: docs/guide.md#missing",
    ]);
  });
});

describe("check:config", () => {
  const shared = { GameConfigSchema: z.object({ speed: z.number().positive() }), GAME_ID: "team-1" };
  const base = { configFile: "games/team-1/config/game.json", sharedFile: "games/team-1/shared/index.ts" };

  it("accepts a config that matches the schema", () => {
    expect(checkGameConfig({ ...base, shared, json: '{ "speed": 5 }' })).toEqual([]);
  });

  it("reports schema errors, invalid JSON and a missing or ambiguous schema", () => {
    expect(checkGameConfig({ ...base, shared, json: '{ "speed": -1 }' })[0]?.message).toContain("speed");
    expect(rules(checkGameConfig({ ...base, shared, json: "{ speed: }" }))).toEqual(["json"]);
    expect(rules(checkGameConfig({ ...base, shared: { GAME_ID: "x" }, json: "{}" }))).toEqual(["schema"]);
    expect(
      rules(checkGameConfig({ ...base, shared: { ...shared, OtherConfigSchema: z.object({}) }, json: "{}" })),
    ).toEqual(["schema"]);
  });
});

describe("check:determinism", () => {
  it("only scans simulation code, not tests or clients", () => {
    expect(isSimulationFile("games/team-1/room/GameRoom.ts")).toBe(true);
    expect(isSimulationFile("server/core/src/shared/random.ts")).toBe(true);
    expect(isSimulationFile("server/template/shared/index.ts")).toBe(true);
    expect(isSimulationFile("games/team-1/room/GameRoom.test.ts")).toBe(false);
    expect(isSimulationFile("games/team-1/client/main.ts")).toBe(false);
  });

  it("flags randomness and clock reads, but not comments or opted-out lines", () => {
    const source = [
      "const a = Math.random();",
      "const b = Date.now();",
      "const c = performance.now();",
      "const d = new Date();",
      "// Math.random() is not allowed",
      " * Date.now() in a doc comment",
      "const e = Math.random(); // determinism-ok: seed only",
      "const f = new Date(fixed);",
    ].join("\n");
    expect(scanSource("room/x.ts", source).map((p) => p.file)).toEqual([
      "room/x.ts:1",
      "room/x.ts:2",
      "room/x.ts:3",
      "room/x.ts:4",
    ]);
  });
});

describe("check:contract", () => {
  it("warns about shared contract changes, ignoring tests", () => {
    expect(
      contractWarnings([
        "server/core/src/shared/messages.ts",
        "server/core/src/shared/contract.test.ts",
        "server/core/src/client/index.ts",
      ]),
    ).toHaveLength(1);
  });
});
