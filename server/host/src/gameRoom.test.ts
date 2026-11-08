import config from "@colyseus/tools";
import { guestFingerprint, runReplay } from "@kit/core/server";
import type { Replay } from "@kit/core/shared";
import { counterConfig, makeCounterGame } from "@kit/core/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createGameRoom, LiveRoomRegistry } from "./gameRoom.ts";
import { captureLog } from "./testing/captureLog.ts";
import { boot, type ColyseusTestServer } from "./testing/index.ts";

const replays = new Map<string, Replay>();
const sink = { putReplay: (roomId: string, replay: Replay) => replays.set(roomId, replay) };
const log = captureLog();
const registry = new LiveRoomRegistry();
const deps = (env: "development" | "production") => ({
  env,
  sha: "test",
  stores: sink,
  logger: log,
  registry,
});

const counter = makeCounterGame();
const otherGame = makeCounterGame({ id: "other-game" });
const tiny = makeCounterGame({ config: { ...counterConfig, maxPlayers: 1 } });
const badJoin = makeCounterGame({
  join(_ctx, _playerId, options) {
    if (options.name === "crash") throw new Error("join boom");
  },
});
const crashing = makeCounterGame({
  step(ctx) {
    if (ctx.tick === 5) throw new Error("boom");
  },
});

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(
    config({
      initializeGameServer: (gs) => {
        gs.define("dev", createGameRoom(counter, deps("development")));
        gs.define("prod", createGameRoom(counter, deps("production")));
        gs.define("prod-debug", createGameRoom(counter, { ...deps("production"), debugTools: true }));
        gs.define("other", createGameRoom(otherGame, deps("development")));
        gs.define("tiny", createGameRoom(tiny, deps("development")));
        gs.define("crash", createGameRoom(crashing, deps("development")));
        gs.define("badjoin", createGameRoom(badJoin, deps("development")));
        gs.define("stats", createGameRoom(counter, { ...deps("development"), statsIntervalMs: 30 }));
      },
    }),
  );
});
afterAll(() => colyseus?.shutdown());
beforeEach(async () => {
  await colyseus.cleanup();
  log.lines.length = 0;
});

