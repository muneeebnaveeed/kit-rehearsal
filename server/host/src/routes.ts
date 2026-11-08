/**
 * HTTP routes next to the game: replays, bug reports, stats and join by code.
 * They stay on in production so playtests produce reproducible reports; ids are random, production
 * stats list no ids or codes, and bug reports and live replay downloads are rate-limited.
 */
import { type AppEnv, BugReportSchema, JoinByCodeRequestSchema, Routes } from "@kit/core/shared";
import express, { type Application, type NextFunction, type Request, type Response } from "express";
import type { LiveRoomRegistry, RoomLog } from "./gameRoom.ts";
import { ProcessStats } from "./processStats.ts";
import type { MemoryStores } from "./stores.ts";

const BUG_REPORT_LIMIT = "3mb";
const BUG_REPORTS_PER_MINUTE = 5;
const LIVE_REPLAYS_PER_MINUTE = 10;
const MINUTE_MS = 60_000;

export interface RouteDeps {
  env: AppEnv;
  stores: MemoryStores;
  registry: LiveRoomRegistry;
  gameId: string;
  logger: RoomLog;
  processStats?: ProcessStats;
}

export function registerRoutes(app: Application, deps: RouteDeps): ProcessStats {
  const { env, stores, registry, logger } = deps;
  const processStats = deps.processStats ?? new ProcessStats(registry, stores);
  const allowBugReport = rateLimiter(BUG_REPORTS_PER_MINUTE, MINUTE_MS);
  const allowReplay = rateLimiter(LIVE_REPLAYS_PER_MINUTE, MINUTE_MS);
  // Railway adds one proxy hop. Trust only that one, so req.ip is the address Railway saw and a
  // client can't pick its own by sending X-Forwarded-For.
  app.set("trust proxy", 1);

  app.get("/api/replays/:roomId", (req, res) => {
    const roomId = req.params.roomId;
    const live = registry.get(roomId);
    // Snapshotting a live room copies and hashes its whole history, so limit how often that happens.
    if (live && !allowReplay(req.ip ?? "unknown")) {
      res.status(429).json({ error: "too many replay downloads, try again in a minute" });
      return;
    }
    const replay = live?.snapshot() ?? stores.getReplay(roomId);
    if (!replay) {
      res.status(404).json({ error: "unknown room" });
      return;
    }
    logger.info({ roomId, live: registry.get(roomId) !== undefined }, "replay downloaded");
    res.setHeader("Content-Disposition", `attachment; filename="replay-${roomId}.json"`);
    res.json(replay);
  });

  const limitBugReports = (req: Request, res: Response, next: NextFunction) => {
    // Before the body parser, so a rejected request doesn't cost a 3 MB parse.
    if (allowBugReport(req.ip ?? "unknown")) next();
    else res.status(429).json({ error: "too many bug reports, try again in a minute" });
  };

  app.post(Routes.bugReports, limitBugReports, express.json({ limit: BUG_REPORT_LIMIT }), (req, res) => {
    const parsed = BugReportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid bug report", issues: parsed.error.issues });
      return;
    }
    const report = parsed.data;
    const replay = report.roomId
      ? (registry.get(report.roomId)?.snapshot() ?? stores.getReplay(report.roomId) ?? null)
      : null;
    const id = stores.putBugReport(report, replay);
    logger.info(
      { bugReportId: id, roomId: report.roomId, tick: report.tick, title: report.title },
      "bug report received",
    );
    res.status(201).json({ id, url: Routes.bugReportById(id) });
  });

  app.get("/api/bug-reports/:id", (req, res) => {
    const stored = stores.getBugReport(req.params.id);
    if (!stored) {
      res.status(404).json({ error: "unknown bug report" });
      return;
    }
    res.json(stored);
  });

  app.get(Routes.stats, (_req, res) => {
    res.json({
      process: processStats.snapshot(),
      // In production, ids and codes would let anyone join private rooms or pull their replays.
      rooms: registry.all().map((room) => ({
        ...(env === "production" ? {} : { roomId: room.roomId, code: room.code }),
        players: room.players(),
        connected: room.connected(),
        stats: room.latestStats(),
      })),
    });
  });

  app.post(Routes.joinByCode, express.json({ limit: "1kb" }), (req, res) => {
    const parsed = JoinByCodeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "expected { code }" });
      return;
    }
    const room = registry.byCode(parsed.data.code);
    if (!room) {
      res.status(404).json({ error: "unknown room" });
      return;
    }
    if (room.players() >= room.maxPlayers) {
      res.status(409).json({ error: "room is full" });
      return;
    }
    res.json({ roomId: room.roomId });
  });

  // Body-parser errors (413 too large, 400 bad JSON) as JSON instead of HTML.
  app.use(
    "/api",
    (err: { status?: number; type?: string }, _req: Request, res: Response, next: NextFunction) => {
      if (!err?.status) {
        next(err);
        return;
      }
      res.status(err.status).json({ error: err.type ?? "bad request" });
    },
  );

  return processStats;
}

/** Fixed-window-ish limiter: at most `max` calls per key in any `windowMs`. In memory, per process. */
function rateLimiter(max: number, windowMs: number): (key: string) => boolean {
  const hits = new Map<string, number[]>();
  return (key) => {
    const now = Date.now();
    // Drop expired entries for every key now and then, so the map can't grow without bound.
    if (hits.size > 1_000) {
      for (const [k, times] of hits) if (times.every((t) => now - t >= windowMs)) hits.delete(k);
    }
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    return true;
  };
}
