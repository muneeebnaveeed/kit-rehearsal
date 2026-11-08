import { describe, expect, it } from "vitest";
import { inspectState } from "./stateInspector.ts";

describe("inspectState", () => {
  it("flattens nested state into path → value lines", () => {
    expect(inspectState({ tick: 12, players: { a: { name: "Ada", x: 10.456, alive: true } } })).toEqual({
      tick: "12",
      "players.a.name": "Ada",
      "players.a.x": "10.5",
      "players.a.alive": "true",
    });
  });

  it("summarises skipped keys and arrays by size", () => {
    expect(
      inspectState({ pickups: { p1: {}, p2: {} }, path: [1, 2, 3] }, { summarise: ["pickups"] }),
    ).toEqual({
      pickups: "2 entries",
      "path.0": "1",
      "path.1": "2",
      "path.2": "3",
    });
  });

  it("stops after the maximum number of lines", () => {
    const state = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, i]));
    const lines = inspectState(state, { maxLines: 3 });
    expect(Object.keys(lines)).toEqual(["k0", "k1", "k2", "…"]);
    expect(lines["…"]).toBe("7 more");
  });

  it("shows empty and missing values", () => {
    expect(inspectState({ code: "", seat: null, list: [] })).toEqual({
      code: '""',
      seat: "null",
      list: "0 entries",
    });
  });
});
