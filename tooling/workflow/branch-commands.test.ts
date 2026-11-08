// End-to-end tests for the commands' input handling and exit codes (0 ok, 1 problems, 2 usage,
// 3 environment). Nothing here talks to GitHub: every case stops before gh, or talks to a local
// /health server.
import { execFileSync, spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = fileURLToPath(new URL("./", import.meta.url));
const root = fileURLToPath(new URL("../../", import.meta.url));

/** Runs a command asynchronously, so the test's /health server can answer it. */
function run(script: string, args: string[], env: Record<string, string> = {}) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("KIT_")));
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [`${dir}${script}`, ...args], {
      cwd: root,
      env: { ...clean, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

const SHA = "c9bc1c1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
let health: Record<string, unknown> = {};
let server: Server;
let url = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url !== "/health") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(health));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const healthy = (over: Record<string, unknown> = {}) => ({
  ok: true,
  env: "production",
  sha: SHA,
  startedAt: "2026-11-07T10:00:00.000Z",
  games: ["template"],
  ...over,
});

describe("usage errors exit with 2, before touching git or GitHub", () => {
  it.each([
    ["sync.mjs", ["extra"]],
    ["team-promote.mjs", ["9", "--issue", "1"]],
    ["team-promote.mjs", ["--team", "platform", "--issue", "1"]],
    ["team-promote.mjs", ["2"]],
    ["team-promote.mjs", ["2", "--issue", "abc"]],
    ["branches-sync.mjs", ["7", "--issue", "1"]],
    ["branches-sync.mjs", []],
    ["env-status.mjs", ["extra"]],
    ["env-wait.mjs", []],
    ["env-wait.mjs", ["prod", "c9bc1c1"]],
    ["env-wait.mjs", ["not-a-sha"]],
    ["env-wait.mjs", ["c9bc1c1", "--timeout", "soon"]],
  ])("%s %j", async (script, args) => {
    const r = await run(script, args);
    expect(r.stderr).toContain("usage: pnpm");
    expect(r.code).toBe(2);
  });
});

describe("a missing environment URL exits with 3 and says what to set", () => {
  it("env:status", async () => {
    const r = await run("env-status.mjs", []);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain("KIT_GATEWAY");
  });

  it("env:wait", async () => {
    const r = await run("env-wait.mjs", ["c9bc1c1"]);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain("--url");
  });
});

describe("env:wait", () => {
  it("exits 0 once the environment reports the commit, with --json", async () => {
    health = healthy();
    const r = await run("env-wait.mjs", ["c9bc1c1", "--json"], { KIT_GATEWAY: url });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({
      check: "env-wait",
      ok: true,
      environment: "production",
      reported: SHA,
    });
  });

  it("exits 1 when the commit doesn't arrive before the timeout", async () => {
    health = healthy({ sha: "1234567bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" });
    const r = await run("env-wait.mjs", ["c9bc1c1", "--timeout", "0.5", "--interval", "0.1", "--json"], {
      KIT_GATEWAY: url,
    });
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).problems[0]).toMatchObject({ rule: "timeout" });
  });

  it("stops at once when the URL is not production", async () => {
    health = healthy({ env: "local" });
    const r = await run("env-wait.mjs", ["c9bc1c1", "--timeout", "30", "--url", url, "--json"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ attempts: 1, problems: [{ rule: "app-env" }] });
  });
});

// Needs origin/main locally; a shallow CI checkout may not have it.
const originMain = (() => {
  try {
    return execFileSync("git", ["rev-parse", "--verify", "--quiet", "origin/main"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
})();

describe.skipIf(!originMain)("env:status", () => {
  it("exits 0 when production runs main's head", async () => {
    health = healthy({ sha: originMain });
    const r = await run("env-status.mjs", ["--offline", "--json"], { KIT_GATEWAY: url });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).environments[0]).toMatchObject({
      name: "production",
      branch: "main",
      ok: true,
    });
  });

  it("exits 1 when production is on another commit or unreachable", async () => {
    health = healthy({ sha: "0000000000000000000000000000000000000000" });
    const behind = await run("env-status.mjs", ["--offline", "--json"], { KIT_GATEWAY: url });
    expect(behind.code).toBe(1);
    expect(JSON.parse(behind.stdout).problems.map((p: { rule: string }) => p.rule)).toEqual(["sha"]);

    const down = await run("env-status.mjs", ["--offline", "--url", "http://127.0.0.1:9"]);
    expect(down.code).toBe(1);
    expect(down.stderr).toContain("[unreachable]");
  });
});
