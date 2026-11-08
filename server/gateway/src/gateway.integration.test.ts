// A real game server behind the gateway, played with a real Colyseus client. This is the proof that a game
// works under /team-x without knowing it: matchmaking, the WebSocket and the game's own routes all go
// through the prefix.
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@colyseus/sdk";
import { makeCounterGame } from "@kit/core/testing";
import { boot, type ColyseusTestServer, captureLog } from "@kit/host/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createGateway } from "./index.ts";

const GAME_PORT = 2701;

let game: ColyseusTestServer;
let gateway: Server;
let base: string;

beforeAll(async () => {
  // APP_ENV is read once when the host module loads, so set it before the import.
  vi.stubEnv("APP_ENV", "development");
  const { createGameServer, createGameServerContext, createGameRoom } = await import("@kit/host");
  const context = createGameServerContext("team-x", captureLog());
  game = await boot(
    createGameServer(
      { gameId: "team-x", rooms: { game: (deps) => createGameRoom(makeCounterGame(), deps) } },
      context,
    ),
    GAME_PORT,
  );
  gateway = createGateway({
    games: ["team-x"],
    planned: [],
    upstream: () => `http://127.0.0.1:${GAME_PORT}`,
    env: "development",
    sha: "abc123",
    startedAt: "2026-01-01T00:00:00.000Z",
  });
  await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}/team-x`;
});

afterAll(async () => {
  gateway.closeAllConnections();
  gateway.close();
  await game.shutdown();
  vi.unstubAllEnvs();
});

const report = {
  title: "stuck",
  description: "",
  game: "team-x",
  env: "development",
  sha: "s",
  roomId: null,
  playerId: null,
  tick: null,
  scenario: null,
  url: "http://x/",
  userAgent: "test",
  net: null,
  logs: [],
  screenshot: null,
};

const postReport = (forwardedFor: string) =>
  fetch(`${base}/api/bug-reports`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": forwardedFor },
    body: JSON.stringify(report),
  });

describe("a real game behind the gateway", () => {
  it("lets a Colyseus client with the endpoint /team-x join a room and receive its state", async () => {
    const client = new Client(base);
    const room = await client.joinOrCreate("game", { name: "Ada" });
    try {
      type Seats = { size: number };
      await vi.waitFor(() => expect((room.state as { seats?: Seats } | undefined)?.seats?.size).toBe(1));
      expect(room.roomId).toBeTruthy();
    } finally {
      await room.leave();
    }
  });

  it("keeps the connection working: input reaches the game and its state comes back", async () => {
    const room = await new Client(base).joinOrCreate("game", { name: "Bo" });
    try {
      type State = { movers?: Map<string, { x: number }> };
      const x = () => (room.state as State | undefined)?.movers?.get(room.sessionId)?.x;
      await vi.waitFor(() => expect(x()).toBeTypeOf("number"));
      const before = x() as number;
      room.send("input", { seq: 1, data: { dx: 1 } });
      await vi.waitFor(() => expect(x()).toBe(before + 1));
    } finally {
      await room.leave();
    }
  });

  it("serves the game's own routes through the prefix", async () => {
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, env: "development", games: ["team-x"] });

    const stats = await fetch(`${base}/api/stats`);
    expect(stats.status).toBe(200);
    expect(await stats.json()).toHaveProperty("process");
    expect((await postReport("198.51.100.200, 10.9.9.9")).status).toBe(201);
  });

  it("answers its own /health for the platform without involving the game", async () => {
    const res = await fetch(`${base.replace("/team-x", "")}/health`);
    expect(await res.json()).toMatchObject({ ok: true, games: ["team-x"], sha: "abc123" });
  });

  it("gives every player their own rate-limit bucket: the game sees the real client address", async () => {
    // Railway's edge puts the player's address last in X-Forwarded-For and the gateway passes it on untouched,
    // so the game (trusting one proxy) tells players apart. If the gateway appended its own peer address,
    // every player would look like the gateway and the 6th report in a minute would be refused.
    for (let i = 1; i <= 8; i++) expect((await postReport(`203.0.113.${i}`)).status).toBe(201);
  });

  it("still limits one player, and a spoofed address in front does not help", async () => {
    for (let i = 0; i < 5; i++) expect((await postReport(`192.0.2.${i}, 198.51.100.50`)).status).toBe(201);
    expect((await postReport("192.0.2.99, 198.51.100.50")).status).toBe(429);
  });
});
