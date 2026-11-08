import { ReplaySchema, SeededRandom } from "@kit/core/shared";
import { describe, expect, it } from "vitest";
import { guestFingerprint } from "./guest.ts";
import { runReplay } from "./replayRunner.ts";
import { GameCodeError, Simulation } from "./simulation.ts";
import { Mover, makeCounterGame } from "./testing/counterGame.ts";

function scriptedSim(ticks: number) {
  const def = makeCounterGame();
  const sim = new Simulation(def, { seed: 7, roomId: "r1", sha: "t", startedAt: "x", mode: "live" });
  const driver = new SeededRandom(99);
  const seq = { p1: 0, p2: 0 };
  sim.join("p1", { name: "a" });
  for (let i = 0; i < ticks; i++) {
    if (i === 20) sim.join("p2", { name: "b" });
    if (i === 60) sim.drop("p2");
    if (i === 90) {
      sim.reconnect("p2");
      seq.p2 = -1;
    }
    if (i === 150) sim.leave("p1");
    for (const id of ["p1", "p2"] as const) {
      if (driver.next() < 0.7) sim.queueInput(id, { seq: ++seq[id], data: { dx: driver.range(-1, 1) } });
    }
    sim.tick();
  }
  return { def, sim };
}

describe("runReplay", () => {
  it("re-running a snapshot reproduces the final hash", () => {
    const { def, sim } = scriptedSim(200);
    const replay = sim.snapshot();
    expect(replay.events.some((e) => e.type === "drop")).toBe(true);
    const result = runReplay(def, replay);
    expect(result.tick).toBe(200);
    expect(result.stateHash).toBe(replay.final?.stateHash);
  });

  it("a mid-run snapshot replays to that tick's hash", () => {
    const { def, sim } = scriptedSim(120);
    const mid = sim.snapshot();
    for (let i = 0; i < 30; i++) sim.tick();
    expect(runReplay(def, mid).stateHash).toBe(mid.final?.stateHash);
  });

  it("stops at untilTick", () => {
    const { def, sim } = scriptedSim(100);
    expect(runReplay(def, sim.snapshot(), { untilTick: 40 }).tick).toBe(40);
  });

  it("uses the replay's embedded config, not the definition's", () => {
    const { def, sim } = scriptedSim(100);
    const replay = sim.snapshot();
    const edited = { ...def, config: { ...def.config, speed: 5 } };
    expect(runReplay(edited, replay).stateHash).toBe(replay.final?.stateHash);
  });

  it("rejects another game's replay and a truncated replay", () => {
    const { def, sim } = scriptedSim(10);
    const replay = sim.snapshot();
    expect(() => runReplay(def, { ...replay, game: "other" })).toThrow("replay is for game other");
    expect(() => runReplay(def, { ...replay, truncated: true })).toThrow("replay is truncated");
  });
});

describe("review fixes", () => {
  it("a room with a code replays to the same hash", () => {
    const def = makeCounterGame();
    const sim = new Simulation(def, {
      seed: 1,
      roomId: "r",
      sha: "t",
      startedAt: "x",
      mode: "live",
      code: "QXTR",
    });
    expect(sim.state.code).toBe("QXTR");
    sim.join("p1", {});
    sim.tick();
    const replay = sim.snapshot();
    expect(replay.code).toBe("QXTR");
    expect(runReplay(def, replay).stateHash).toBe(replay.final?.stateHash);
  });

  it("pause, then a reconnect, then unpause replays to the same hash", () => {
    const def = makeCounterGame();
    const sim = new Simulation(def, { seed: 1, roomId: "r", sha: "t", startedAt: "x", mode: "live" });
    sim.join("p1", {});
    sim.queueInput("p1", { seq: 50, data: { dx: 1 } });
    sim.applyDebug("p1", "pause", []);
    sim.drop("p1");
    sim.reconnect("p1");
    sim.applyDebug("p1", "pause", []);
    expect(sim.queueInput("p1", { seq: 1, data: { dx: 1 } })).toBe("ok");
    sim.tick();
    sim.tick();
    const replay = sim.snapshot();
    expect(runReplay(def, replay).stateHash).toBe(replay.final?.stateHash);
  });

  it("a crash in step is recorded and re-thrown by the replay at the same tick", () => {
    const def = makeCounterGame({
      step(ctx) {
        ctx.state.coins += 1;
        if (ctx.tick === 3) throw new Error("boom");
      },
    });
    const sim = new Simulation(def, { seed: 1, roomId: "r", sha: "t", startedAt: "x", mode: "live" });
    sim.join("p1", {});
    sim.tick();
    sim.tick();
    sim.tick();
    expect(() => sim.tick()).toThrow(GameCodeError);
    const replay = sim.snapshot();
    expect(replay.failure).toEqual({ tick: 3, hook: "step", message: "boom" });
    expect(replay.final).toBeNull();
    expect(() => runReplay(def, replay)).toThrow("step threw at tick 3: boom");
  });

  it("a crash in join keeps the join recorded and is re-thrown by the replay", () => {
    const def = makeCounterGame({
      join(_ctx, playerId) {
        if (playerId === "bad") throw new Error("join boom");
      },
    });
    const sim = new Simulation(def, { seed: 1, roomId: "r", sha: "t", startedAt: "x", mode: "live" });
    expect(() => sim.join("bad", {})).toThrow(GameCodeError);
    expect(() => sim.join("p2", { name: "x".repeat(40) })).not.toThrow(GameCodeError);
    const replay = sim.snapshot();
    expect(replay.failure).toMatchObject({ hook: "join", tick: 0 });
    expect(() => runReplay(def, replay)).toThrow("join threw at tick 0: join boom");
  });
});

