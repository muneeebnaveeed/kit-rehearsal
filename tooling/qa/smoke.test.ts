// Tests for `pnpm qa:smoke` (lib/smoke.ts), with the real watch patterns from .railway/railway.ts.
import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { watchPatterns } from "../../.railway/railway.ts";
import { judge, overall, pagesOk, redeploys, smokeMarkdown, type Target } from "./lib/smoke.ts";

const team2: Target = { service: "team-2", path: "/team-2", watch: watchPatterns("games/team-2") };
const sha = "a2ac025f00000000000000000000000000000000";
const healthy = (s: string, env = "development") => ({ ok: true, env, sha: s });

describe("redeploys", () => {
  it("follows Railway's watch patterns: the game's folder and the platform, never docs or tests", () => {
    expect(redeploys(["games/team-2/client/main.ts"], team2.watch)).toBe(true);
    expect(redeploys(["server/core/src/shared/messages.ts"], team2.watch)).toBe(true);
    expect(redeploys(["pnpm-lock.yaml"], team2.watch)).toBe(true);
    expect(redeploys(["games/team-3/client/main.ts"], team2.watch)).toBe(false);
    expect(redeploys(["games/team-2/README.md", "games/team-2/room/room.test.ts"], team2.watch)).toBe(false);
    expect(redeploys(["tooling/workflow/pr-open.mjs"], team2.watch)).toBe(false);
  });
});

describe("judge", () => {
  const base = { target: team2, env: "development", sha, error: null, changed: [] as string[] | null };

  it("passes a service that runs the commit", () => {
    expect(judge({ ...base, health: healthy("a2ac025") }).state).toBe("ok");
  });

  it("passes an older deploy when nothing the service deploys changed since", () => {
    const v = judge({
      ...base,
      health: healthy("1111111"),
      changed: ["games/team-3/client/main.ts", "README.md"],
    });
    expect(v).toMatchObject({ state: "ok", message: expect.stringContaining("nothing it deploys changed") });
  });

  it("keeps waiting while a change to the service is not deployed yet", () => {
    expect(
      judge({ ...base, health: healthy("1111111"), changed: ["games/team-2/client/main.ts"] }).state,
    ).toBe("pending");
  });

  it("keeps waiting when the deployed commit is unknown, or the service doesn't answer", () => {
    expect(judge({ ...base, health: healthy("1111111"), changed: null }).state).toBe("pending");
    expect(judge({ ...base, health: null, error: "unreachable" })).toMatchObject({
      state: "pending",
      message: "unreachable",
    });
  });

  it("fails at once on the wrong environment, which won't fix itself", () => {
    expect(judge({ ...base, health: healthy("a2ac025", "production") }).state).toBe("failed");
  });
});

describe("overall and pagesOk", () => {
  it("is ok only when every service is, and failed as soon as one failed", () => {
    const ok = { service: "a", state: "ok" as const, message: "" };
    expect(overall([ok, ok])).toBe("ok");
    expect(overall([ok, { ...ok, state: "pending" }])).toBe("pending");
    expect(
      overall([
        { ...ok, state: "pending" },
        { ...ok, state: "failed" },
      ]),
    ).toBe("failed");
  });

  it("fails pages with errors or a lobby that could not create a room", () => {
    expect(pagesOk([{ service: "team-1", errors: [], room: "no lobby" }])).toBe(true);
    expect(pagesOk([{ service: "team-1", errors: ["page error: x"], room: "created" }])).toBe(false);
    expect(pagesOk([{ service: "team-1", errors: [], room: "failed" }])).toBe(false);
  });
});

describe("smokeMarkdown", () => {
  it("has a row per service and lists page errors", () => {
    const md = smokeMarkdown({
      url: "https://gw.example",
      env: "development",
      sha,
      verdicts: [{ service: "team-2", state: "ok", message: "runs a2ac025" }],
      pages: [{ service: "team-2", errors: ["console error: boom"], room: "created" }],
    });
    expect(md).toContain("| team-2 | ok: runs a2ac025 | 1 error(s) | created |");
    expect(md).toContain("- console error: boom");
  });
});

describe("qa:smoke --since", () => {
  it("passes a push that deploys nothing without a gateway address", () => {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const env = { ...process.env, KIT_GATEWAY: "", GITHUB_OUTPUT: "" };
    const run = (...args: string[]) =>
      spawnSync(process.execPath, [new URL("./smoke.ts", import.meta.url).pathname, "--sha", head, ...args], {
        encoding: "utf8",
        env,
      });
    expect(run("--since", head).status).toBe(0);
    expect(run().status).toBe(3);
  });
});
