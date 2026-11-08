/**
 * Network numbers for the ~ debug overlay: ping, state patches per second and bytes received per
 * second, so a laggy playtest can be diagnosed in the browser (is it the network or the server?).
 * Works with any room that looks like a Colyseus room (see StatsRoomLike); no Colyseus import here.
 */
import type { DebugStats as ServerTickStats } from "../shared/messages.ts";
import { addSample, ratePerSecond, type WeightedSample } from "./rate.ts";

const PINGS_AVERAGED = 5;
const DEFAULT_PING_EVERY_MS = 2_000;

export interface NetStats {
  /** Average of the last few round trips; null before the first one. */
  readonly pingMs: number | null;
  readonly patchesPerSecond: number;
  readonly bytesPerSecond: number;
}

export interface NetStatsMeter {
  recordPing(ms: number): void;
  recordPatch(now: number): void;
  recordBytes(now: number, bytes: number): void;
  read(now: number): NetStats;
}

export function createNetStatsMeter(): NetStatsMeter {
  let pings: readonly number[] = [];
  let patches: number[] = [];
  let bytes: WeightedSample[] = [];
  return {
    recordPing(ms) {
      pings = [...pings, ms].slice(-PINGS_AVERAGED);
    },
    recordPatch(now) {
      patches = addSample(patches, now);
    },
    recordBytes(now, amount) {
      bytes = addSample(bytes, now, amount);
    },
    read(now) {
      return {
        pingMs: pings.length === 0 ? null : pings.reduce((sum, ms) => sum + ms, 0) / pings.length,
        patchesPerSecond: ratePerSecond(patches, now),
        bytesPerSecond: ratePerSecond(bytes, now),
      };
    },
  };
}

/** Size in bytes of a WebSocket message's data (binary, or text as an estimate). */
export function messageSize(data: unknown): number {
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  if (typeof data === "string") return data.length;
  if (typeof Blob !== "undefined" && data instanceof Blob) return data.size;
  return 0;
}

/** The server's tick timing from the `debug:stats` message, as one overlay line. */
export function formatServerStats(stats: ServerTickStats): string {
  return `${stats.tickMsAvg.toFixed(1)} / ${stats.tickMsP95.toFixed(1)} ms (avg / p95), ${stats.lateTicks} late`;
}

type MessageHandler = ((event: { data?: unknown }) => unknown) | null | undefined;

/** What trackRoomNetStats needs from a room. A Colyseus `Room` from `@colyseus/sdk` fits. */
export interface StatsRoomLike {
  ping(callback: (ms: number) => void): void;
  onStateChange(callback: (state: unknown) => void): unknown;
  readonly connection?: { readonly events: { onmessage?: MessageHandler } };
}

export interface RoomNetStats {
  read(now?: number): NetStats;
  stop(): void;
}

export interface TrackOptions {
  readonly pingEveryMs?: number;
  readonly now?: () => number;
}

/**
 * Measures a room's network numbers: pings it every few seconds, counts state patches, and counts
 * the bytes of every message the connection receives. Call `stop()` when leaving the room.
 */
export function trackRoomNetStats(room: StatsRoomLike, options: TrackOptions = {}): RoomNetStats {
  const now = options.now ?? (() => performance.now());
  const meter = createNetStatsMeter();
  let isStopped = false;

  const ping = (): void => room.ping((ms) => meter.recordPing(ms));
  ping();
  const timer = setInterval(ping, options.pingEveryMs ?? DEFAULT_PING_EVERY_MS);

  room.onStateChange(() => {
    if (!isStopped) meter.recordPatch(now());
  });

  // Count bytes by wrapping the connection's message handler; the message is still delivered.
  const events = room.connection?.events;
  const original = events?.onmessage;
  const counting: MessageHandler = (event) => {
    if (!isStopped) meter.recordBytes(now(), messageSize(event?.data));
    return original?.call(events, event);
  };
  if (events) events.onmessage = counting;

  return {
    read(at = now()) {
      return meter.read(at);
    },
    stop() {
      isStopped = true;
      clearInterval(timer);
      if (events && events.onmessage === counting) events.onmessage = original;
    },
  };
}
