import { describe, expect, it } from "vitest";
import {
  BugReportCreatedSchema,
  BugReportSchema,
  DebugCommandSchema,
  DebugStatsSchema,
  GUEST_FINGERPRINT_LENGTH,
  GUEST_ID_OPTION,
  HealthResponseSchema,
  isDebugEnabled,
  JoinByCodeResponseSchema,
  parseDebugTools,
  REPLAY_VERSION,
  ReplaySchema,
  Routes,
  SeededRandom,
  ServerMessage,
} from "./index.ts";

describe("health", () => {
  it("accepts a valid response and rejects an unknown env", () => {
    const ok = {
      ok: true,
      env: "staging",
      debug: true,
      sha: "abc123",
      startedAt: "2026-11-06T10:00:00Z",
      games: ["sample"],
    };
    expect(HealthResponseSchema.parse(ok)).toEqual(ok);
    expect(HealthResponseSchema.safeParse({ ...ok, env: "qa" }).success).toBe(false);
    const { debug: _, ...noDebug } = ok;
    expect(HealthResponseSchema.safeParse(noDebug).success).toBe(false);
  });

  it("turns debug tools off only in production", () => {
    expect(isDebugEnabled("production")).toBe(false);
    expect(isDebugEnabled("staging")).toBe(true);
    expect(isDebugEnabled("local")).toBe(true);
  });

  it("turns debug tools on in production when DEBUG_TOOLS is on", () => {
    expect(isDebugEnabled("production", true)).toBe(true);
    expect(isDebugEnabled("production", false)).toBe(false);
    expect(isDebugEnabled("development", false)).toBe(true);
  });

  it("reads DEBUG_TOOLS as on only for the value on", () => {
    expect(parseDebugTools("on")).toBe(true);
    expect(parseDebugTools(" ON ")).toBe(true);
    for (const raw of [undefined, "", "off", "true", "1", "yes"]) expect(parseDebugTools(raw)).toBe(false);
  });
});

describe("debug commands", () => {
  it("defaults args and rejects malformed command names", () => {
    expect(DebugCommandSchema.parse({ id: "1", command: "spawn" }).args).toEqual([]);
    expect(DebugCommandSchema.safeParse({ id: "1", command: "/spawn" }).success).toBe(false);
    expect(DebugCommandSchema.safeParse({ id: "1", command: "rm -rf" }).success).toBe(false);
  });
});

describe("bug report", () => {
  it("requires a title and an image data URL for screenshots", () => {
    const base = {
      title: "Player stuck in wall",
      game: "sample",
      env: "development",
      sha: "abc123",
      roomId: "r1",
      playerId: "p1",
      tick: 900,
      scenario: null,
      url: "https://example.test/?room=QXTR",
      userAgent: "test",
      net: { latencyMs: 150, jitterMs: 20, lossPct: 2 },
      logs: [],
      screenshot: null,
    };
    expect(BugReportSchema.parse(base).description).toBe("");
    expect(BugReportSchema.safeParse({ ...base, title: "" }).success).toBe(false);
    expect(BugReportSchema.safeParse({ ...base, screenshot: "https://x/y.png" }).success).toBe(false);
  });
});

describe("replay", () => {
  it("parses every event type", () => {
    const replay = ReplaySchema.parse({
      version: REPLAY_VERSION,
      game: "sample",
      roomId: "r1",
      seed: 42,
      tickRate: 30,
      configVersion: "1",
      config: { version: "1" },
      sha: "abc123",
      scenario: null,
      startedAt: "2026-11-06T10:00:00Z",
      events: [
        { type: "join", tick: 0, playerId: "p1" },
        { type: "input", tick: 1, playerId: "p1", seq: 0, data: { dx: 1, dy: 0 } },
        { type: "debug", tick: 5, playerId: "p1", command: "pause", args: [] },
        { type: "leave", tick: 9, playerId: "p1" },
      ],
      final: { tick: 9, stateHash: "deadbeef" },
    });
    expect(replay.events.map((e) => e.type)).toEqual(["join", "input", "debug", "leave"]);
  });
});

