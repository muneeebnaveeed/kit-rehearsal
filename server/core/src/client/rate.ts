/**
 * Per-second counters over a sliding one-second window: frames, state patches, bytes.
 * Pure helpers: they return a new sample list instead of changing the old one.
 */

export const RATE_WINDOW_MS = 1_000;

/** A sample that counts as more than one, e.g. a patch of 300 bytes. */
export interface WeightedSample {
  readonly time: number;
  readonly amount: number;
}
export type RateSample = number | WeightedSample;

const timeOf = (sample: RateSample): number => (typeof sample === "number" ? sample : sample.time);
const amountOf = (sample: RateSample): number => (typeof sample === "number" ? 1 : sample.amount);

/** Adds a sample at `now` and drops the ones older than the window. */
export function addSample(samples: readonly number[], now: number): number[];
export function addSample(samples: readonly WeightedSample[], now: number, amount: number): WeightedSample[];
export function addSample(samples: readonly RateSample[], now: number, amount?: number): RateSample[] {
  const recent = samples.filter((sample) => now - timeOf(sample) < RATE_WINDOW_MS);
  return [...recent, amount === undefined ? now : { time: now, amount }];
}

/** Sum of the samples in the last second (a count, or the total amount for weighted samples). */
export function ratePerSecond(samples: readonly RateSample[], now: number): number {
  const total = samples
    .filter((sample) => now - timeOf(sample) < RATE_WINDOW_MS)
    .reduce<number>((sum, sample) => sum + amountOf(sample), 0);
  return total * (1_000 / RATE_WINDOW_MS);
}

export interface FrameStats {
  readonly fps: number;
  readonly frameMs: number;
}

export interface FrameMeter {
  /** Call once per rendered frame with the requestAnimationFrame timestamp. */
  frame(now: number): FrameStats;
}

export function createFrameMeter(startTime: number): FrameMeter {
  let lastFrameAt = startTime;
  let frameTimes: number[] = [];
  return {
    frame(now) {
      const frameMs = now - lastFrameAt;
      lastFrameAt = now;
      frameTimes = addSample(frameTimes, now);
      return { fps: ratePerSecond(frameTimes, now), frameMs };
    },
  };
}
