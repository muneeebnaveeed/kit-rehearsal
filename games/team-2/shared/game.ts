/**
 * The template game's rules: players move and collect seeded pickups.
 * Pure and browser-safe: no Colyseus server, no clocks, no Math.random(). Use ctx.rng and ctx.dt.
 */
import type { GameDefinition, SimContext } from "@kit/core/sim";
import rawConfig from "../config/game.json" with { type: "json" };
import {
  GAME_ID,
  Pickup,
  Player,
  type SampleConfig,
  SampleConfigSchema,
  type SampleInput,
  SampleInputSchema,
  SampleJoinOptionsSchema,
  SampleState,
} from "./index.ts";

type Ctx = SimContext<SampleState, SampleConfig>;

const PALETTE = ["#4dabf7", "#ff6b6b", "#51cf66", "#fcc419", "#cc5de8", "#ff922b", "#22b8cf", "#f06595"];

/** Checked at load: a bad config file stops the server at startup with the zod message. */
const config = SampleConfigSchema.parse(rawConfig);

function randomPosition(ctx: Ctx, margin: number): { x: number; y: number } {
  const { width, height } = ctx.config.arena;
  return { x: ctx.rng.range(margin, width - margin), y: ctx.rng.range(margin, height - margin) };
}

function placePickup(ctx: Ctx, pickup: Pickup): void {
  const { x, y } = randomPosition(ctx, ctx.config.pickups.radius);
  pickup.x = x;
  pickup.y = y;
}

function addPickup(ctx: Ctx): string {
  let n = ctx.state.pickups.size;
  while (ctx.state.pickups.has(`pk${n}`)) n++;
  const id = `pk${n}`;
  const pickup = new Pickup();
  placePickup(ctx, pickup);
  ctx.state.pickups.set(id, pickup);
  return id;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export interface Position {
  readonly x: number;
  readonly y: number;
}

/**
 * One tick of movement for one player. The room's `step` uses it, and the client uses the same rule
 * to predict its own player (createPredictor), so both always agree.
 */
export function movePlayer(position: Position, input: SampleInput, cfg: SampleConfig, dt: number): Position {
  const { speed, radius } = cfg.player;
  const { width, height } = cfg.arena;
  return {
    x: clamp(position.x + input.dx * speed * dt, radius, width - radius),
    y: clamp(position.y + input.dy * speed * dt, radius, height - radius),
  };
}

export const templateGame: GameDefinition<SampleState, SampleInput, SampleConfig> = {
  id: GAME_ID,
  createState: () => new SampleState(),
  inputSchema: SampleInputSchema,
  joinOptionsSchema: SampleJoinOptionsSchema,
  config,
  configSchema: SampleConfigSchema,

  init(ctx) {
    for (let i = 0; i < ctx.config.pickups.count; i++) addPickup(ctx);
  },

  join(ctx, playerId, options) {
    const player = new Player();
    player.name = String(options.name);
    player.color =
      typeof options.color === "string"
        ? options.color
        : (PALETTE[ctx.state.players.size % PALETTE.length] as string);
    const { x, y } = randomPosition(ctx, ctx.config.player.radius);
    player.x = x;
    player.y = y;
    ctx.state.players.set(playerId, player);
  },

  leave(ctx, playerId) {
    ctx.state.players.delete(playerId);
  },

  step(ctx, inputs) {
    // Keyboard input is continuous: the last input of the tick wins.
    const latest = new Map<string, SampleInput>();
    for (const input of inputs) latest.set(input.playerId, input.data);

    for (const [id, input] of latest) {
      const player = ctx.state.players.get(id);
      if (!player) continue;
      const next = movePlayer(player, input, ctx.config, ctx.dt);
      player.x = next.x;
      player.y = next.y;
    }

    const reach = ctx.config.player.radius + ctx.config.pickups.radius;
    for (const pickup of ctx.state.pickups.values()) {
      for (const player of ctx.state.players.values()) {
        if ((player.x - pickup.x) ** 2 + (player.y - pickup.y) ** 2 <= reach ** 2) {
          player.score += ctx.config.pickups.points;
          placePickup(ctx, pickup);
          break;
        }
      }
    }
  },

  commands: {
    spawn(ctx) {
      return `spawned ${addPickup(ctx)}`;
    },
    tp(ctx, [id, x, y]) {
      const player = ctx.state.players.get(id ?? "");
      if (!player) throw new Error(`no player ${id ?? ""}`.trim());
      const nx = Number(x);
      const ny = Number(y);
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) throw new Error("usage: tp <playerId> <x> <y>");
      player.x = nx;
      player.y = ny;
      return `moved ${id} to ${nx},${ny}`;
    },
  },
};
