import { describe, expect, it } from "vitest";
import { createDebugOverlay, type DebugStats, formatDebugLines, showsDebugTools } from "./debugOverlay.ts";

const STATS: DebugStats = {
  roomId: "abc123",
  roomCode: "QXTR",
  playerId: "s1",
  tick: 120,
  pingMs: 42.4,
  patchesPerSecond: 20,
  bytesPerSecond: 2_560,
  fps: 59.6,
  frameMs: 16.71,
};

describe("formatDebugLines", () => {
  it("shows build, room, network and frame details", () => {
    const text = formatDebugLines({ env: "development", sha: "0123456789abcdef", debug: true }, STATS).join(
      "\n",
    );
    expect(text).toContain("env      development");
    expect(text).toContain("sha      0123456");
    expect(text).toContain("room     QXTR (abc123)");
    expect(text).toContain("player   s1");
    expect(text).toContain("tick     120");
    expect(text).toContain("ping     42 ms");
    expect(text).toContain("patches  20/s");
    expect(text).toContain("bytes    2.5 KB/s");
    expect(text).toContain("fps      60");
    expect(text).toContain("frame    16.7 ms");
  });

  it("shows a dash for values that are not known yet", () => {
    const lines = formatDebugLines(
      { env: "local", sha: "dev", debug: true },
      {
        ...STATS,
        roomId: null,
        roomCode: null,
        playerId: null,
        tick: null,
        pingMs: null,
        patchesPerSecond: null,
        bytesPerSecond: null,
      },
    );
    const text = lines.join("\n");
    expect(text).toContain("room     -");
    expect(text).toContain("player   -");
    expect(text).toContain("tick     -");
    expect(text).toContain("ping     -");
    expect(text).toContain("bytes    -");
  });

  it("adds extra lines from the game", () => {
    const lines = formatDebugLines({ env: "local", sha: "dev", debug: true }, STATS, {
      pickups: 5,
      phase: "lobby",
    });
    expect(lines).toContain("pickups  5");
    expect(lines).toContain("phase    lobby");
  });
});

describe("showsDebugTools", () => {
  it("follows the server's debug flag, not its env", () => {
    expect(showsDebugTools({ env: "production", sha: "abc", debug: true })).toBe(true);
    expect(showsDebugTools({ env: "production", sha: "abc", debug: false })).toBe(false);
    expect(showsDebugTools({ env: "development", sha: "abc", debug: false })).toBe(false);
  });

  it("builds no overlay when the server has debug off", () => {
    // No DOM in this test run: touching document or window would throw.
    const build = { env: "production" as const, sha: "abc", debug: false };
    const overlay = createDebugOverlay({ build });
    expect(() => overlay.update(STATS)).not.toThrow();
  });
});
