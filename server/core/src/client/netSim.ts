/**
 * Network simulation: delays and drops messages to show how a game feels on a bad connection.
 * Use one simulator per direction. Instead of sending (or handling) a message right away, `send` it
 * to the simulator, and each frame pass whatever `drain(now)` returns on to the real handler.
 * Times are whatever clock the caller uses (usually performance.now()); nothing here reads a clock.
 */
import type { NetConditions } from "../shared/messages.ts";

export type { NetConditions } from "../shared/messages.ts";

export const NO_NET_CONDITIONS: NetConditions = { latencyMs: 0, jitterMs: 0, lossPct: 0 };

const MAX_LOSS_PCT = 100;

export interface NetSimulator<T> {
  readonly conditions: NetConditions;
  /** Messages waiting to be delivered. */
  readonly pending: number;
  setConditions(conditions: NetConditions): void;
  /** Queues a message (or drops it, at the loss rate). */
  send(message: T, now: number): void;
  /** Returns the messages due by `now`, oldest first, and removes them from the queue. */
  drain(now: number): T[];
}

interface Queued<T> {
  readonly message: T;
  readonly deliverAt: number;
}

/** `random` is injectable for tests; network noise is not game simulation, so Math.random is fine. */
export function createNetSimulator<T>(
  initial: NetConditions,
  random: () => number = Math.random,
): NetSimulator<T> {
  let conditions = initial;
  let queue: readonly Queued<T>[] = [];

  return {
    get conditions() {
      return conditions;
    },
    get pending() {
      return queue.length;
    },
    setConditions(next) {
      conditions = next;
    },
    send(message, now) {
      const lossRoll = random() * MAX_LOSS_PCT;
      const jitter = (random() * 2 - 1) * conditions.jitterMs;
      if (lossRoll < conditions.lossPct) return;
      // A WebSocket never reorders messages, so a message is never delivered before the one ahead of it.
      const previous = queue.at(-1)?.deliverAt ?? Number.NEGATIVE_INFINITY;
      const deliverAt = Math.max(now + Math.max(0, conditions.latencyMs + jitter), previous);
      queue = [...queue, { message, deliverAt }];
    },
    drain(now) {
      const dueCount = queue.findIndex((item) => item.deliverAt > now);
      const split = dueCount === -1 ? queue.length : dueCount;
      const due = queue.slice(0, split).map((item) => item.message);
      queue = queue.slice(split);
      return due;
    },
  };
}

/** Reads `?lag=`, `?jitter=` and `?loss=` (milliseconds, milliseconds, percent). Null when none is set. */
export function readNetConditions(search: string): NetConditions | null {
  const params = new URLSearchParams(search);
  if (!["lag", "jitter", "loss"].some((key) => params.has(key))) return null;
  return {
    latencyMs: nonNegative(params.get("lag")),
    jitterMs: nonNegative(params.get("jitter")),
    lossPct: Math.min(nonNegative(params.get("loss")), MAX_LOSS_PCT),
  };
}

function nonNegative(raw: string | null): number {
  const value = Number(raw ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}