describe("guests in replays", () => {
  const ada = "1d2c3b4a-5f6e-4d7c-8b9a-0f1e2d3c4b5a";
  const bo = "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d";
  /** Names each mover after its guest, the way a game might restore a returning player. */
  const guestGame = () =>
    makeCounterGame({
      join(ctx, playerId, _options, { guest }) {
        const returning = [...ctx.state.movers.values()].filter((m) => m.name === guest && guest !== "");
        ctx.state.coins += returning.length;
        ctx.state.movers.set(playerId, Object.assign(new Mover(), { name: guest, x: ctx.rng.int(0, 10) }));
      },
    });

  function guestSim() {
    const def = guestGame();
    const sim = new Simulation(def, { seed: 3, roomId: "r", sha: "t", startedAt: "x", mode: "live" });
    sim.join("p1", { name: "a", guestId: ada }, guestFingerprint("counter", ada));
    sim.tick();
    sim.join("p2", { name: "a again", guestId: ada }, guestFingerprint("counter", ada));
    sim.join("p3", { name: "b", guestId: bo }, guestFingerprint("counter", bo));
    sim.join("p4", { name: "c" });
    for (let i = 0; i < 5; i++) sim.tick();
    return { def, sim };
  }

  it("a replay with guests reproduces its hash, and its JSON has no raw guest ID", () => {
    const { def, sim } = guestSim();
    expect(sim.state.coins).toBeGreaterThan(0);
    const replay = ReplaySchema.parse(JSON.parse(JSON.stringify(sim.snapshot())));
    const json = JSON.stringify(replay);
    expect(json).not.toContain(ada);
    expect(json).not.toContain(bo);
    const result = runReplay(def, replay);
    expect(result.stateHash).toBe(replay.final?.stateHash);
    expect(result.state.seats.get("p2")?.guest).toBe(guestFingerprint("counter", ada));
    expect(result.state.seats.get("p4")?.guest).toBe("");
  });

  it("the recorded guest matters: dropping it changes the hash", () => {
    const { def, sim } = guestSim();
    const replay = sim.snapshot();
    const stripped = {
      ...replay,
      events: replay.events.map((e) => (e.type === "join" ? { ...e, guest: "" } : e)),
    };
    expect(runReplay(def, stripped).stateHash).not.toBe(replay.final?.stateHash);
  });

  it('an old replay without guest fields still runs, with every guest ""', () => {
    const def = makeCounterGame();
    const sim = new Simulation(def, { seed: 5, roomId: "r", sha: "t", startedAt: "x", mode: "live" });
    sim.join("p1", { name: "a" });
    sim.tick();
    sim.join("p2", { name: "b" });
    sim.tick();
    const old = JSON.parse(JSON.stringify(sim.snapshot())) as { events: Record<string, unknown>[] };
    for (const event of old.events) delete event.guest;
    expect(JSON.stringify(old)).not.toContain('"guest"');
    const replay = ReplaySchema.parse(old);
    const result = runReplay(def, replay);
    expect(result.stateHash).toBe(replay.final?.stateHash);
    expect(result.state.seats.get("p1")?.guest).toBe("");
  });
});
