/**
 * `createGameRoom(definition, deps)`: the Colyseus room every game uses. It lives in @kit/host,
 * not @kit/core, so every room shares the host's single copy of the Colyseus runtime. A thin shell around a
 * Simulation: it owns the fixed tick loop, room codes, reconnection, debug commands, stats, logs
 * and error handling. All game logic stays in the definition.
 *
 * Join by code uses the in-process LiveRoomRegistry (one server process per game), so no
 * matchmaker query is needed. Private rooms are hidden from quick match with setPrivate(true) and
 * joined with `joinById` after the host looks the code up.
 *
 * Errors thrown by game code are caught here instead of in `onUncaughtException`, because that
 * hook also wraps `onJoin` and would swallow join rejections.
 */
import { performance } from "node:perf_hooks";
import {
  GameCodeError,
  generateRoomCode,
  guestFingerprint,
  RoomStats,
  type RoomStatsSnapshot,
  Simulation,
} from "@kit/core/server";
import {
  type AppEnv,
  ClientMessage,
  DebugCommandSchema,
  GUEST_ID_OPTION,
  isDebugEnabled,
  type Notice,
  newSeed,
  type Replay,
  Routes,
  ServerMessage,
} from "@kit/core/shared";
import type { BaseState, GameDefinition, RoomSettings } from "@kit/core/sim";
import { type Client, CloseCode, Room } from "colyseus";

/** The subset of a pino logger the room uses. */
export interface RoomLog {
  debug(fields: object, message?: string): void;
  info(fields: object, message?: string): void;
  warn(fields: object, message?: string): void;
  error(fields: object, message?: string): void;
  child(bindings: Record<string, unknown>): RoomLog;
}

/** Where finished rooms' replays go. `@kit/host`'s MemoryStores implements it. */
export interface ReplaySink {
  putReplay(roomId: string, replay: Replay): void;
}

export interface GameRoomDeps {
  env: AppEnv;
  /** DEBUG_TOOLS: debug commands on even in production. Default off. */
  debugTools?: boolean;
  sha: string;
  stores: ReplaySink;
  logger: RoomLog;
  registry: LiveRoomRegistry;
  /** How often each room logs `room.stats`. Default 10 s. */
  statsIntervalMs?: number;
}

/** What the host's routes can see of a live room. */
export interface LiveRoom {
  readonly roomId: string;
  readonly code: string;
  readonly maxPlayers: number;
  players(): number;
  connected(): number;
  snapshot(): Replay;
  latestStats(): RoomStatsSnapshot | null;
  notify(notice: Notice): void;
}

/** Live rooms in this process, by id and by code. */
export class LiveRoomRegistry {
  readonly #byId = new Map<string, LiveRoom>();

  add(room: LiveRoom): void {
    this.#byId.set(room.roomId, room);
  }

  remove(roomId: string): void {
    this.#byId.delete(roomId);
  }

  get(roomId: string): LiveRoom | undefined {
    return this.#byId.get(roomId);
  }

