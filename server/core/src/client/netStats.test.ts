import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createNetStatsMeter,
  formatServerStats,
  messageSize,
  type StatsRoomLike,
  trackRoomNetStats,
} from "./netStats.ts";

describe("createNetStatsMeter", () => {
  it("shows no ping and zero rates before anything arrives", () => {
    expect(createNetStatsMeter().read(1_000)).toEqual({
      pingMs: null,
      patchesPerSecond: 0,
      bytesPerSecond: 0,
    });
  });

  it("averages the last five pings", () => {
    const meter = createNetStatsMeter();
    for (const ms of [500, 10, 20, 30, 40, 50]) meter.recordPing(ms);
    expect(meter.read(0).pingMs).toBe(30);
  });

  it("counts patches and bytes from the last second", () => {
    const meter = createNetStatsMeter();
    meter.recordPatch(100);
    meter.recordPatch(600);
    meter.recordBytes(600, 300);
    meter.recordBytes(1_500, 200);
    expect(meter.read(1_550)).toEqual({ pingMs: null, patchesPerSecond: 1, bytesPerSecond: 500 });
  });
});

describe("messageSize", () => {
  it("measures binary and text messages", () => {
    expect(messageSize(new ArrayBuffer(12))).toBe(12);
    expect(messageSize(new Uint8Array(7))).toBe(7);
    expect(messageSize("hello")).toBe(5);
    expect(messageSize(undefined)).toBe(0);
  });
});

describe("formatServerStats", () => {
  it("shows the server's tick timing on one line", () => {
    expect(formatServerStats({ tick: 900, tickMsAvg: 1.234, tickMsP95: 4.56, lateTicks: 2 })).toBe(
      "1.2 / 4.6 ms (avg / p95), 2 late",
    );
  });
});

describe("trackRoomNetStats", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function fakeRoom() {
    const stateListeners: ((state: unknown) => void)[] = [];
    const received: unknown[] = [];
    const room = {
      pings: 0,
      ping(callback: (ms: number) => void) {
        room.pings += 1;
        callback(42);
      },
      onStateChange(callback: (state: unknown) => void) {
        stateListeners.push(callback);
      },
      connection: { events: { onmessage: (event: { data?: unknown }) => received.push(event.data) } },
    };
    return { room, stateListeners, received };
  }

  it("pings now and then every interval", () => {
    const { room } = fakeRoom();
    const stats = trackRoomNetStats(room satisfies StatsRoomLike, { pingEveryMs: 1_000, now: () => 0 });
    expect(room.pings).toBe(1);
    vi.advanceTimersByTime(3_000);
    expect(room.pings).toBe(4);
    expect(stats.read(0).pingMs).toBe(42);
    stats.stop();
    vi.advanceTimersByTime(3_000);
    expect(room.pings).toBe(4);
  });

  it("counts state patches and received bytes, and still delivers the messages", () => {
    const { room, stateListeners, received } = fakeRoom();
    let time = 0;
    const stats = trackRoomNetStats(room, { now: () => time });
    time = 100;
    for (const listener of stateListeners) listener({});
    room.connection.events.onmessage({ data: new Uint8Array(250) });
    time = 200;
    expect(stats.read(time)).toMatchObject({ patchesPerSecond: 1, bytesPerSecond: 250 });
    expect(received).toHaveLength(1);
  });

  it("puts the original message handler back when stopped", () => {
    const { room } = fakeRoom();
    const original = room.connection.events.onmessage;
    const stats = trackRoomNetStats(room);
    expect(room.connection.events.onmessage).not.toBe(original);
    stats.stop();
    expect(room.connection.events.onmessage).toBe(original);
  });
});
