import { z } from "zod";
import { GUEST_FINGERPRINT_PATTERN } from "./guest.ts";

/**
 * Replay format: everything needed to re-run a room and get the same result.
 * The server records it; `qa:replay` and `/repro` read it.
 *
 * Determinism rules that make replays work:
 * - Game code uses the room's SeededRandom, never Math.random().
 * - The simulation advances only in fixed ticks; inputs are applied on the tick they're recorded for.
 * - Drops and reconnects are recorded, so a game may read seat state inside the simulation.
 * - The full checked config is embedded; a replay runs against that config, not the current one.
 */
export const REPLAY_VERSION = 2;

const tick = z.number().int().nonnegative();
const playerId = z.string().min(1);

export const ReplayEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("join"),
    tick,
    playerId,
    options: z.record(z.string(), z.unknown()).default({}),
    /**
     * The player's guest fingerprint (12 hex characters), or "" without a guest ID. Never the raw
     * guest ID. Missing in replays recorded before guests existed, which read as "".
     */
    guest: z.string().regex(GUEST_FINGERPRINT_PATTERN).default(""),
  }),
  z.object({ type: z.literal("leave"), tick, playerId }),
  /** The connection dropped unexpectedly; the seat is held for `reconnectSeconds`. */
  z.object({ type: z.literal("drop"), tick, playerId }),
  /** The player came back into their held seat. */
  z.object({ type: z.literal("reconnect"), tick, playerId }),
  z.object({
    type: z.literal("input"),
    tick,
    playerId,
    seq: z.number().int().nonnegative(),
    data: z.unknown(),
  }),
  z.object({
    type: z.literal("debug"),
    tick,
    playerId,
    command: z.string(),
    args: z.array(z.string()),
  }),
]);
export type ReplayEvent = z.infer<typeof ReplayEventSchema>;

export const ReplaySchema = z.object({
  version: z.literal(REPLAY_VERSION),
  game: z.string(),
  roomId: z.string(),
  seed: z.number().int(),
  tickRate: z.number().positive(),
  configVersion: z.string(),
  /** The full checked config the room started with. The replay runner uses this, not the current file. */
  config: z.record(z.string(), z.unknown()),
  sha: z.string(),
  scenario: z.string().nullable(),
  startedAt: z.string(),
  /** Events in the order they were applied. */
  events: z.array(ReplayEventSchema),
  /** Room code players joined with; part of the state, so the replay restores it. */
  code: z.string().default(""),
  /** Set when game code threw; the replay runner re-throws at the same point. `final` is null then. */
  failure: z.object({ tick, hook: z.string(), message: z.string() }).nullable().default(null),
  /** True when recording stopped at the event cap; a truncated replay can't be re-run to its hash. */
  truncated: z.boolean().default(false),
  /** Tick and state hash when the replay was saved, so a re-run can assert it matches. */
  final: z.object({ tick, stateHash: z.string() }).nullable(),
});
export type Replay = z.infer<typeof ReplaySchema>;
