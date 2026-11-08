import { describe, expect, it } from "vitest";
import { RoomStats } from "./stats.ts";

describe("RoomStats", () => {
  it("RoomStats p95 of 1..100 is 95; flush resets counters", () => {
    const stats = new RoomStats();
    expect(stats.latest()).toBeNull();
    for (let ms = 1; ms <= 100; ms++) stats.recordTick(ms, ms > 98);
    stats.recordInput("ok");
    stats.recordInput("schema");
    stats.recordInput("schema");
    stats.recordPatch(120);
    stats.recordReconnect();
    const snap = stats.flush();
    expect(snap).toMatchObject({
      ticks: 100,
      tickMsAvg: 50.5,
      tickMsP95: 95,
      tickMsMax: 100,
      lateTicks: 2,
      inputs: 3,
      patches: 1,
      bytesOut: 120,
      reconnects: 1,
    });
    expect(snap.inputsRejected).toEqual({ schema: 2 });
    expect(stats.latest()).toEqual(snap);
    expect(stats.flush()).toMatchObject({
      ticks: 0,
      tickMsAvg: 0,
      tickMsP95: 0,
      inputs: 0,
      inputsRejected: {},
    });
  });
});
