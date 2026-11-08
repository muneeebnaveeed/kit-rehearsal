/**
 * Seeded pseudo-random generator (mulberry32). Every room owns one; game code must use it
 * instead of Math.random() so replays reproduce exactly.
 */
export class SeededRandom {
  #state: number;

  constructor(seed: number) {
    this.#state = seed >>> 0;
  }

  /** Current internal state, for saving into a snapshot. */
  get state(): number {
    return this.#state;
  }

  /** Float in [0, 1). */
  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let t = this.#state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("SeededRandom.pick: empty array");
    return items[this.int(0, items.length - 1)] as T;
  }
}

/** A fresh random seed for a new room. Only the seed itself may come from Math.random(). */
export function newSeed(): number {
  return Math.floor(Math.random() * 2 ** 31); // determinism-ok: the seed is chosen once, before the simulation starts
}
