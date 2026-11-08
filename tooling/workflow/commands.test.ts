// Runs the workflow commands (team:set, issue:start, pr:open, check:review) as processes, for the
// paths that stop before touching GitHub: usage errors and the "no team, no terminal" rule. The rules
// behind them are unit-tested in team.test.ts, issue-start.test.ts, pr-open.test.ts and
// check-review.test.ts.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = fileURLToPath(new URL(".", import.meta.url));
// A saved team that isn't a label, set for this process only (git's GIT_CONFIG_* variables win over
// .git/config), so the result doesn't depend on the team saved in this clone.
const invalidSavedTeam = {
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "kit.team",
  GIT_CONFIG_VALUE_0: "nonsense",
};

function run(script: string, args: string[], env: Record<string, string> = {}) {
  // stdin is a pipe, not a terminal: this is how an agent or CI runs the commands.
  const r = spawnSync(process.execPath, [`${dir}/${script}`, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe("team:set", () => {
  it("rejects an unknown team", () => {
    const r = run("team-set.mjs", ["team-9"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/Unknown team "team-9"/);
  });

  it("needs a team when there is no terminal to ask in", () => {
    expect(run("team-set.mjs", []).code).toBe(2);
  });

  it("reports usage errors as JSON with --json", () => {
    const r = run("team-set.mjs", ["team-9", "--json"]);
    expect(r.code).toBe(2);
    expect(JSON.parse(r.stdout)).toMatchObject({ command: "team:set", ok: false, exitCode: 2 });
  });
});

describe("issue:start", () => {
  it("needs exactly one issue number", () => {
    expect(run("issue-start.mjs", []).code).toBe(2);
    expect(run("issue-start.mjs", ["abc"]).code).toBe(2);
    expect(run("issue-start.mjs", ["1", "2"]).code).toBe(2);
  });

  it("rejects an unknown --team", () => {
    expect(run("issue-start.mjs", ["14", "--team", "team-9", "--dry-run"]).code).toBe(2);
  });

  it("stops and asks for --team without a terminal, and never guesses", () => {
    const r = run("issue-start.mjs", ["14", "--dry-run", "--json"], invalidSavedTeam);
    expect(r.code).toBe(2);
    expect(JSON.parse(r.stdout).error).toMatch(/--team/);
  });
});

describe("pr:open", () => {
  it("rejects unknown options and types", () => {
    expect(run("pr-open.mjs", ["--bogus", "x"]).code).toBe(2);
    expect(run("pr-open.mjs", ["--type", "release", "--team", "platform"]).code).toBe(2);
    expect(run("pr-open.mjs", ["--team", "team-9"]).code).toBe(2);
    expect(run("pr-open.mjs", ["--body-file", "does-not-exist.md", "--team", "platform"]).code).toBe(2);
  });

  it("stops and asks for --team without a terminal, and never guesses", () => {
    const r = run("pr-open.mjs", ["--dry-run"], invalidSavedTeam);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--team/);
  });
});

describe("check:review", () => {
  it("rejects a bad PR number", () => {
    expect(run("check-review.mjs", ["--number", "abc"]).code).toBe(2);
    expect(run("check-review.mjs", ["--number"]).code).toBe(2);
    expect(run("check-review.mjs", ["45"]).code).toBe(2);
  });
});
