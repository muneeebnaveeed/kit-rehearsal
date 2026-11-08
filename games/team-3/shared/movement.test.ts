import { describe, expect, it } from "vitest";
import rawConfig from "../config/game.json" with { type: "json" };
import { movePlayer } from "./game.ts";
import { SampleConfigSchema } from "./index.ts";

const config = SampleConfigSchema.parse(rawConfig);
const dt = 1 / config.tickRate;
const middle = { x: config.arena.width / 2, y: config.arena.height / 2 };

describe("movePlayer", () => {
  it("moves by speed times dt in the input's direction", () => {
    const next = movePlayer(middle, { dx: 1, dy: -1 }, config, dt);
    expect(next.x).toBeCloseTo(middle.x + config.player.speed * dt);
    expect(next.y).toBeCloseTo(middle.y - config.player.speed * dt);
  });

  it("keeps the player inside the arena", () => {
    const corner = { x: config.player.radius, y: config.player.radius };
    expect(movePlayer(corner, { dx: -1, dy: -1 }, config, dt)).toEqual(corner);
  });

  it("does not change the position it was given", () => {
    const position = { ...middle };
    movePlayer(position, { dx: 1, dy: 0 }, config, dt);
    expect(position).toEqual(middle);
  });
});
