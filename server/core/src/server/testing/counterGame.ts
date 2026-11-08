/** A tiny deterministic game for platform tests: each player has an x that inputs push around. */
import { type SchemaType, schema, t } from "@colyseus/schema";
import { z } from "zod";
import { BaseState, type GameDefinition, RoomSettingsSchema } from "../../sim/index.ts";

export const Mover = schema({ x: t.number().default(0), name: t.string().default("") }, "Mover");
export const CounterState = BaseState.extend(
  { movers: t.map(Mover), coins: t.uint32().default(0) },
  "CounterState",
);
export type CounterState = SchemaType<typeof CounterState>;

export const CounterConfigSchema = RoomSettingsSchema.extend({ speed: z.number().positive() });
export type CounterConfig = z.infer<typeof CounterConfigSchema>;

export const counterConfig: CounterConfig = {
  version: "1",
  tickRate: 30,
  patchRate: 20,
  maxPlayers: 4,
  reconnectSeconds: 20,
  speed: 1,
};

export function makeCounterGame(
  overrides: Partial<GameDefinition<CounterState, { dx: number }, CounterConfig>> = {},
): GameDefinition<CounterState, { dx: number }, CounterConfig> {
  return {
    id: "counter",
    createState: () => new CounterState(),
    inputSchema: z.object({ dx: z.number().min(-1).max(1) }),
    joinOptionsSchema: z.object({ name: z.string().max(24).default("p") }),
    config: counterConfig,
    configSchema: CounterConfigSchema,
    init(ctx) {
      ctx.state.coins = ctx.rng.int(0, 1000);
    },
    join(ctx, playerId, options) {
      const m = new Mover();
      m.name = String(options.name);
      m.x = ctx.rng.int(0, 10);
      ctx.state.movers.set(playerId, m);
    },
    leave(ctx, playerId) {
      ctx.state.movers.delete(playerId);
    },
    step(ctx, inputs) {
      for (const input of inputs) {
        const m = ctx.state.movers.get(input.playerId);
        if (m) m.x += input.data.dx * ctx.config.speed;
      }
      if (ctx.tick % 10 === 0) ctx.state.coins += ctx.rng.int(0, 3);
    },
    disconnect() {},
    reconnect() {},
    ...overrides,
  };
}
