import type { BugReport, Replay } from "@kit/core/shared";
import { describe, expect, it } from "vitest";
import { MemoryStores } from "./stores.ts";

const replay = (roomId: string, pad = 0): Replay => ({
  version: 2,
  game: "g",
  roomId,
  seed: 1,
  tickRate: 30,
  configVersion: "1",
  config: { pad: "x".repeat(pad) },
  sha: "s",
  scenario: null,
  startedAt: "t",
  events: [],
  code: "",
  failure: null,
  truncated: false,
  final: null,
});

const report = (pad = 0): BugReport => ({
  title: "t",
  description: "x".repeat(pad),
  game: "g",
  env: "local",
  sha: "s",
  roomId: null,
  playerId: null,
  tick: null,
  scenario: null,
  url: "u",
  userAgent: "a",
  net: null,
  logs: [],
  screenshot: null,
});

describe("MemoryStores", () => {
  it("stores evict replays older than 1h and beyond 50", () => {
    let now = 0;
    const stores = new MemoryStores({ budgetBytes: 10_000_000, now: () => now });
    stores.putReplay("old", replay("old"));
    now = 3_600_001;
    stores.putReplay("new", replay("new"));
    expect(stores.getReplay("old")).toBeUndefined();
    expect(stores.getReplay("new")).toBeDefined();
    for (let i = 0; i < 55; i++) stores.putReplay(`r${i}`, replay(`r${i}`));
    expect(stores.stats().replaysStored).toBe(50);
    expect(stores.getReplay("r4")).toBeUndefined();
    expect(stores.getReplay("r5")).toBeDefined();
  });

  it("stores evict oldest replays before bug reports when over budget", () => {
    const stores = new MemoryStores({ budgetBytes: 30_000 });
    const id = stores.putBugReport(report(9_000), null);
    stores.putReplay("a", replay("a", 9_000));
    stores.putReplay("b", replay("b", 9_000));
    stores.putReplay("c", replay("c", 9_000));
    expect(stores.getReplay("a")).toBeUndefined();
    expect(stores.getReplay("c")).toBeDefined();
    expect(stores.getBugReport(id)).toBeDefined();
    expect(stores.stats().bytesUsed).toBeLessThanOrEqual(30_000);
    stores.putBugReport(report(25_000), null);
    expect(stores.stats().replaysStored).toBe(0);
    expect(stores.getBugReport(id)).toBeUndefined();
  });

  it("bug report ids are UUIDs and unknown ids return undefined", () => {
    const stores = new MemoryStores({ budgetBytes: 1_000_000 });
    const id = stores.putBugReport(report(), replay("r"));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(stores.getBugReport(id)?.replay?.roomId).toBe("r");
    expect(stores.getBugReport("nope")).toBeUndefined();
  });
});
