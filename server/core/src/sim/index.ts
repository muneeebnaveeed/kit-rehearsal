/**
 * The simulation contract every game implements: base state, room settings and the game definition.
 * Browser-safe. Never import colyseus, node built-ins or @kit/core/server here: the client
 * imports this to run `step` for prediction.
 * Owner: platform team.
 */
import { type SchemaType, schema, t } from "@colyseus/schema";
import { z } from "zod";
import type { SeededRandom } from "../shared/random.ts";

/** One player's seat, keyed by sessionId in `BaseState.seats`. Written only by the room base. */
export const Seat = schema(
  {
    connected: t.boolean().default(true),
    /** Last input seq applied for this seat; the client reconciles predictions against it. */
    lastSeq: t.uint32().default(0),
    /**
     * The player's guest fingerprint: 12 hex characters, the same for every tab and reload of one
     * browser in this game (another game gets a different one), or "" when the client sent no valid
     * guest ID. Public; never the raw guest ID. A hint, not authentication (see `JoinInfo.guest`).
     */
    guest: t.string().default(""),
  },
  "Seat",
);
export type Seat = SchemaType<typeof Seat>;

/** Fields the room base owns. Every game's state extends it: `BaseState.extend({...}, "MyState")`. */
export const BaseState = schema(
  {
    tick: t.uint32().default(0),
    /** Room code players type to join, e.g. "QXTR". Empty for quick-match rooms. */
    code: t.string().default(""),
    paused: t.boolean().default(false),
    seats: t.map(Seat),
  },
  "BaseState",
);
export type BaseState = SchemaType<typeof BaseState>;

/** Room settings every game's config must include. Game config schemas extend this. */
export const RoomSettingsSchema = z.object({
  /** Config version, recorded in replays. */
  version: z.string(),
  /** Simulation ticks per second. */
  tickRate: z.number().int().min(10).max(120),
  /** State patches sent to clients per second. */
  patchRate: z.number().int().min(1).max(60),
  maxPlayers: z.number().int().min(1).max(64),
  /** How long a dropped player's seat is held. */
  reconnectSeconds: z.number().int().min(0).max(300),
});
export type RoomSettings = z.infer<typeof RoomSettingsSchema>;

/** Everything a game's simulation code may read. No clocks, no Math.random(). */
export interface SimContext<S, C> {
  state: S;
  rng: SeededRandom;
  config: C;
  tick: number;
  /** Seconds per tick: 1 / config.tickRate. */
  dt: number;
}

export interface TickInput<I> {
  playerId: string;
  seq: number;
  data: I;
}

/** What the room base knows about a joining player, besides the game's own join options. */
export interface JoinInfo {
  /**
   * Guest fingerprint (see `Seat.guest`): the same value for the same browser across tabs, reloads and
   * expired seats in this game, or "" when the client sent none. Use it as a hint to recognise a
   * returning player, not as authentication: other games on the same origin can read the stored ID
   * and a client can send a fresh one to avoid being recognised, so never use it to hand over a seat,
   * score or ownership. One guest can hold several seats at once (two tabs).
   */
  readonly guest: string;
}

/** Returns output text for the debug console. Throw an Error to report a failure. */
export type DebugCommandHandler<S, C> = (ctx: SimContext<S, C>, args: string[]) => string;

/** A game: pure, deterministic and browser-safe. `createGameRoom()` turns it into a Colyseus room. */
export interface GameDefinition<S extends BaseState, I, C extends RoomSettings> {
  /** Game id, e.g. "template". Recorded in replays. */
  id: string;
  createState(): S;
  inputSchema: z.ZodType<I>;
  joinOptionsSchema: z.ZodType<Record<string, unknown>>;
  config: C;
  /** Used by the `set` debug command to check a changed config. */
  configSchema: z.ZodType<C>;
  init(ctx: SimContext<S, C>): void;
  /**
   * A player took a seat. `options` passed `joinOptionsSchema` (the base removes `guestId` first, so
   * don't declare it). `info.guest` is the guest fingerprint, also on `ctx.state.seats.get(playerId)`.
   */
  join(ctx: SimContext<S, C>, playerId: string, options: Record<string, unknown>, info: JoinInfo): void;
  leave(ctx: SimContext<S, C>, playerId: string): void;
  /** Advance one tick. `inputs` are in arrival order. Mutate `ctx.state` in place. */
  step(ctx: SimContext<S, C>, inputs: TickInput<I>[]): void;
  disconnect?(ctx: SimContext<S, C>, playerId: string): void;
  reconnect?(ctx: SimContext<S, C>, playerId: string): void;
  /** Game-specific debug commands, e.g. spawn, tp. Can't override built-ins. */
  commands?: Record<string, DebugCommandHandler<S, C>>;
}
