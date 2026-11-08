import { createServer, type Server } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGameServer, createGameServerContext } from "../app.config.ts";
import { boot, type ColyseusTestServer, captureLog, freePort } from "./index.ts";

const servers: ColyseusTestServer[] = [];
let blocker: Server | null = null;

// Make sure @colyseus/testing's default port (2568) is taken, as another test run on the same machine
// would. If something already holds it, that's just as good.
beforeAll(async () => {
  const server = createServer();
  const held = await new Promise<boolean>((resolve) => {
    server.once("error", () => resolve(false));
    server.listen(2568, () => resolve(true));
  });
  blocker = held ? server : null;
});
afterAll(async () => {
  for (const s of servers) await s.shutdown();
  if (blocker) await new Promise((resolve) => blocker?.close(resolve));
});

const start = () =>
  boot(createGameServer({ gameId: "template" }, createGameServerContext("template", captureLog())));

describe("boot from @kit/host/testing", () => {
  it("picks a free port when none is given, so servers never collide", async () => {
    const [a, b] = await Promise.all([start(), start()]);
    servers.push(a, b);
    const portA = a.server["port" as keyof typeof a.server];
    const portB = b.server["port" as keyof typeof b.server];
    expect(portA).not.toBe(portB);
    expect(portA).not.toBe(2568);
    for (const s of [a, b]) {
      const res = await fetch(`http://127.0.0.1:${s.server["port" as keyof typeof s.server]}/health`);
      expect(res.status).toBe(200);
    }
  });

  it("freePort returns a port nothing is listening on", async () => {
    const port = await freePort();
    expect(port).toBeGreaterThan(0);
    const probe = createServer();
    await new Promise<void>((resolve, reject) => probe.once("error", reject).listen(port, resolve));
    await new Promise((resolve) => probe.close(resolve));
  });
});
