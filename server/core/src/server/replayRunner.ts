/** Re-runs a recorded replay headless (no Colyseus, no network) through the same Simulation. */
import type { Replay } from "@kit/core/shared";
import type { BaseState, GameDefinition, RoomSettings } from "../sim/index.ts";
import { Simulation } from "./simulation.ts";
import { stateHash } from "./stateHash.ts";

export interface ReplayResult<S> {
  state: S;
  tick: number;
  stateHash: string;
}

export function runReplay<S extends BaseState, I, C extends RoomSettings>(
  def: GameDefinition<S, I, C>,
  replay: Replay,
  opts: { untilTick?: number } = {},
): ReplayResult<S> {
  if (replay.game !== def.id) throw new Error(`replay is for game ${replay.game}`);
  if (replay.truncated) throw new Error("replay is truncated");
  const sim = new Simulation(def, {
    seed: replay.seed,
    roomId: replay.roomId,
    sha: replay.sha,
    scenario: replay.scenario,
    code: replay.code,
    startedAt: replay.startedAt,
    config: replay.config as C,
    mode: "replay",
  });
  const lastEventTick = replay.events.at(-1)?.tick ?? 0;
  const failure = replay.failure;
  const until = opts.untilTick ?? failure?.tick ?? replay.final?.tick ?? lastEventTick;
  const advanceTo = (tick: number) => {
    while (sim.state.tick < tick) sim.tick({ force: true });
  };

  for (const event of replay.events) {
    if (event.tick > until) break;
    advanceTo(event.tick);
    switch (event.type) {
      case "join":
        // Replays recorded before guests existed have no guest; the schema reads it as "".
        sim.join(event.playerId, event.options, event.guest ?? "");
        break;
      case "leave":
        sim.leave(event.playerId);
        break;
      case "drop":
        sim.drop(event.playerId);
        break;
      case "reconnect":
        sim.reconnect(event.playerId);
        break;
      case "input":
        sim.queueInput(event.playerId, { seq: event.seq, data: event.data });
        break;
      case "debug":
        try {
          sim.applyDebug(event.playerId, event.command, event.args);
        } catch {
          // The command failed live too (it's recorded before it runs) and changed nothing.
        }
        break;
    }
  }
  advanceTo(until);
  if (failure && opts.untilTick === undefined) {
    // Re-run the tick that crashed live; it throws the same GameCodeError.
    if (failure.hook === "step") sim.tick({ force: true });
    throw new Error(`replay did not reproduce the recorded failure: ${failure.hook} at tick ${failure.tick}`);
  }
  return { state: sim.state, tick: sim.state.tick, stateHash: stateHash(sim.state) };
}
