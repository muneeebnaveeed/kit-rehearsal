import { readFileSync } from "node:fs";
import { t } from "@colyseus/schema";
import { describe, expect, it } from "vitest";
import { BaseState, RoomSettingsSchema } from "./index.ts";

describe("BaseState", () => {
  it("a game state extends BaseState and keeps base fields", () => {
    const State = BaseState.extend({ score: t.uint16().default(0) }, "TestState");
    const state = new State();
    expect(state.tick).toBe(0);
    expect(state.code).toBe("");
    expect(state.paused).toBe(false);
    expect(state.seats.size).toBe(0);
    expect(state.score).toBe(0);
  });
});

describe("RoomSettingsSchema", () => {
  const valid = { version: "1", tickRate: 30, patchRate: 20, maxPlayers: 8, reconnectSeconds: 20 };

  it("rejects a tick rate below 10", () => {
    expect(RoomSettingsSchema.safeParse({ ...valid, tickRate: 5 }).success).toBe(false);
  });

  it("accepts the template config, and rejects it without patchRate", () => {
    const file = JSON.parse(
      readFileSync(new URL("../../../template/config/game.json", import.meta.url), "utf8"),
    );
    expect(RoomSettingsSchema.safeParse(file).success).toBe(true);
    const { patchRate: _dropped, ...withoutPatchRate } = file;
    expect(RoomSettingsSchema.safeParse(withoutPatchRate).success).toBe(false);
  });
});
