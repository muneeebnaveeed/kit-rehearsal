/**
 * In-memory replay and bug-report stores sharing one byte budget. Everything here is lost on deploy;
 * download a replay to keep it.
 */
import { randomUUID } from "node:crypto";
import type { BugReport, Replay } from "@kit/core/shared";

export interface StoredBugReport {
  id: string;
  receivedAt: string;
  report: BugReport;
  /** The room's replay at the moment the report was sent, so it outlives replay eviction. */
  replay: Replay | null;
}

interface Entry<T> {
  value: T;
  bytes: number;
  storedAt: number;
}

export interface MemoryStoresOptions {
  budgetBytes: number;
  replayMaxAgeMs?: number;
  replayMaxCount?: number;
  now?: () => number;
}

const sizeOf = (value: unknown): number => Buffer.byteLength(JSON.stringify(value));

export class MemoryStores {
  readonly #budget: number;
  readonly #maxAge: number;
  readonly #maxCount: number;
  readonly #now: () => number;
  // Maps keep insertion order, so the first key is always the oldest.
  readonly #replays = new Map<string, Entry<Replay>>();
  readonly #reports = new Map<string, Entry<StoredBugReport>>();
  #bytes = 0;

  constructor(opts: MemoryStoresOptions) {
    this.#budget = opts.budgetBytes;
    this.#maxAge = opts.replayMaxAgeMs ?? 3_600_000;
    this.#maxCount = opts.replayMaxCount ?? 50;
    this.#now = opts.now ?? Date.now;
  }

  /** Stores a finished room's replay. */
  putReplay(roomId: string, replay: Replay): void {
    this.#delete(this.#replays, roomId);
    this.#insert(this.#replays, roomId, replay);
    this.#evict();
  }

  getReplay(roomId: string): Replay | undefined {
    this.#evict();
    return this.#replays.get(roomId)?.value;
  }

  /** Stores a report and returns its random id. */
  putBugReport(report: BugReport, replay: Replay | null): string {
    const id = randomUUID();
    this.#insert(this.#reports, id, { id, receivedAt: new Date(this.#now()).toISOString(), report, replay });
    this.#evict();
    return id;
  }

  getBugReport(id: string): StoredBugReport | undefined {
    return this.#reports.get(id)?.value;
  }

  stats(): { replaysStored: number; bugReportsStored: number; bytesUsed: number } {
    return {
      replaysStored: this.#replays.size,
      bugReportsStored: this.#reports.size,
      bytesUsed: this.#bytes,
    };
  }

  #insert<T>(map: Map<string, Entry<T>>, key: string, value: T): void {
    const bytes = sizeOf(value);
    map.set(key, { value, bytes, storedAt: this.#now() });
    this.#bytes += bytes;
  }

  #delete<T>(map: Map<string, Entry<T>>, key: string): void {
    const entry = map.get(key);
    if (!entry) return;
    map.delete(key);
    this.#bytes -= entry.bytes;
  }

  #oldestKey<T>(map: Map<string, Entry<T>>): string | undefined {
    return map.keys().next().value;
  }

  #evict(): void {
    const now = this.#now();
    for (const [key, entry] of this.#replays) {
      if (now - entry.storedAt <= this.#maxAge && this.#replays.size <= this.#maxCount) break;
      this.#delete(this.#replays, key);
    }
    while (this.#bytes > this.#budget) {
      const key = this.#oldestKey(this.#replays);
      if (key !== undefined) {
        this.#delete(this.#replays, key);
        continue;
      }
      const reportKey = this.#oldestKey(this.#reports);
      if (reportKey === undefined) break;
      this.#delete(this.#reports, reportKey);
    }
  }
}
