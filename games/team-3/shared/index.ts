/**
 * Contract for the template game: room state, input and config.
 * The server room (room/) and the client (client/) both import this, so it must stay browser-safe.
 * Change it only through a PR reviewed by both the server and client owners.
 */
import { type SchemaType, schema, t } from "@colyseus/schema";
import { BaseState, RoomSettingsSchema } from "@kit/core/sim";
import { z } from "zod";

export const GAME_ID = "template";

/** Synced player. Positions are in arena units, not pixels. Seat state lives in `state.seats`. */
export const Player = schema(
  {
    name: t.string().default(""),
    color: t.string().default("#ffffff"),
    x: t.number().default(0),
    y: t.number().default(0),
    score: t.uint16().default(0),
  },
  "Player",
);
export type Player = SchemaType<typeof Player>;

export const Pickup = schema({ x: t.number().default(0), y: t.number().default(0) }, "Pickup");
export type Pickup = SchemaType<typeof Pickup>;

/** Extends BaseState (tick, code, paused, seats). */
export const SampleState = BaseState.extend(
  {
    /** Keyed by sessionId. */
    players: t.map(Player),
    /** Keyed by pickup id. */
    pickups: t.map(Pickup),
  },
  "SampleState",
);
export type SampleState = SchemaType<typeof SampleState>;

/** One tick of player input: a movement direction, each axis in [-1, 1]. */
export const SampleInputSchema = z.object({
  dx: z.number().min(-1).max(1),
  dy: z.number().min(-1).max(1),
});
export type SampleInput = z.infer<typeof SampleInputSchema>;

/** What a client passes when it creates or joins a room. */
export const SampleJoinOptionsSchema = z.object({
  name: z.string().trim().min(1).max(24).default("player"),
  /** Hex colour; empty picks one from the palette by seat order. */
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

/** Room settings plus tuning values, loaded from config/game.json. Designers edit the JSON, not code. */
export const SampleConfigSchema = RoomSettingsSchema.extend({
  arena: z.object({ width: z.number().positive(), height: z.number().positive() }),
  player: z.object({
    speed: z.number().positive().describe("Arena units per second"),
    radius: z.number().positive(),
  }),
  pickups: z.object({
    count: z.number().int().nonnegative(),
    radius: z.number().positive(),
    points: z.number().int().positive(),
  }),
});
export type SampleConfig = z.infer<typeof SampleConfigSchema>;
