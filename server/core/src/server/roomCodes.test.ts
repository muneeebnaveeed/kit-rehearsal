import { describe, expect, it } from "vitest";
import { generateRoomCode, ROOM_CODE_ALPHABET } from "./roomCodes.ts";

describe("generateRoomCode", () => {
  it("codes use only the alphabet and skip taken codes", () => {
    expect(ROOM_CODE_ALPHABET).toBe("ABCDEFGHJKLMNPQRSTUVWXYZ");
    // First draw is AAAA (taken), second is BBBB.
    const draws = [0, 0, 0, 0, 1 / 24, 1 / 24, 1 / 24, 1 / 24];
    const code = generateRoomCode(
      (c) => c === "AAAA",
      () => draws.shift() ?? 0,
    );
    expect(code).toBe("BBBB");
    for (let i = 0; i < 200; i++)
      expect(generateRoomCode(() => false)).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
  });

  it("generateRoomCode throws after 100 collisions", () => {
    let calls = 0;
    expect(() =>
      generateRoomCode(() => {
        calls++;
        return true;
      }),
    ).toThrow();
    expect(calls).toBe(100);
  });
});
