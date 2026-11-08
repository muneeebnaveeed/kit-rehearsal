import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectEvidence, formatEvidence } from "./evidence.mjs";

function runTempGit(args: string[], cwd: string) {
  const command = args[0] === "commit" ? ["-c", "commit.gpgsign=false", ...args] : args;
  return execFileSync("git", command, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "qa-test",
      GIT_AUTHOR_EMAIL: "qa-test@example.com",
      GIT_COMMITTER_NAME: "qa-test",
      GIT_COMMITTER_EMAIL: "qa-test@example.com",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
  }).trim();
}

describe("qa:evidence", () => {
  it("reports changed tests, results, scenarios, and replay ids", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "qa-evidence-"));
    await mkdir(join(cwd, ".qa"), { recursive: true });
    await mkdir(join(cwd, "replays"), { recursive: true });
    await writeFile(
      join(cwd, ".qa", "last-test.json"),
      JSON.stringify({ numPassedTests: 3, numFailedTests: 1 }),
    );
    await writeFile(
      join(cwd, "replays", "room.json"),
      JSON.stringify({ roomId: "room-1", scenario: "sample" }),
    );
    const git = (args: string[]) => {
      if (args[0] === "merge-base") return "base";
      if (args[0] === "ls-files") return "server/tests/qa/untracked.test.ts";
      if (args.includes("--cached")) return "server/tests/qa/staged.spec.ts";
      if (args.includes("base")) return "server/tests/qa/committed.test.ts\nREADME.md";
      return "server/tests/qa/unstaged.test.ts";
    };
    const evidence = await collectEvidence({ cwd, git });
    expect(evidence).toEqual({
      base: "upstream/main",
      assertedBy: [
        "server/tests/qa/committed.test.ts",
        "server/tests/qa/staged.spec.ts",
        "server/tests/qa/unstaged.test.ts",
        "server/tests/qa/untracked.test.ts",
      ],
      lastTestResults: { passed: 3, failed: 1 },
      scenarios: ["sample"],
      replayIds: ["room-1"],
    });
    expect(formatEvidence(evidence)).toContain("Asserted by:\n- server/tests/qa/committed.test.ts");
    expect(formatEvidence(evidence)).toContain("3 passed, 1 failed");
  });

  it("uses origin/main in a real repository when upstream is unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "qa-evidence-real-"));
    const seed = join(root, "seed");
    const origin = join(root, "origin.git");
    const cwd = join(root, "work");
    try {
      await mkdir(seed, { recursive: true });
      runTempGit(["init", "-b", "main"], seed);
      await writeFile(join(seed, "README.md"), "base\n");
      runTempGit(["add", "."], seed);
      runTempGit(["commit", "-m", "base"], seed);
      runTempGit(["init", "--bare", origin], root);
      runTempGit(["remote", "add", "origin", origin], seed);
      runTempGit(["push", "origin", "main"], seed);
      runTempGit(["clone", origin, cwd], root);
      runTempGit(["fetch", "origin", "main"], cwd);
      runTempGit(["checkout", "main"], cwd);
      runTempGit(["checkout", "-b", "feature"], cwd);
      await writeFile(join(cwd, "changed.test.ts"), "test\n");
      runTempGit(["add", "."], cwd);
      runTempGit(["commit", "-m", "test"], cwd);

      const evidence = await collectEvidence({ cwd });
      expect(evidence.base).toBe("origin/main");
      expect(evidence.assertedBy).toEqual(["changed.test.ts"]);
      expect(formatEvidence(evidence)).toContain("Compared against origin/main");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("reports a clear error when no comparison base exists", async () => {
    const git = (args: string[]) => {
      if (args[0] === "rev-parse") throw new Error("raw git error");
      throw new Error(`unexpected git call: ${args.join(" ")}`);
    };
    await expect(collectEvidence({ cwd: "/tmp", git })).rejects.toThrow(
      "Could not find a comparison base (upstream/main, origin/main, or main). Run git fetch or add an upstream remote",
    );
  });
});
