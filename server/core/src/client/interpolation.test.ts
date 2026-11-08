import { describe, expect, it } from "vitest";
import { createInterpolationBuffer, lerpPoint, type Point } from "./interpolation.ts";

const at = (entries: [string, Point][]): ReadonlyMap<string, Point> => new Map(entries);

function bufferWithTwoSnapshots() {
  const buffer = createInterpolationBuffer<Point>({ delayMs: 100, lerp: lerpPoint });
  buffer.push(1_000, at([["a", { x: 0, y: 0 }]]));
  buffer.push(1_100, at([["a", { x: 10, y: 20 }]]));
  return buffer;
}

describe("createInterpolationBuffer", () => {
  it("is empty before any snapshot arrives", () => {
    const buffer = createInterpolationBuffer<Point>({ delayMs: 100, lerp: lerpPoint });
    expect(buffer.sample(5_000).size).toBe(0);
  });

  it("shows the state from delayMs ago, between two snapshots", () => {
    // now 1_150 → render time 1_050, halfway between the snapshots at 1_000 and 1_100.
    expect(bufferWithTwoSnapshots().sample(1_150).get("a")).toEqual({ x: 5, y: 10 });
  });

  it("holds the first snapshot when the render time is before it", () => {
    expect(bufferWithTwoSnapshots().sample(1_000).get("a")).toEqual({ x: 0, y: 0 });
  });

  it("holds the newest snapshot instead of guessing ahead", () => {
    expect(bufferWithTwoSnapshots().sample(9_999).get("a")).toEqual({ x: 10, y: 20 });
  });

  it("shows entities that joined and drops ones that left", () => {
    const buffer = createInterpolationBuffer<Point>({ delayMs: 0, lerp: lerpPoint });
    buffer.push(0, at([["left", { x: 1, y: 1 }]]));
    buffer.push(100, at([["joined", { x: 7, y: 7 }]]));
    const sample = buffer.sample(50);
    expect(sample.has("left")).toBe(false);
    expect(sample.get("joined")).toEqual({ x: 7, y: 7 });
  });

  it("keeps only the most recent snapshots", () => {
    const buffer = createInterpolationBuffer<Point>({ delayMs: 0, lerp: lerpPoint, maxSnapshots: 3 });
    for (let t = 0; t < 10; t++) buffer.push(t * 100, at([["a", { x: t, y: 0 }]]));
    expect(buffer.size).toBe(3);
    expect(buffer.sample(0).get("a")).toEqual({ x: 7, y: 0 });
  });

  it("ignores a snapshot older than the newest one", () => {
    const buffer = bufferWithTwoSnapshots();
    buffer.push(1_050, at([["a", { x: 999, y: 999 }]]));
    expect(buffer.size).toBe(2);
  });
});
