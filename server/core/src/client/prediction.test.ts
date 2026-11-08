import { describe, expect, it } from "vitest";
import { createPredictor } from "./prediction.ts";

interface Pos {
  readonly x: number;
}
interface Move {
  readonly dx: number;
}
const apply = (state: Pos, input: Move): Pos => ({ x: state.x + input.dx });

describe("createPredictor", () => {
  it("applies input right away and numbers it from 1", () => {
    const predictor = createPredictor<Pos, Move>({ initial: { x: 0 }, apply });
    expect(predictor.predict({ dx: 5 })).toEqual({ seq: 1, state: { x: 5 } });
    expect(predictor.predict({ dx: 5 })).toEqual({ seq: 2, state: { x: 10 } });
    expect(predictor.state).toEqual({ x: 10 });
    expect(predictor.pendingCount).toBe(2);
  });

  it("replays inputs the server has not applied yet on top of the server state", () => {
    const predictor = createPredictor<Pos, Move>({ initial: { x: 0 }, apply });
    predictor.predict({ dx: 1 }); // seq 1
    predictor.predict({ dx: 2 }); // seq 2
    predictor.predict({ dx: 3 }); // seq 3

    // The server applied seq 1, but a wall stopped the player at 0.5 instead of 1.
    const corrected = predictor.reconcile({ x: 0.5 }, 1);

    expect(corrected).toEqual({ x: 5.5 });
    expect(predictor.pendingCount).toBe(2);
  });

  it("matches the server exactly once every input is acknowledged", () => {
    const predictor = createPredictor<Pos, Move>({ initial: { x: 0 }, apply });
    predictor.predict({ dx: 1 });
    predictor.predict({ dx: 1 });
    expect(predictor.reconcile({ x: 42 }, 2)).toEqual({ x: 42 });
    expect(predictor.pendingCount).toBe(0);
  });

  it("ignores an acknowledgement older than one it already processed", () => {
    const predictor = createPredictor<Pos, Move>({ initial: { x: 0 }, apply });
    predictor.predict({ dx: 1 });
    predictor.predict({ dx: 1 });
    predictor.reconcile({ x: 2 }, 2);
    predictor.predict({ dx: 1 }); // seq 3
    expect(predictor.reconcile({ x: 1 }, 1)).toEqual({ x: 3 });
  });
});