describe("replay v2", () => {
  const base = {
    version: REPLAY_VERSION,
    game: "sample",
    roomId: "r1",
    seed: 42,
    tickRate: 30,
    configVersion: "1",
    sha: "abc123",
    scenario: null,
    startedAt: "2026-11-06T10:00:00Z",
    events: [
      { type: "join", tick: 0, playerId: "p1" },
      { type: "drop", tick: 3, playerId: "p1" },
      { type: "reconnect", tick: 7, playerId: "p1" },
    ],
    final: null,
  };

  it("accepts drop and reconnect events and requires config", () => {
    expect(REPLAY_VERSION).toBe(2);
    const replay = ReplaySchema.parse({ ...base, config: { version: "1" } });
    expect(replay.events.map((e) => e.type)).toEqual(["join", "drop", "reconnect"]);
    expect(replay.truncated).toBe(false);
    expect(ReplaySchema.safeParse(base).success).toBe(false);
  });
});

describe("guest in join events", () => {
  const replay = (join: Record<string, unknown>) => ({
    version: REPLAY_VERSION,
    game: "sample",
    roomId: "r1",
    seed: 42,
    tickRate: 30,
    configVersion: "1",
    config: { version: "1" },
    sha: "abc123",
    scenario: null,
    startedAt: "2026-11-06T10:00:00Z",
    events: [{ type: "join", tick: 0, playerId: "p1", ...join }],
    final: null,
  });
  const joinGuest = (join: Record<string, unknown>) => {
    const event = ReplaySchema.parse(replay(join)).events[0];
    return event?.type === "join" ? event.guest : undefined;
  };

  it('defaults a missing guest to "", so old replays still parse', () => {
    expect(joinGuest({})).toBe("");
  });

  it("accepts a 12-hex fingerprint and nothing that could be a raw guest ID", () => {
    expect(joinGuest({ guest: "0123456789ab" })).toBe("0123456789ab");
    for (const guest of [crypto.randomUUID(), "0123456789AB", "0123456789abc", "xyz"])
      expect(ReplaySchema.safeParse(replay({ guest })).success).toBe(false);
  });

  it("names the join option and the fingerprint length", () => {
    expect(GUEST_ID_OPTION).toBe("guestId");
    expect(GUEST_FINGERPRINT_LENGTH).toBe(12);
  });
});

describe("routes", () => {
  it("encodes room ids in replay URLs", () => {
    expect(Routes.replay("a/b")).toBe("/api/replays/a%2Fb");
  });

  it("encodes bug report ids and exposes the new routes", () => {
    expect(Routes.bugReportById("a b")).toBe("/api/bug-reports/a%20b");
    expect(Routes.bugReports).toBe("/api/bug-reports");
    expect(Routes.stats).toBe("/api/stats");
    expect(Routes.joinByCode).toBe("/api/rooms/join");
  });
});

describe("server messages", () => {
  it("validates debug stats and rejects negative late ticks", () => {
    expect(ServerMessage.DebugStats).toBe("debug:stats");
    const ok = { tick: 10, tickMsAvg: 0.4, tickMsP95: 1.2, lateTicks: 0 };
    expect(DebugStatsSchema.parse(ok)).toEqual(ok);
    expect(DebugStatsSchema.safeParse({ ...ok, lateTicks: -1 }).success).toBe(false);
  });

  it("validates join-by-code and bug-report-created responses", () => {
    expect(JoinByCodeResponseSchema.parse({ roomId: "abc" }).roomId).toBe("abc");
    expect(BugReportCreatedSchema.safeParse({ id: "nope", url: "/x" }).success).toBe(false);
  });
});

describe("SeededRandom", () => {
  it("produces the same sequence for the same seed", () => {
    const a = new SeededRandom(1234);
    const b = new SeededRandom(1234);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
    expect(new SeededRandom(1235).next()).not.toBe(seqA[0]);
  });

  it("keeps int() within inclusive bounds", () => {
    const r = new SeededRandom(7);
    for (let i = 0; i < 1000; i++) {
      const n = r.int(1, 3);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(3);
    }
  });
});
