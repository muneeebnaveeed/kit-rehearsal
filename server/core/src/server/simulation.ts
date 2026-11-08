/**
 * The deterministic core every room runs. It applies events (join, leave, drop, reconnect, input,
 * debug) to a game definition and records them, so the live room and the replay runner share one
 * code path and can't drift apart.
 * No clocks and no Colyseus here: the room measures timing around `tick()`.
 */
import {
  GUEST_FINGERPRINT_PATTERN,
  InputEnvelopeSchema,
  REPLAY_VERSION,
  type Replay,
  type ReplayEvent,
  SeededRandom,
} from "@kit/core/shared";
import {
  type BaseState,
  type GameDefinition,
  type RoomSettings,
  Seat,
  type SimContext,
  type TickInput,
} from "../sim/index.ts";
import { runDebugCommand } from "./debugCommands.ts";
import { withoutGuestId } from "./guest.ts";
import { stateHash } from "./stateHash.ts";

export const DEFAULT_MAX_EVENTS = 1_000_000;

/** An exception thrown by the game's own code (a definition hook), as opposed to bad client input. */
export class GameCodeError extends Error {
  constructor(
    readonly hook: string,
    readonly tick: number,
    readonly original: unknown,
  ) {
    super(
      `${hook} threw at tick ${tick}: ${original instanceof Error ? original.message : String(original)}`,
    );
    this.name = "GameCodeError";
  }
}

export interface SimFailure {
  tick: number;
  hook: string;
  message: string;
}

export type InputResult = "ok" | "envelope" | "schema" | "stale-seq" | "paused" | "unknown-player";
export type SimMode = "live" | "replay";

export interface SimulationOptions<C> {
  seed: number;
  roomId: string;
  sha: string;
  startedAt: string;
  mode: SimMode;
  scenario?: string | null;
  /** Room code; stored in `state.code` before `init`, and in the replay. */
  code?: string;
  /** Overrides the definition's config; the replay runner passes the replay's embedded config. */
  config?: C;
  maxEvents?: number;
}

export class Simulation<S extends BaseState, I, C extends RoomSettings> {
  readonly def: GameDefinition<S, I, C>;
  readonly state: S;
  readonly ctx: SimContext<S, C>;
  readonly mode: SimMode;
  /** Wall-clock pacing multiplier, set by the `timescale` command. Not part of the simulation. */
  timeScale = 1;

  readonly #opts: SimulationOptions<C>;
  readonly #startConfig: C;
  readonly #events: ReplayEvent[] = [];
  readonly #maxEvents: number;
  #truncated = false;
  #failure: SimFailure | null = null;
  #pending: TickInput<I>[] = [];
  readonly #lastQueuedSeq = new Map<string, number>();
  readonly #seqReset = new Set<string>();

  constructor(def: GameDefinition<S, I, C>, opts: SimulationOptions<C>) {
    this.def = def;
    this.#opts = opts;
    this.mode = opts.mode;
    this.#maxEvents = opts.maxEvents ?? DEFAULT_MAX_EVENTS;
    const config = structuredClone(opts.config ?? def.config);
    this.#startConfig = structuredClone(config);
    this.state = def.createState();
    this.state.code = opts.code ?? "";
    this.ctx = {
      state: this.state,
      rng: new SeededRandom(opts.seed),
      config,
      tick: 0,
      dt: 1 / config.tickRate,
    };
    this.#hook("init", () => def.init(this.ctx));
  }

  /** Set once game code has thrown. */
  get failure(): SimFailure | null {
    return this.#failure;
  }

  get truncated(): boolean {
    return this.#truncated;
  }

  hasSeat(playerId: string): boolean {
    return this.state.seats.has(playerId);
  }

  /**
   * Seats a player. `guest` is the guest fingerprint (`guestFingerprint()`), never the raw guest ID;
   * any `guestId` left in the options is removed before the game's join schema sees them.
   * Throws when the options fail the game's join schema or the player is already seated.
   */
  join(playerId: string, rawOptions: unknown, guest = ""): void {
    if (this.hasSeat(playerId)) throw new Error(`player ${playerId} is already in the room`);
    if (!GUEST_FINGERPRINT_PATTERN.test(guest)) throw new Error("guest must be a guest fingerprint");
    const options = this.def.joinOptionsSchema.parse(withoutGuestId(rawOptions) ?? {});
    const seat = new Seat();
    seat.guest = guest;
    this.state.seats.set(playerId, seat);
    this.#lastQueuedSeq.delete(playerId);
    // Recorded before the hook runs, so a replay re-throws a crash in it at the same point.
    this.#record({ type: "join", tick: this.state.tick, playerId, options, guest });
    this.#hook("join", () => this.def.join(this.ctx, playerId, options, { guest }));
  }

