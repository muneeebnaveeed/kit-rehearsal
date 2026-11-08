/** Process-level stats for `process.stats` logs and `/api/stats`. */
import { type IntervalHistogram, monitorEventLoopDelay } from "node:perf_hooks";
import type { LiveRoomRegistry } from "./gameRoom.ts";
import type { MemoryStores } from "./stores.ts";

export interface ProcessStatsSnapshot {
  rooms: number;
  players: number;
  eventLoopLagMs: number;
  heapMb: number;
  replaysStored: number;
  bugReportsStored: number;
  bytesUsed: number;
}

export class ProcessStats {
  readonly #histogram: IntervalHistogram = monitorEventLoopDelay({ resolution: 20 });

  constructor(
    private readonly registry: LiveRoomRegistry,
    private readonly stores: MemoryStores,
  ) {
    this.#histogram.enable();
  }

  /** Current numbers; event-loop lag is the p95 since the last `reset`. */
  snapshot(): ProcessStatsSnapshot {
    const rooms = this.registry.all();
    return {
      rooms: rooms.length,
      players: rooms.reduce((sum, room) => sum + room.players(), 0),
      eventLoopLagMs: Math.round((this.#histogram.percentile(95) / 1e6) * 100) / 100,
      heapMb: Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10,
      ...this.stores.stats(),
    };
  }

  reset(): void {
    this.#histogram.reset();
  }

  stop(): void {
    this.#histogram.disable();
  }
}
