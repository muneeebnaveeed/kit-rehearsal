import { describe, expect, it } from "vitest";
import config from "../config/game.json" with { type: "json" };
import { Player, SampleConfigSchema, SampleInputSchema, SampleState } from "./index.ts";

describe("template game contract", () => {
  it("ships a config file that matches its schema", () => {
    expect(() => SampleConfigSchema.parse(config)).not.toThrow();
  });

  it("clamps input to the unit range", () => {
    expect(SampleInputSchema.safeParse({ dx: 1, dy: -1 }).success).toBe(true);
    expect(SampleInputSchema.safeParse({ dx: 2, dy: 0 }).success).toBe(false);
  });

  it("builds state with players keyed by session id", () => {
    const state = new SampleState();
    const player = new Player();
    player.name = "QA-1";
    player.x = 10;
    state.players.set("session-1", player);
    expect(state.players.get("session-1")?.name).toBe("QA-1");
    expect(state.tick).toBe(0);
  });
});
