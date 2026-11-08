import { afterEach, describe, expect, it } from "vitest";
import { createGameServer, createGameServerContext } from "./app.config.ts";
import { boot, type ColyseusTestServer, captureLog } from "./testing/index.ts";

let server: ColyseusTestServer | undefined;
afterEach(async () => {
  await server?.shutdown();
  server = undefined;
});

async function bootWith(env: "development" | "production", debugTools = false) {
  const ctx = createGameServerContext("template", captureLog());
  ctx.deps.env = env;
  ctx.deps.debugTools = debugTools;
  server = await boot(createGameServer({ gameId: "template" }, ctx));
  return `http://127.0.0.1:${server.server["port" as keyof typeof server.server]}`;
}

describe("createGameServer", () => {
  it("/colyseus is not mounted in production", async () => {
    const base = await bootWith("production");
    expect((await fetch(`${base}/colyseus`)).status).toBe(404);
    expect((await fetch(`${base}/api/stats`)).status).toBe(200);
  });

  it("/colyseus is mounted in development", async () => {
    const base = await bootWith("development");
    expect((await fetch(`${base}/colyseus/`)).status).toBe(200);
  });

  it("/health keeps APP_ENV and reports whether debug is on", async () => {
    const health = async (base: string) => (await fetch(`${base}/health`)).json();
    expect(await health(await bootWith("production"))).toMatchObject({ env: "production", debug: false });
    await server?.shutdown();
    expect(await health(await bootWith("production", true))).toMatchObject({
      env: "production",
      debug: true,
    });
    await server?.shutdown();
    expect(await health(await bootWith("development"))).toMatchObject({ env: "development", debug: true });
  });

  it("/colyseus is mounted in production when DEBUG_TOOLS is on", async () => {
    const base = await bootWith("production", true);
    expect((await fetch(`${base}/colyseus/`)).status).toBe(200);
  });
});