  leave(playerId: string): void {
    if (!this.hasSeat(playerId)) return;
    this.state.seats.delete(playerId);
    this.#pending = this.#pending.filter((input) => input.playerId !== playerId);
    this.#lastQueuedSeq.delete(playerId);
    this.#seqReset.delete(playerId);
    this.#record({ type: "leave", tick: this.state.tick, playerId });
    this.#hook("leave", () => this.def.leave(this.ctx, playerId));
  }

  drop(playerId: string): void {
    const seat = this.state.seats.get(playerId);
    if (!seat) return;
    seat.connected = false;
    this.#record({ type: "drop", tick: this.state.tick, playerId });
    this.#hook("disconnect", () => this.def.disconnect?.(this.ctx, playerId));
  }

  reconnect(playerId: string): void {
    const seat = this.state.seats.get(playerId);
    if (!seat) return;
    seat.connected = true;
    // A refreshed client starts again at seq 0, so accept its next input whatever the seq.
    this.#seqReset.add(playerId);
    this.#record({ type: "reconnect", tick: this.state.tick, playerId });
    this.#hook("reconnect", () => this.def.reconnect?.(this.ctx, playerId));
  }

  /** Checks and queues one input for the next tick. Never throws. */
  queueInput(playerId: string, envelope: unknown): InputResult {
    const parsed = InputEnvelopeSchema.safeParse(envelope);
    if (!parsed.success) return "envelope";
    if (!this.hasSeat(playerId)) return "unknown-player";
    if (this.mode === "replay") {
      // Recorded inputs were already accepted live: apply them as recorded, without re-checking
      // seq, pause or schema (a re-check can disagree, e.g. after a reconnect while paused).
      this.#pending.push({ playerId, seq: parsed.data.seq, data: parsed.data.data as I });
      return "ok";
    }
    if (this.state.paused) return "paused";
    const { seq } = parsed.data;
    const reset = this.#seqReset.has(playerId);
    const last = this.#lastQueuedSeq.get(playerId);
    if (!reset && last !== undefined && seq <= last) return "stale-seq";
    const data = this.def.inputSchema.safeParse(parsed.data.data);
    if (!data.success) return "schema";
    this.#seqReset.delete(playerId);
    this.#lastQueuedSeq.set(playerId, seq);
    this.#pending.push({ playerId, seq, data: data.data });
    return "ok";
  }

  /** Advances one tick. Does nothing while paused unless `force` (the `step` command, the replay runner). */
  tick(opts: { force?: boolean } = {}): void {
    if (this.state.paused && !opts.force) return;
    const inputs = this.#pending;
    this.#pending = [];
    const tick = this.state.tick;
    const applied = new Map<string, number>();
    for (const input of inputs) {
      this.#record({ type: "input", tick, playerId: input.playerId, seq: input.seq, data: input.data });
      applied.set(input.playerId, Math.max(applied.get(input.playerId) ?? -1, input.seq));
    }
    this.ctx.tick = tick;
    this.#hook("step", () => this.def.step(this.ctx, inputs));
    for (const [playerId, seq] of applied) {
      const seat = this.state.seats.get(playerId);
      if (seat) seat.lastSeq = seq;
    }
    this.state.tick = tick + 1;
    this.ctx.tick = tick + 1;
  }

  /** Replaces the room's random generator. Used by the `seed` debug command. */
  reseed(seed: number): void {
    this.ctx.rng = new SeededRandom(seed);
  }

  /** Records the command, then runs it. Throws with a readable message when the command fails. */
  applyDebug(playerId: string, command: string, args: string[]): string {
    this.#record({ type: "debug", tick: this.state.tick, playerId, command, args });
    return runDebugCommand(this, command, args, this.mode);
  }

  /** The replay so far, with `final` set to the current tick and state hash. */
  snapshot(): Replay {
    return {
      version: REPLAY_VERSION,
      game: this.def.id,
      roomId: this.#opts.roomId,
      code: this.#opts.code ?? "",
      seed: this.#opts.seed,
      tickRate: this.#startConfig.tickRate,
      configVersion: this.#startConfig.version,
      config: structuredClone(this.#startConfig) as Record<string, unknown>,
      sha: this.#opts.sha,
      scenario: this.#opts.scenario ?? null,
      startedAt: this.#opts.startedAt,
      events: [...this.#events],
      truncated: this.#truncated,
      failure: this.#failure,
      // After a crash the state is half-updated, so there's no meaningful hash to check against.
      final: this.#failure ? null : { tick: this.state.tick, stateHash: stateHash(this.state) },
    };
  }

  /** Runs a game hook; an exception becomes a GameCodeError and is remembered as the failure. */
  #hook(name: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      const error = new GameCodeError(name, this.state.tick, err);
      this.#failure ??= {
        tick: this.state.tick,
        hook: name,
        message: error.original instanceof Error ? error.original.message : String(error.original),
      };
      throw error;
    }
  }

  #record(event: ReplayEvent): void {
    if (this.#truncated) return;
    if (this.#events.length >= this.#maxEvents) {
      this.#truncated = true;
      return;
    }
    this.#events.push(event);
  }
}
