/** Per-room counters for one stats interval. Wall-clock timing is measured by the room, around ticks. */
import type { InputResult } from "./simulation.ts";

export type RejectReason = Exclude<InputResult, "ok">;

export interface RoomStatsSnapshot {
  ticks: number;
  tickMsAvg: number;
  tickMsP95: number;
  tickMsMax: number;
  lateTicks: number;
  inputs: number;
  inputsRejected: Partial<Record<RejectReason, number>>;
  patches: number;
  bytesOut: number;
  reconnects: number;
}

export class RoomStats {
  #tickMs: number[] = [];
  #lateTicks = 0;
  #inputs = 0;
  #rejected: Partial<Record<RejectReason, number>> = {};
  #patches = 0;
  #bytesOut = 0;
  #reconnects = 0;
  #latest: RoomStatsSnapshot | null = null;

  recordTick(ms: number, late: boolean): void {
    this.#tickMs.push(ms);
    if (late) this.#lateTicks++;
  }

  recordInput(result: InputResult): void {
    this.#inputs++;
    if (result !== "ok") this.#rejected[result] = (this.#rejected[result] ?? 0) + 1;
  }

  recordPatch(bytes: number): void {
    this.#patches++;
    this.#bytesOut += bytes;
  }

  recordReconnect(): void {
    this.#reconnects++;
  }

  /** The counters since the last flush; resets them. */
  flush(): RoomStatsSnapshot {
    const sorted = [...this.#tickMs].sort((a, b) => a - b);
    const n = sorted.length;
    const snapshot: RoomStatsSnapshot = {
      ticks: n,
      tickMsAvg: n === 0 ? 0 : sorted.reduce((sum, ms) => sum + ms, 0) / n,
      tickMsP95: n === 0 ? 0 : (sorted[Math.ceil(0.95 * n) - 1] ?? 0),
      tickMsMax: n === 0 ? 0 : (sorted[n - 1] ?? 0),
      lateTicks: this.#lateTicks,
      inputs: this.#inputs,
      inputsRejected: this.#rejected,
      patches: this.#patches,
      bytesOut: this.#bytesOut,
      reconnects: this.#reconnects,
    };
    this.#tickMs = [];
    this.#lateTicks = 0;
    this.#inputs = 0;
    this.#rejected = {};
    this.#patches = 0;
    this.#bytesOut = 0;
    this.#reconnects = 0;
    this.#latest = snapshot;
    return snapshot;
  }

  /** The last flushed snapshot, or null before the first flush. */
  latest(): RoomStatsSnapshot | null {
    return this.#latest;
  }
}
