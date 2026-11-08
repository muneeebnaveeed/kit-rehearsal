/**
 * Built-in debug commands. Every command goes through `Simulation.applyDebug`, which records it
 * first, so a replay re-runs the same commands in the same order.
 * The production check lives in the room, not here.
 */

import type { BaseState, RoomSettings } from "../sim/index.ts";
import { RoomSettingsSchema } from "../sim/index.ts";
import type { SimMode, Simulation } from "./simulation.ts";

const MAX_STEP = 600;
const MIN_TIMESCALE = 0.1;
const MAX_TIMESCALE = 10;
const ROOM_SETTING_KEYS = new Set(Object.keys(RoomSettingsSchema.shape));

type AnySim = Simulation<BaseState, unknown, RoomSettings>;
type Builtin = (sim: AnySim, args: string[], mode: SimMode) => string;

const builtins: Record<string, Builtin> = {
  pause(sim) {
    sim.state.paused = !sim.state.paused;
    return sim.state.paused ? "paused" : "resumed";
  },

  step(sim, args, mode) {
    if (!sim.state.paused) throw new Error("step works only while paused");
    const n = parseIntArg(args[0] ?? "1", "step count");
    if (n < 1 || n > MAX_STEP) throw new Error(`step count must be 1–${MAX_STEP}`);
    // In a replay the recorded ticks already contain these steps; the runner advances through them.
    if (mode === "live") for (let i = 0; i < n; i++) sim.tick({ force: true });
    return `stepped ${n} tick${n === 1 ? "" : "s"} to ${sim.state.tick}`;
  },

  timescale(sim, args) {
    const x = Number(args[0]);
    if (!Number.isFinite(x) || x < MIN_TIMESCALE || x > MAX_TIMESCALE) {
      throw new Error(`timescale must be a number from ${MIN_TIMESCALE} to ${MAX_TIMESCALE}`);
    }
    // Wall-clock pacing only: ticks stay the unit of simulation, so this never affects a replay.
    sim.timeScale = x;
    return `timescale ${x}`;
  },

  seed(sim, args) {
    const n = parseIntArg(args[0], "seed");
    sim.reseed(n);
    return `seed ${n}`;
  },

  set(sim, args) {
    const [path, raw] = args;
    if (!path || raw === undefined) throw new Error("usage: set <path> <value>");
    const keys = path.split(".");
    if (ROOM_SETTING_KEYS.has(keys[0] ?? ""))
      throw new Error(`${path} is a room setting and can't change while running`);
    const next = structuredClone(sim.ctx.config) as Record<string, unknown>;
    let parent: Record<string, unknown> = next;
    for (const key of keys.slice(0, -1)) {
      const child = parent[key];
      if (child === null || typeof child !== "object") throw new Error(`unknown config path: ${path}`);
      parent = child as Record<string, unknown>;
    }
    const last = keys.at(-1) as string;
    if (!(last in parent)) throw new Error(`unknown config path: ${path}`);
    parent[last] = parseValue(raw);
    const checked = sim.def.configSchema.safeParse(next);
    if (!checked.success)
      throw new Error(`invalid value for ${path}: ${checked.error.issues[0]?.message ?? "rejected"}`);
    sim.ctx.config = checked.data;
    return `${path} = ${JSON.stringify(parent[last])}`;
  },

  kick(sim, args) {
    const id = args[0];
    if (!id || !sim.hasSeat(id)) throw new Error(`no player ${id ?? ""}`.trim());
    sim.leave(id);
    return `kicked ${id}`;
  },
};

export const BUILTIN_COMMANDS: readonly string[] = Object.keys(builtins);

/** Runs a built-in or game command. Throws an Error with a readable message on failure. */
export function runDebugCommand<S extends BaseState, I, C extends RoomSettings>(
  sim: Simulation<S, I, C>,
  command: string,
  args: string[],
  mode: SimMode,
): string {
  const builtin = builtins[command];
  if (builtin) return builtin(sim as unknown as AnySim, args, mode);
  const handler = sim.def.commands?.[command];
  if (handler) return handler(sim.ctx, args);
  throw new Error(`unknown command: ${command}`);
}

function parseIntArg(raw: string | undefined, name: string): number {
  const n = Number(raw);
  if (raw === undefined || !Number.isInteger(n)) throw new Error(`${name} must be an integer`);
  return n;
}

function parseValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
