import { spawnSync } from "node:child_process";
import { createRailwayContext, type ProjectDefinition, type ServiceNode } from "railway/iac";
import { describe, expect, it } from "vitest";
import program, {
  checkGame,
  ENVIRONMENTS,
  type EnvironmentName,
  GAMES,
  GATEWAY,
  gameVariables,
} from "./railway.ts";

async function plan(environment: string): Promise<ServiceNode[]> {
  const definition: ProjectDefinition = await program(createRailwayContext({ environment }), (name, def) => ({
    name,
    ...def,
  }));
  return (definition.resources ?? []).flat() as ServiceNode[];
}

describe.each(Object.keys(ENVIRONMENTS) as EnvironmentName[])("railway.ts in %s", (environment) => {
  const { branch, appEnv } = ENVIRONMENTS[environment];

  it("has the gateway and one service per game", async () => {
    expect((await plan(environment)).map((s) => s.name)).toEqual([GATEWAY, ...GAMES.map((g) => g.service)]);
  });

  it("tells the gateway which games it serves and which are still planned", async () => {
    const gateway = (await plan(environment)).find((s) => s.name === GATEWAY);
    const list = (name: string) => {
      const v = gateway?.variables?.[name];
      return v && "value" in v ? String(v.value).split(",").filter(Boolean) : [];
    };
    expect(list("GAMES")).toEqual(GAMES.map((g) => g.service));
    expect(list("PLANNED_GAMES")).toEqual(
      ["team-1", "team-2", "team-3", "team-4"].filter((t) => !GAMES.some((g) => g.service === t)),
    );
  });

  it("reaches every game on the port the games listen on", async () => {
    const services = await plan(environment);
    const port = services.find((s) => s.name !== GATEWAY)?.variables?.PORT;
    expect(services.find((s) => s.name === GATEWAY)?.variables?.UPSTREAM_PORT).toEqual(port);
  });

  it("sets DEBUG_TOOLS=on only on the games marked debug", async () => {
    const services = await plan(environment);
    expect(services.find((s) => s.name === GATEWAY)?.variables?.DEBUG_TOOLS).toBeUndefined();
    for (const game of GAMES) {
      const variable = services.find((s) => s.name === game.service)?.variables?.DEBUG_TOOLS;
      expect(variable).toEqual(game.debug ? { type: "literal", value: "on" } : undefined);
    }
  });

  it("declares no custom domain on any service", async () => {
    // Railway's generated domains are not part of this file, so the file cannot make a game private by
    // itself: only the gateway is given a domain, by hand (see RAILWAY_SETUP.md). Games stay correct even
    // if one is public, because the gateway passes X-Forwarded-For through untouched.
    for (const s of await plan(environment)) {
      expect(s.networking?.customDomains ?? {}).toEqual({});
    }
  });

  it("deploys the right branch, and only after CI passed", async () => {
    for (const s of await plan(environment)) {
      expect(s.source).toMatchObject({ type: "github", repo: "OWNER/REPO", branch, checkSuites: true });
    }
  });

  it("runs one replica, health-checked on /health, with the right APP_ENV", async () => {
    for (const s of await plan(environment)) {
      const replicas = Object.values(s.deploy?.multiRegionConfig ?? {}).map((r) => r?.numReplicas ?? 0);
      expect(replicas).toEqual([1]);
      expect(s.deploy?.healthcheckPath).toBe("/health");
      expect(s.deploy?.sleepApplication).toBe(false);
      expect(s.deploy?.startCommand).toMatch(/^node /);
      expect(s.variables?.APP_ENV).toEqual({ type: "literal", value: appEnv });
    }
  });
});

describe("railway.ts", () => {
  it("has one environment, production, deployed from main", () => {
    expect(ENVIRONMENTS).toEqual({ production: { branch: "main", appEnv: "production" } });
  });

  it("starts the gateway from its own folder and watches it", async () => {
    const gateway = (await plan("production")).find((s) => s.name === GATEWAY);
    expect(gateway?.deploy?.startCommand).toBe("node --import tsx server/gateway/server.ts");
    expect(gateway?.build?.watchPatterns).toContain("/server/gateway/**");
  });

  it.each(["gateway", "health"])("refuses a game named %s: the gateway uses the name itself", (service) => {
    expect(() => checkGame({ service, dir: "server/template", package: "@kit/template" })).toThrow(
      /reserved/,
    );
    expect(checkGame({ service: "team-2-x", dir: "server/template", package: "@kit/template" })).toBeTruthy();
  });

  it("turns DEBUG_TOOLS on for a game with debug: true and leaves APP_ENV production", () => {
    const game = { service: "team-2", dir: "games/team-2", package: "@team-2/game" };
    const env = ENVIRONMENTS.production;
    expect(gameVariables(game, env)).not.toHaveProperty("DEBUG_TOOLS");
    expect(gameVariables({ ...game, debug: true }, env)).toMatchObject({
      APP_ENV: "production",
      DEBUG_TOOLS: "on",
    });
  });

  it("refuses an environment it doesn't manage", async () => {
    await expect(plan("staging")).rejects.toThrow(/not "staging"/);
  });

  it("loads with plain Node type stripping, the way the Railway CLI runs it", () => {
    // A file:// URL, not a path: on Windows, import("D:\\...") reads "d:" as a URL scheme and fails.
    const url = new URL("./railway.ts", import.meta.url).href;
    const run = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "-e", `await import(${JSON.stringify(url)});`],
      { encoding: "utf8" },
    );
    expect(run.stderr).not.toMatch(/Error/);
    expect(run.status).toBe(0);
  });
});
