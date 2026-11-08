import { runReplay, Simulation } from "@kit/core/server";
import { SeededRandom } from "@kit/core/shared";
import { describe, expect, it } from "vitest";
import { templateGame } from "./game.ts";

describe("template replay", () => {
  it("a scripted 300-tick session with two players and pickups re-runs to the same hash", () => {
    const sim = new Simulation(templateGame, {
      seed: 11,
      roomId: "r",
      sha: "t",
      startedAt: "x",
      mode: "live",
    });
    const driver = new SeededRandom(5);
    const seq: Record<string, number> = { a: 0, b: 0 };
    sim.join("a", { name: "Ada" });
    sim.join("b", { name: "Bo" });
    sim.applyDebug("a", "spawn", []);
    for (let i = 0; i < 300; i++) {
      for (const id of ["a", "b"]) {
        sim.queueInput(id, {
          seq: ++(seq[id] as number),
          data: { dx: driver.range(-1, 1), dy: driver.range(-1, 1) },
        });
      }
      if (i === 100) sim.applyDebug("a", "tp", ["b", "10", "10"]);
      sim.tick();
    }
    const scores = [...sim.state.players.values()].map((p) => p.score);
    expect(sim.state.pickups.size).toBe(templateGame.config.pickups.count + 1);
    const replay = sim.snapshot();
    expect(runReplay(templateGame, replay).stateHash).toBe(replay.final?.stateHash);
    expect(scores.length).toBe(2);
  });

  it("players stay inside the arena and collect pickups", () => {
    const sim = new Simulation(templateGame, {
      seed: 1,
      roomId: "r",
      sha: "t",
      startedAt: "x",
      mode: "live",
    });
    sim.join("a", {});
    const pickup = [...sim.state.pickups.values()][0];
    expect(pickup).toBeDefined();
    sim.applyDebug("a", "tp", ["a", String(pickup?.x), String(pickup?.y)]);
    sim.tick();
    expect(sim.state.players.get("a")?.score).toBe(templateGame.config.pickups.points);
    for (let seq = 1; seq < 200; seq++) {
      sim.queueInput("a", { seq, data: { dx: -1, dy: -1 } });
      sim.tick();
    }
    const a = sim.state.players.get("a");
    expect(a?.x).toBe(templateGame.config.player.radius);
    expect(a?.y).toBe(templateGame.config.player.radius);
    expect(() => sim.applyDebug("a", "tp", ["ghost", "1", "1"])).toThrow();
  });
});
