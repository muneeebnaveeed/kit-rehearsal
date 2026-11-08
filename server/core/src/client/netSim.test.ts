import { describe, expect, it } from "vitest";
import { createNetSimulator, readNetConditions } from "./netSim.ts";

/** A random source that returns the given values in order, then repeats the last one. */
function sequence(...values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? 0;
}

describe("createNetSimulator", () => {
  it("delivers right away when there is no simulated lag", () => {
    const sim = createNetSimulator<string>({ latencyMs: 0, jitterMs: 0, lossPct: 0 });
    sim.send("hello", 1_000);
    expect(sim.drain(1_000)).toEqual(["hello"]);
  });

  it("holds messages back for the latency", () => {
    const sim = createNetSimulator<string>({ latencyMs: 100, jitterMs: 0, lossPct: 0 });
    sim.send("a", 0);
    expect(sim.drain(99)).toEqual([]);
    expect(sim.pending).toBe(1);
    expect(sim.drain(100)).toEqual(["a"]);
    expect(sim.pending).toBe(0);
  });

  it("drops messages at the loss rate", () => {
    const sim = createNetSimulator<string>(
      { latencyMs: 0, jitterMs: 0, lossPct: 50 },
      sequence(0.2, 0.5, 0.7, 0.5),
    );
    sim.send("lost", 0); // loss roll 0.2 → 20 < 50, dropped
    sim.send("kept", 0); // loss roll 0.7 → 70, delivered (0.5 is its jitter roll)
    expect(sim.drain(0)).toEqual(["kept"]);
  });

  it("keeps messages in order even when jitter would reorder them", () => {
    // Jitter rolls: first message +50 ms, second -50 ms. A WebSocket never reorders, so neither do we.
    const sim = createNetSimulator<string>(
      { latencyMs: 100, jitterMs: 50, lossPct: 0 },
      sequence(0.5, 1, 0.5, 0),
    );
    sim.send("first", 0);
    sim.send("second", 10);
    expect(sim.drain(149)).toEqual([]);
    expect(sim.drain(150)).toEqual(["first", "second"]);
  });

  it("can change conditions while running", () => {
    const sim = createNetSimulator<string>({ latencyMs: 100, jitterMs: 0, lossPct: 0 });
    sim.setConditions({ latencyMs: 0, jitterMs: 0, lossPct: 0 });
    sim.send("now", 5);
    expect(sim.drain(5)).toEqual(["now"]);
    expect(sim.conditions.latencyMs).toBe(0);
  });
});

describe("readNetConditions", () => {
  it("is null when no lag parameter is set", () => {
    expect(readNetConditions("?room=QXTR")).toBeNull();
  });

  it("reads lag, jitter and loss", () => {
    expect(readNetConditions("?lag=150&jitter=30&loss=5")).toEqual({
      latencyMs: 150,
      jitterMs: 30,
      lossPct: 5,
    });
  });

  it("fills missing values with zero and clamps bad ones", () => {
    expect(readNetConditions("?lag=200")).toEqual({ latencyMs: 200, jitterMs: 0, lossPct: 0 });
    expect(readNetConditions("?loss=250&lag=-5&jitter=abc")).toEqual({
      latencyMs: 0,
      jitterMs: 0,
      lossPct: 100,
    });
  });
});