describe("createGameRoom", () => {
  it("a private room gets a 4-letter code in state, metadata and the registry", async () => {
    const room = await colyseus.createRoom("dev", { private: true });
    const code = (room.state as { code: string }).code;
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
    expect(room.metadata).toMatchObject({ code });
    expect(registry.byCode(code)?.roomId).toBe(room.roomId);
    const client = await colyseus.sdk.joinById(room.roomId, { name: "Ada" });
    // The client decodes its first state some time after the join resolves; on a slow CI runner that
    // can be after the server's next patch, so wait for the client's own copy instead of assuming it.
    await vi.waitFor(() => expect(client.state.seats?.size).toBe(1), { timeout: 2000, interval: 20 });
    expect(log.lines.some((l) => l.message === "room created" && l.fields.code === code)).toBe(true);
  });

  it("invalid join options reject the join", async () => {
    const room = await colyseus.createRoom("dev", {});
    await expect(colyseus.sdk.joinById(room.roomId, { name: "x".repeat(40) })).rejects.toThrow();
    expect((room.state as { seats: Map<string, unknown> }).seats.size).toBe(0);
  });

  it("a full room rejects the next join with an error", async () => {
    const room = await colyseus.createRoom("tiny", {});
    await colyseus.connectTo(room, {});
    await expect(colyseus.sdk.joinById(room.roomId, {})).rejects.toThrow();
  });

  it("applies inputs on the next tick and counts rejected ones", async () => {
    const room = await colyseus.createRoom("dev", {});
    const client = await colyseus.connectTo(room, { name: "a" });
    const before = client.state.movers.get(client.sessionId)?.x ?? 0;
    client.send("input", { seq: 1, data: { dx: 1 } });
    client.send("input", { seq: 1, data: { dx: 1 } });
    await room.waitForNextTimestep();
    await room.waitForNextTimestep();
    await room.waitForNextPatch();
    expect(client.state.movers.get(client.sessionId)?.x).toBe(before + 1);
    expect(client.state.seats.get(client.sessionId)?.lastSeq).toBe(1);
  });

  it("debug commands work in development", async () => {
    const room = await colyseus.createRoom("dev", {});
    const client = await colyseus.connectTo(room, {});
    const reply = client.waitForMessage("debug:result");
    client.send("debug:command", { id: "1", command: "pause" });
    expect(await reply).toEqual({ id: "1", ok: true, output: "paused" });
    const bad = client.waitForMessage("debug:result");
    client.send("debug:command", { id: "2", command: "nope" });
    expect(await bad).toMatchObject({ id: "2", ok: false, output: "unknown command: nope" });
  });

  it("debug commands are rejected in production", async () => {
    const room = await colyseus.createRoom("prod", {});
    const client = await colyseus.connectTo(room, {});
    const reply = client.waitForMessage("debug:result");
    client.send("debug:command", { id: "1", command: "pause" });
    expect(await reply).toEqual({ id: "1", ok: false, output: "debug commands are disabled in production" });
    expect((room.state as { paused: boolean }).paused).toBe(false);
    expect(log.lines.some((l) => l.level === "warn" && l.fields.command === "pause")).toBe(true);
  });

  it("debug commands work in production when DEBUG_TOOLS is on", async () => {
    const room = await colyseus.createRoom("prod-debug", {});
    const client = await colyseus.connectTo(room, {});
    const reply = client.waitForMessage("debug:result");
    client.send("debug:command", { id: "1", command: "pause" });
    expect(await reply).toEqual({ id: "1", ok: true, output: "paused" });
  });

  it("a step that throws logs an error, notifies players, closes the room, and the replay is stored", async () => {
    const room = await colyseus.createRoom("crash", {});
    const roomId = room.roomId;
    const client = await colyseus.connectTo(room, {});
    const notice = await client.waitForMessage("notice", 2000);
    expect(notice).toMatchObject({ level: "error" });
    await new Promise((r) => setTimeout(r, 50));
    const error = log.lines.find((l) => l.level === "error");
    expect(error?.fields).toMatchObject({ roomId, tick: 5, replayUrl: `/api/replays/${roomId}` });
    expect(replays.get(roomId)?.failure).toMatchObject({ tick: 5, hook: "step", message: "boom" });
    const replay = replays.get(roomId);
    expect(() => replay && runReplay(crashing, replay)).toThrow("step threw at tick 5: boom");
    expect(registry.get(roomId)).toBeUndefined();
  });

  it("on dispose the replay lands in the store and re-runs to its hash", async () => {
    const room = await colyseus.createRoom("dev", {});
    const roomId = room.roomId;
    const client = await colyseus.connectTo(room, { name: "a" });
    for (let seq = 1; seq <= 5; seq++) {
      client.send("input", { seq, data: { dx: 0.5 } });
      await room.waitForNextTimestep();
    }
    await client.leave();
    await new Promise((r) => setTimeout(r, 50));
    const replay = replays.get(roomId);
    expect(replay?.events.some((e) => e.type === "input")).toBe(true);
    expect(replay && runReplay(counter, replay).stateHash).toBe(replay?.final?.stateHash);
    expect(log.lines.some((l) => l.message === "room closed")).toBe(true);
  });

  it("a private room's replay re-runs to its hash", async () => {
    const room = await colyseus.createRoom("dev", { private: true });
    const roomId = room.roomId;
    const client = await colyseus.connectTo(room, { name: "a" });
    client.send("input", { seq: 1, data: { dx: 1 } });
    await room.waitForNextTimestep();
    await client.leave();
    await new Promise((r) => setTimeout(r, 50));
    const replay = replays.get(roomId);
    expect(replay?.code).toMatch(/^[A-Z]{4}$/);
    expect(replay && runReplay(counter, replay).stateHash).toBe(replay?.final?.stateHash);
  });

  it("a join hook that throws rejects the join, logs an error and closes the room", async () => {
    const room = await colyseus.createRoom("badjoin", {});
    const roomId = room.roomId;
    await colyseus.connectTo(room, { name: "ok" });
    await expect(colyseus.sdk.joinById(roomId, { name: "crash" })).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 100));
    expect(log.lines.find((l) => l.level === "error")?.fields).toMatchObject({ roomId, methodName: "join" });
    expect(registry.get(roomId)).toBeUndefined();
    expect(replays.get(roomId)?.failure).toMatchObject({ hook: "join" });
  });

  describe("guests", () => {
    const ada = "4f3e2d1c-0b9a-4876-9543-210fedcba987";
    const bo = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
    type Seats = { seats: Map<string, { guest: string }> };
    const guestOf = (state: unknown, id: string) => (state as Seats).seats.get(id)?.guest;

    it("two clients with the same guest ID share a fingerprint and a third doesn't; the raw ID goes nowhere", async () => {
      const room = await colyseus.createRoom("stats", {});
      const roomId = room.roomId;
      const a = await colyseus.connectTo(room, { name: "a", guestId: ada });
      const b = await colyseus.connectTo(room, { name: "b", guestId: ada });
      const c = await colyseus.connectTo(room, { name: "c", guestId: bo });
      await vi.waitFor(() => expect(c.state.seats?.size).toBe(3), { timeout: 2000, interval: 20 });
      await vi.waitFor(() => expect(guestOf(a.state, c.sessionId)).toBeTruthy(), {
        timeout: 2000,
        interval: 20,
      });

      const fp = guestFingerprint(counter.id, ada);
      expect(fp).toMatch(/^[0-9a-f]{12}$/);
      for (const view of [a.state, c.state]) {
        expect(guestOf(view, a.sessionId)).toBe(fp);
        expect(guestOf(view, b.sessionId)).toBe(fp);
        expect(guestOf(view, c.sessionId)).toBe(guestFingerprint(counter.id, bo));
      }
      expect(guestFingerprint(counter.id, bo)).not.toBe(fp);

      const joins = log.lines.filter((l) => l.message === "player joined");
      expect(joins.map((l) => l.fields.guest)).toEqual([fp, fp, guestFingerprint(counter.id, bo)]);
      await vi.waitFor(() => expect(log.lines.some((l) => l.message === "room.stats")).toBe(true), {
        timeout: 2000,
        interval: 20,
      });

      const live = registry.get(roomId)?.snapshot();
      await Promise.all([a.leave(), b.leave(), c.leave()]);
      await new Promise((r) => setTimeout(r, 50));
      const places = {
        clientState: JSON.stringify(a.state.toJSON()),
        serverState: JSON.stringify(room.state.toJSON()),
        liveReplay: JSON.stringify(live),
        storedReplay: JSON.stringify(replays.get(roomId)),
        logs: JSON.stringify(log.lines),
      };
      for (const [place, text] of Object.entries(places)) {
        expect(text, place).not.toContain(ada);
        expect(text, place).not.toContain(bo);
      }
      expect(places.storedReplay).toContain(fp);
      const replay = replays.get(roomId);
      expect(replay && runReplay(counter, replay).stateHash).toBe(replay?.final?.stateHash);
    });

    it("the fingerprint is per game: one guest ID gets the same guest in every room of a game, another in a different game", async () => {
      const [first, second, other] = await Promise.all([
        colyseus.createRoom("dev", {}),
        colyseus.createRoom("dev", {}),
        colyseus.createRoom("other", {}),
      ]);
      const clients = await Promise.all(
        [first, second, other].map((room) => colyseus.connectTo(room, { name: "a", guestId: ada })),
      );
      const guests = await Promise.all(
        clients.map(async (client) => {
          await vi.waitFor(() => expect(guestOf(client.state, client.sessionId)).toBeTruthy(), {
            timeout: 2000,
            interval: 20,
          });
          return guestOf(client.state, client.sessionId);
        }),
      );
      expect(guests[0]).toBe(guestFingerprint(counter.id, ada));
      expect(guests[1]).toBe(guests[0]);
      expect(guests[2]).toBe(guestFingerprint("other-game", ada));
      expect(guests[2]).not.toBe(guests[0]);
    });

    it('a join with a missing or bad guestId still works, with guest ""', async () => {
      const room = await colyseus.createRoom("dev", {});
      const clients = await Promise.all(
        [{}, { guestId: "nope" }, { guestId: 42 }, { guestId: "x".repeat(5000) }].map((options) =>
          colyseus.connectTo(room, { name: "p", ...options }),
        ),
      );
      const [first] = clients;
      await vi.waitFor(() => expect(first?.state.seats?.size).toBe(4), { timeout: 2000, interval: 20 });
      for (const client of clients) expect(guestOf(first?.state, client.sessionId)).toBe("");
      expect(log.lines.filter((l) => l.message === "player joined").map((l) => l.fields.guest)).toEqual([
        "",
        "",
        "",
        "",
      ]);
      expect(log.lines.some((l) => l.message === "join rejected")).toBe(false);
    });
  });
});
