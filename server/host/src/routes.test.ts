import type { AddressInfo } from "node:net";
import type { BugReport, Replay } from "@kit/core/shared";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { type LiveRoom, LiveRoomRegistry } from "./gameRoom.ts";
import { registerRoutes } from "./routes.ts";
import { MemoryStores } from "./stores.ts";
import { captureLog } from "./testing/captureLog.ts";

const replay = (roomId: string): Replay => ({
  version: 2,
  game: "template",
  roomId,
  seed: 1,
  tickRate: 30,
  configVersion: "1",
  config: { version: "1" },
  sha: "s",
  scenario: null,
  startedAt: "t",
  events: [
    { type: "join", tick: 0, playerId: "p1", options: { name: "Ada" }, guest: "" },
    { type: "join", tick: 3, playerId: "p2", options: { name: "Bo" }, guest: "" },
  ],
  code: "",
  failure: null,
  truncated: false,
  final: { tick: 9, stateHash: "h" },
});

const liveRoom = (roomId: string, code: string, players = 1, maxPlayers = 8): LiveRoom => ({
  roomId,
  code,
  maxPlayers,
  players: () => players,
  connected: () => players,
  snapshot: () => replay(roomId),
  latestStats: () => null,
  notify: () => {},
});

const report: BugReport = {
  title: "stuck",
  description: "",
  game: "template",
  env: "development",
  sha: "s",
  roomId: "live1",
  playerId: "p1",
  tick: 3,
  scenario: null,
  url: "http://x/?room=QXTR",
  userAgent: "test",
  net: null,
  logs: [],
  screenshot: null,
};

let close: (() => void) | undefined;
afterEach(() => close?.());

async function start(env: "development" | "production") {
  const app = express();
  const registry = new LiveRoomRegistry();
  const stores = new MemoryStores({ budgetBytes: 50_000_000 });
  const log = captureLog();
  registry.add(liveRoom("live1", "QXTR"));
  registry.add(liveRoom("full1", "FULL", 2, 2));
  registerRoutes(app, { env, stores, registry, gameId: "template", logger: log });
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  close = () => server.close();
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { base, post, stores, registry, log };
}

describe("routes", () => {
  it("replay of a live room downloads with final set; unknown room is 404", async () => {
    const { base, stores, log } = await start("development");
    const res = await fetch(`${base}/api/replays/live1`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="replay-live1.json"');
    expect(((await res.json()) as Replay).final).toEqual({ tick: 9, stateHash: "h" });
    stores.putReplay("done1", replay("done1"));
    expect((await fetch(`${base}/api/replays/done1`)).status).toBe(200);
    const missing = await fetch(`${base}/api/replays/nope`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "unknown room" });
    expect(log.lines.some((l) => l.message === "replay downloaded")).toBe(true);
  });

  it("production replays keep player names so they re-run to their hash", async () => {
    const { base } = await start("production");
    const body = (await (await fetch(`${base}/api/replays/live1`)).json()) as Replay;
    const names = body.events.map((e) => (e.type === "join" ? e.options.name : null));
    expect(names).toEqual(["Ada", "Bo"]);
  });

  it("live replay downloads are rate-limited per IP", async () => {
    const { base } = await start("development");
    for (let i = 0; i < 10; i++) expect((await fetch(`${base}/api/replays/live1`)).status).toBe(200);
    expect((await fetch(`${base}/api/replays/live1`)).status).toBe(429);
  });

  it("a spoofed X-Forwarded-For does not get around the bug report limit", async () => {
    const { base } = await start("development");
    const send = (i: number) =>
      fetch(`${base}/api/bug-reports`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${i}, 9.9.9.9` },
        body: JSON.stringify(report),
      });
    for (let i = 0; i < 5; i++) expect((await send(i)).status).toBe(201);
    expect((await send(99)).status).toBe(429);
  });

  it("production /api/stats doesn't reveal room ids or codes", async () => {
    const { base } = await start("production");
    const body = (await (await fetch(`${base}/api/stats`)).json()) as { rooms: Record<string, unknown>[] };
    expect(body.rooms).toHaveLength(2);
    for (const room of body.rooms) {
      expect(room.roomId).toBeUndefined();
      expect(room.code).toBeUndefined();
    }
  });

  it("bug report: 201 with a uuid and the room's replay attached; GET returns it", async () => {
    const { base, post } = await start("development");
    const res = await post("/api/bug-reports", report);
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; url: string };
    expect(created.url).toBe(`/api/bug-reports/${created.id}`);
    const stored = (await (await fetch(`${base}${created.url}`)).json()) as {
      replay: Replay;
      report: BugReport;
    };
    expect(stored.replay.roomId).toBe("live1");
    expect(stored.report.title).toBe("stuck");
    expect((await fetch(`${base}/api/bug-reports/nope`)).status).toBe(404);
    expect((await post("/api/bug-reports", { title: "" })).status).toBe(400);
  });

  it("bug report: the 6th post within a minute is 429 and a 4 MB body is 413", async () => {
    const { post } = await start("development");
    for (let i = 0; i < 5; i++) expect((await post("/api/bug-reports", report)).status).toBe(201);
    expect((await post("/api/bug-reports", report)).status).toBe(429);
    const { post: post2 } = await start("development");
    const big = { ...report, description: "x".repeat(4 * 1024 * 1024) };
    expect((await post2("/api/bug-reports", big)).status).toBe(413);
  });

  it("join by code: found, lower case works, unknown is 404, full is 409", async () => {
    const { post } = await start("development");
    const ok = await post("/api/rooms/join", { code: "qxtr" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ roomId: "live1" });
    expect((await post("/api/rooms/join", { code: "ZZZZ" })).status).toBe(404);
    const full = await post("/api/rooms/join", { code: "FULL" });
    expect(full.status).toBe(409);
    expect(await full.json()).toEqual({ error: "room is full" });
    expect((await post("/api/rooms/join", {})).status).toBe(400);
  });

  it("/api/stats lists live rooms with their latest stats", async () => {
    const { base } = await start("development");
    const body = (await (await fetch(`${base}/api/stats`)).json()) as {
      rooms: { code: string }[];
      process: { rooms: number; players: number; replaysStored: number };
    };
    expect(body.rooms.map((r) => r.code).sort()).toEqual(["FULL", "QXTR"]);
    expect(body.process).toMatchObject({ rooms: 2, players: 3 });
    expect(body.process.replaysStored).toBe(0);
  });
});
