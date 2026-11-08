import { NO_NET_CONDITIONS } from "@kit/core/client";
import type { InputEnvelope } from "@kit/core/shared";
import { describe, expect, it } from "vitest";
import rawConfig from "../config/game.json" with { type: "json" };
import { SampleConfigSchema } from "../shared/index.ts";
import { createTemplateNetcode, type StateView } from "./netcode.ts";

const config = SampleConfigSchema.parse(rawConfig);
const RIGHT = { dx: 1, dy: 0 };

function stateView(me: { x: number; y: number; lastSeq: number }, other = { x: 50, y: 50 }): StateView {
  return {
    players: new Map([
      ["me", { x: me.x, y: me.y }],
      ["bo", other],
    ]),
    seats: new Map([["me", { lastSeq: me.lastSeq }]]),
  };
}

describe("createTemplateNetcode", () => {
  it("predicts your own move at once and sends the input on the next frame", () => {
    const net = createTemplateNetcode({ myId: "me", conditions: NO_NET_CONDITIONS, config });
    net.onState(stateView({ x: 100, y: 100, lastSeq: 0 }), 0);
    net.frame(0, () => {});

    const sent: InputEnvelope[] = [];
    net.sendInput(RIGHT, 10);
    expect(net.myPosition()?.x).toBeGreaterThan(100);
    net.frame(10, (envelope) => sent.push(envelope));
    expect(sent).toEqual([{ seq: 1, data: RIGHT }]);
  });

  it("waits for the first snapshot before sending, so seq numbers start at 1", () => {
    const net = createTemplateNetcode({ myId: "me", conditions: NO_NET_CONDITIONS, config });
    const sent: InputEnvelope[] = [];
    net.sendInput(RIGHT, 0);
    net.frame(0, (envelope) => sent.push(envelope));
    expect(sent).toEqual([]);
  });

  it("delays inputs and snapshots by the simulated lag", () => {
    const lag = { latencyMs: 300, jitterMs: 0, lossPct: 0 };
    const net = createTemplateNetcode({ myId: "me", conditions: lag, config });
    net.onState(stateView({ x: 100, y: 100, lastSeq: 0 }, { x: 70, y: 70 }), 0);
    expect(net.myPosition()).toBeNull();
    expect(net.others(299).size).toBe(0);

    net.frame(300, () => {});
    expect(net.myPosition()).toEqual({ x: 100, y: 100 });
    expect(net.others(300).get("bo")).toEqual({ x: 70, y: 70 });
    expect(net.others(300).has("me")).toBe(false);

    const sent: InputEnvelope[] = [];
    net.sendInput(RIGHT, 300);
    net.frame(599, (envelope) => sent.push(envelope));
    expect(sent).toHaveLength(0);
    net.frame(600, (envelope) => sent.push(envelope));
    expect(sent).toHaveLength(1);
  });

  it("corrects your position from the server's state", () => {
    const net = createTemplateNetcode({ myId: "me", conditions: NO_NET_CONDITIONS, config });
    net.onState(stateView({ x: 100, y: 100, lastSeq: 0 }), 0);
    net.frame(0, () => {});
    net.sendInput(RIGHT, 0);
    net.frame(0, () => {});
    // The server applied input 1 but put the player somewhere else (e.g. a teleport).
    net.onState(stateView({ x: 400, y: 300, lastSeq: 1 }), 50);
    net.frame(50, () => {});
    expect(net.myPosition()).toEqual({ x: 400, y: 300 });
    expect(net.serverPosition()).toEqual({ x: 400, y: 300 });
  });
});
