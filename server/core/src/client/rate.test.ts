import { describe, expect, it } from "vitest";
import { addSample, createFrameMeter, ratePerSecond } from "./rate.ts";

describe("rate counter", () => {
  it("counts samples from the last second", () => {
    let samples: number[] = [];
    for (let t = 0; t < 1_000; t += 100) samples = addSample(samples, t);
    expect(ratePerSecond(samples, 999)).toBe(10);
  });

  it("sums weighted samples, e.g. bytes per second", () => {
    let samples: { time: number; amount: number }[] = [];
    samples = addSample(samples, 0, 300);
    samples = addSample(samples, 500, 200);
    expect(ratePerSecond(samples, 900)).toBe(500);
  });

  it("drops samples older than the window", () => {
    expect(addSample([0, 100, 200], 1_500)).toEqual([1_500]);
  });

  it("does not change the list it was given", () => {
    const samples = [0, 100];
    addSample(samples, 200);
    expect(samples).toEqual([0, 100]);
  });
});

describe("createFrameMeter", () => {
  it("reports frame time and frames per second", () => {
    const meter = createFrameMeter(0);
    let stats = { fps: 0, frameMs: 0 };
    for (let t = 16; t <= 1_000; t += 16) stats = meter.frame(t);
    expect(stats.frameMs).toBe(16);
    expect(stats.fps).toBeGreaterThanOrEqual(60);
    expect(stats.fps).toBeLessThanOrEqual(63);
  });
});
