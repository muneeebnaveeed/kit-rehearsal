/**
 * The template's netcode, built from @kit/core/client:
 * - inputs and incoming snapshots go through a network simulator (`?lag=300&jitter=50&loss=5`),
 * - other players are drawn through an interpolation buffer, so they glide between snapshots,
 * - your own player is predicted with the same movePlayer rule the room uses, so it reacts at once.
 * With no ?lag the simulator delivers right away and the game plays as before.
 */
import {
  createInterpolationBuffer,
  createNetSimulator,
  createPredictor,
  lerpPoint,
  type NetConditions,
  type Predictor,
} from "@kit/core/client";
import type { InputEnvelope } from "@kit/core/shared";
import { movePlayer, type Position } from "../shared/game.ts";
import type { SampleConfig, SampleInput } from "../shared/index.ts";

/** About two server ticks at 30 Hz: enough to always have a snapshot on each side. */
const INTERPOLATION_DELAY_MS = 70;

/** The parts of the room state the netcode reads. The room's SampleState fits. */
export interface StateView {
  readonly players: { entries(): Iterable<[string, Position]> };
  readonly seats: { get(id: string): { readonly lastSeq: number } | undefined };
}

interface Snapshot {
  readonly others: ReadonlyMap<string, Position>;
  readonly me: (Position & { readonly lastSeq: number }) | null;
}

export interface TemplateNetcodeOptions {
  readonly myId: string;
  readonly conditions: NetConditions;
  readonly config: SampleConfig;
}

export interface TemplateNetcode {
  /** Call from room.onStateChange: copies the state, as it would arrive over the (simulated) network. */
  onState(state: StateView, now: number): void;
  /** Applies the input locally and queues it for the server. */
  sendInput(input: SampleInput, now: number): void;
  /** Call every frame: sends inputs that are due and applies snapshots that arrived. */
  frame(now: number, send: (envelope: InputEnvelope) => void): void;
  /** Where to draw your own player: predicted, or null before the first snapshot. */
  myPosition(): Position | null;
  /** Your position as the server last reported it (drawn as a ghost when lag is on). */
  serverPosition(): Position | null;
  /** Where to draw the other players at `now`. */
  others(now: number): Map<string, Position>;
}

export function createTemplateNetcode(options: TemplateNetcodeOptions): TemplateNetcode {
  const dt = 1 / options.config.tickRate;
  const outgoing = createNetSimulator<InputEnvelope>(options.conditions);
  const incoming = createNetSimulator<Snapshot>(options.conditions);
  const others = createInterpolationBuffer<Position>({ delayMs: INTERPOLATION_DELAY_MS, lerp: lerpPoint });
  let predictor: Predictor<Position, SampleInput> | null = null;
  let server: Position | null = null;

  const apply = (snapshot: Snapshot, now: number): void => {
    others.push(now, snapshot.others);
    if (!snapshot.me) return;
    server = { x: snapshot.me.x, y: snapshot.me.y };
    if (predictor) predictor.reconcile(server, snapshot.me.lastSeq);
    else
      predictor = createPredictor({
        initial: server,
        apply: (pos, input) => movePlayer(pos, input, options.config, dt),
      });
  };

  return {
    onState(state, now) {
      const positions = new Map<string, Position>();
      for (const [id, player] of state.players.entries()) {
        if (id !== options.myId) positions.set(id, { x: player.x, y: player.y });
      }
      const mine = [...state.players.entries()].find(([id]) => id === options.myId)?.[1];
      const seat = state.seats.get(options.myId);
      const me = mine && seat ? { x: mine.x, y: mine.y, lastSeq: seat.lastSeq } : null;
      incoming.send({ others: positions, me }, now);
    },
    sendInput(input, now) {
      // Before the first snapshot there is nothing to predict from, and the seq numbers must start at 1.
      if (!predictor) return;
      const { seq } = predictor.predict(input);
      outgoing.send({ seq, data: input }, now);
    },
    frame(now, send) {
      for (const envelope of outgoing.drain(now)) send(envelope);
      for (const snapshot of incoming.drain(now)) apply(snapshot, now);
    },
    myPosition() {
      return predictor?.state ?? null;
    },
    serverPosition() {
      return server;
    },
    others(now) {
      return others.sample(now);
    },
  };
}
