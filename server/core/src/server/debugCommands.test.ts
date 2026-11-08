import { describe, expect, it } from "vitest";
import { runReplay } from "./replayRunner.ts";
import { Simulation } from "./simulation.ts";
import { makeCounterGame } from "./testing/counterGame.ts";

function newSim(def = makeCounterGame()) {
  const sim = new Simulation(def, { seed: 3, roomId: "r", sha: "t", startedAt: "x", mode: "live" });
  sim.join("p1", { name: "a" });
  return sim;
}

describe("debug commands", () => {
  it("pause then step 3 advances exactly 3 ticks", () => {
    const sim = newSim();
    sim.applyDebug("p1", "pause", []);
    sim.tick();
    expect(sim.state.tick).toBe(0);
    expect(sim.applyDebug("p1", "step", ["3"])).toContain("3");
    expect(sim.state.tick).toBe(3);
    expect(() => sim.applyDebug("p1", "step", ["0"])).toThrow();
    sim.applyDebug("p1", "pause", []);
    expect(sim.state.paused).toBe(false);
    expect(() => sim.applyDebug("p1", "step", [])).toThrow("only while paused");
  });

  it("set speed 3 changes config; set speed -1 throws and leaves config unchanged", () => {
    const sim = newSim();
    sim.applyDebug("p1", "set", ["speed", "3"]);
    expect(sim.ctx.config.speed).toBe(3);
    expect(() => sim.applyDebug("p1", "set", ["speed", "-1"])).toThrow();
    expect(sim.ctx.config.speed).toBe(3);
    expect(() => sim.applyDebug("p1", "set", ["nope.deep", "1"])).toThrow();
  });

  it("seed makes the next rng value deterministic", () => {
    const a = newSim();
    const b = newSim();
    a.applyDebug("p1", "seed", ["123"]);
    b.applyDebug("p1", "seed", ["123"]);
    expect(a.ctx.rng.next()).toBe(b.ctx.rng.next());
    expect(() => a.applyDebug("p1", "seed", ["abc"])).toThrow();
  });

  it("timescale sets pacing only and validates its range", () => {
    const sim = newSim();
    sim.applyDebug("p1", "timescale", ["2"]);
    expect(sim.timeScale).toBe(2);
    expect(() => sim.applyDebug("p1", "timescale", ["50"])).toThrow();
  });

  it("kick removes the player", () => {
    const sim = newSim();
    expect(sim.applyDebug("p1", "kick", ["p1"])).toBe("kicked p1");
    expect(sim.hasSeat("p1")).toBe(false);
    expect(() => sim.applyDebug("p1", "kick", ["ghost"])).toThrow();
  });

  it('a game command runs; a game command named "pause" does not override the built-in', () => {
    const def = makeCounterGame({
      commands: {
        coins: (ctx, args) => {
          ctx.state.coins = Number(args[0]);
          return `coins=${ctx.state.coins}`;
        },
        pause: () => "game pause",
      },
    });
    const sim = newSim(def);
    expect(sim.applyDebug("p1", "coins", ["7"])).toBe("coins=7");
    sim.applyDebug("p1", "pause", []);
    expect(sim.state.paused).toBe(true);
    expect(() => sim.applyDebug("p1", "nope", [])).toThrow("unknown command: nope");
  });

  it("a replay containing pause, step, set and seed reproduces the live hash", () => {
    const def = makeCounterGame();
    const sim = newSim(def);
    let seq = 0;
    for (let i = 0; i < 60; i++) {
      if (i === 10) sim.applyDebug("p1", "set", ["speed", "2"]);
      if (i === 20) sim.queueInput("p1", { seq: ++seq, data: { dx: 1 } });
      if (i === 20) sim.applyDebug("p1", "pause", []);
      if (i === 25) sim.applyDebug("p1", "step", ["4"]);
      if (i === 30) sim.applyDebug("p1", "seed", ["77"]);
      if (i === 35) sim.applyDebug("p1", "pause", []);
      sim.queueInput("p1", { seq: ++seq, data: { dx: -0.5 } });
      sim.tick();
    }
    const replay = sim.snapshot();
    expect(runReplay(def, replay).stateHash).toBe(replay.final?.stateHash);
  });

  it("a replay containing a failed command still re-runs to the live hash", () => {
    const def = makeCounterGame();
    const sim = newSim(def);
    expect(() => sim.applyDebug("p1", "set", ["speed", "-1"])).toThrow();
    sim.tick();
    const replay = sim.snapshot();
    expect(runReplay(def, replay).stateHash).toBe(replay.final?.stateHash);
  });
});