  byCode(code: string): LiveRoom | undefined {
    const wanted = code.trim().toUpperCase();
    if (wanted === "") return undefined;
    for (const room of this.#byId.values()) if (room.code === wanted) return room;
    return undefined;
  }

  all(): LiveRoom[] {
    return [...this.#byId.values()];
  }
}

const DEBUG_STATS_INTERVAL_MS = 1_000;
const DEFAULT_STATS_INTERVAL_MS = 10_000;

// biome-ignore lint/suspicious/noExplicitAny: Room subclasses take arbitrary constructor generics.
export type RoomClass = new (...args: any[]) => Room<any>;

export function createGameRoom<S extends BaseState, I, C extends RoomSettings>(
  def: GameDefinition<S, I, C>,
  deps: GameRoomDeps,
): RoomClass {
  const debugEnabled = isDebugEnabled(deps.env, deps.debugTools);

  return class GameRoom extends Room<{ state: S }> {
    sim!: Simulation<S, I, C>;
    log!: RoomLog;
    stats = new RoomStats();
    debugStats = new RoomStats();
    code = "";
    peakPlayers = 0;
    createdAt = 0;
    lastTickAt = 0;
    tickBudget = 0;
    failed = false;

    override async onCreate(options: { private?: boolean } = {}): Promise<void> {
      // The creator's join options arrive here too, raw `guestId` included: read only `private`, and
      // never log or store `options` as a whole.
      // The code is part of the state (and the replay), so pick it before the simulation starts.
      if (options.private) this.code = generateRoomCode((code) => deps.registry.byCode(code) !== undefined);
      this.log = deps.logger.child({ roomId: this.roomId, code: this.code });
      try {
        this.sim = new Simulation(def, {
          seed: newSeed(),
          roomId: this.roomId,
          sha: deps.sha,
          startedAt: new Date().toISOString(),
          mode: "live",
          code: this.code,
        });
      } catch (err) {
        this.log.error(
          { err, methodName: err instanceof GameCodeError ? err.hook : "init" },
          "game code threw; room not created",
        );
        throw err;
      }
      this.state = this.sim.state;
      const config = this.sim.ctx.config;
      this.maxClients = config.maxPlayers;
      this.patchRate = 1000 / config.patchRate;
      this.createdAt = performance.now();

      deps.registry.add(this.#liveView());
      if (options.private) {
        await this.setMetadata({ code: this.code });
        await this.setPrivate(true);
      }

      this.setFixedTimestep(() => this.#onTimestep(), config.tickRate);
      this.clock.setInterval(() => this.#logStats(), deps.statsIntervalMs ?? DEFAULT_STATS_INTERVAL_MS);
      if (debugEnabled) this.clock.setInterval(() => this.#sendDebugStats(), DEBUG_STATS_INTERVAL_MS);

      this.onMessage(ClientMessage.Input, (client, message) => {
        this.stats.recordInput(this.sim.queueInput(client.sessionId, message));
      });
      this.onMessage(ClientMessage.DebugCommand, (client, message) => this.#onDebugCommand(client, message));

      this.log.info({ private: Boolean(options.private), tick: this.state.tick }, "room created");
    }

    override onJoin(client: Client, options: unknown): void {
      // Only the fingerprint goes further, scoped to this game (def.id) so it can't link one player
      // across the games that share the origin. Never log `options`: it still holds the raw guest ID.
      const guest = guestFingerprint(
        def.id,
        (options as Record<string, unknown> | undefined)?.[GUEST_ID_OPTION],
      );
      try {
        this.sim.join(client.sessionId, options, guest);
      } catch (err) {
        if (err instanceof GameCodeError) {
          this.#fail(err);
          throw new Error("can't join: the room hit an error and closed");
        }
        this.log.info({ playerId: client.sessionId, guest, reason: errorMessage(err) }, "join rejected");
        throw new Error(`can't join: ${errorMessage(err)}`);
      }
      this.peakPlayers = Math.max(this.peakPlayers, this.clients.length);
      this.log.info({ playerId: client.sessionId, guest, tick: this.state.tick }, "player joined");
    }

    override async onDrop(client: Client): Promise<void> {
      if (!this.#guard(() => this.sim.drop(client.sessionId))) return;
      this.log.info({ playerId: client.sessionId, tick: this.state.tick }, "player dropped");
      const seconds = this.sim.ctx.config.reconnectSeconds;
      // Rejected when the seat expires or the room shuts down; onLeave handles both.
      if (seconds > 0) this.allowReconnection(client, seconds).catch(() => {});
    }

    override onReconnect(client: Client): void {
      if (!this.#guard(() => this.sim.reconnect(client.sessionId))) return;
      this.stats.recordReconnect();
      this.log.info({ playerId: client.sessionId, tick: this.state.tick }, "player reconnected");
    }

    override onLeave(client: Client, code?: number): void {
      if (!this.sim.hasSeat(client.sessionId)) return;
      const seat = this.state.seats.get(client.sessionId);
      const expired = seat?.connected === false;
      if (!this.#guard(() => this.sim.leave(client.sessionId))) return;
      const fields = { playerId: client.sessionId, tick: this.state.tick };
      if (expired) this.log.info(fields, "seat expired");
      else this.log.info({ ...fields, consented: code === CloseCode.CONSENTED }, "player left");
    }

    override onBeforePatch(): void {
      // Colyseus doesn't expose patch sizes here, so bytesOut stays 0; patches counts sends.
      this.stats.recordPatch(0);
    }

    override onDispose(): void {
      deps.registry.remove(this.roomId);
      deps.stores.putReplay(this.roomId, this.sim.snapshot());
      this.log.info(
        {
          tick: this.state.tick,
          durationS: Math.round((performance.now() - this.createdAt) / 1000),
          peakPlayers: this.peakPlayers,
          truncated: this.sim.truncated,
        },
        "room closed",
      );
    }

    #onTimestep(): void {
      if (this.failed) return;
      const now = performance.now();
      const intervalMs = 1000 / this.sim.ctx.config.tickRate;
      const late = this.lastTickAt > 0 && now - this.lastTickAt > 2 * intervalMs;
      this.lastTickAt = now;
      // timescale: run more or fewer simulation ticks per timestep callback.
      this.tickBudget += this.sim.timeScale;
      while (this.tickBudget >= 1) {
        this.tickBudget -= 1;
        const start = performance.now();
        try {
          this.sim.tick();
        } catch (err) {
          this.#fail(err);
          return;
        }
        const ms = performance.now() - start;
        this.stats.recordTick(ms, late);
        this.debugStats.recordTick(ms, late);
      }
    }

    #onDebugCommand(client: Client, message: unknown): void {
      const parsed = DebugCommandSchema.safeParse(message);
      if (!parsed.success) return;
      const { id, command, args } = parsed.data;
      const fields = { playerId: client.sessionId, tick: this.state.tick, command, args };
      if (!debugEnabled) {
        this.log.warn(fields, "debug command rejected in production");
        client.send(ServerMessage.DebugResult, {
          id,
          ok: false,
          output: "debug commands are disabled in production",
        });
        return;
      }
      try {
        const output = this.sim.applyDebug(client.sessionId, command, args);
        this.log.info({ ...fields, ok: true, output }, "debug command");
        client.send(ServerMessage.DebugResult, { id, ok: true, output });
        if (command === "kick") {
          this.log.info({ ...fields, playerId: args[0] }, "player kicked");
          this.clients.getById(args[0] ?? "")?.leave(CloseCode.CONSENTED);
        }
      } catch (err) {
        this.log.info({ ...fields, ok: false, output: errorMessage(err) }, "debug command");
        client.send(ServerMessage.DebugResult, { id, ok: false, output: errorMessage(err) });
      }
    }

    /** Runs a simulation call; on a game-code error, fails the room and returns false. */
    #guard(fn: () => void): boolean {
      try {
        fn();
        return true;
      } catch (err) {
        this.#fail(err);
        return false;
      }
    }

    #fail(err: unknown): void {
      if (this.failed) return;
      this.failed = true;
      const methodName = err instanceof GameCodeError ? err.hook : "unknown";
      this.log.error(
        {
          err,
          methodName,
          tick: this.state.tick,
          replayUrl: Routes.replay(this.roomId),
        },
        "game code threw; closing the room",
      );
      this.broadcast(ServerMessage.Notice, { level: "error", text: "The room hit an error and closed." });
      this.clock.setTimeout(() => this.disconnect(), 0);
    }

    #logStats(): void {
      this.log.info(
        {
          tick: this.state.tick,
          players: this.state.seats.size,
          connected: this.#connected(),
          ...this.stats.flush(),
        },
        "room.stats",
      );
    }

    #sendDebugStats(): void {
      const s = this.debugStats.flush();
      this.broadcast(ServerMessage.DebugStats, {
        tick: this.state.tick,
        tickMsAvg: s.tickMsAvg,
        tickMsP95: s.tickMsP95,
        lateTicks: s.lateTicks,
      });
    }

    #connected(): number {
      let n = 0;
      for (const seat of this.state.seats.values()) if (seat.connected) n++;
      return n;
    }

    #liveView(): LiveRoom {
      return {
        roomId: this.roomId,
        code: this.code,
        maxPlayers: this.maxClients,
        players: () => this.state.seats.size,
        connected: () => this.#connected(),
        snapshot: () => this.sim.snapshot(),
        latestStats: () => this.stats.latest(),
        notify: (notice) => this.broadcast(ServerMessage.Notice, notice),
      };
    }
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
