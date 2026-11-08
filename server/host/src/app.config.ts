/**
 * Colyseus + Express host shared by every game. A team's game calls `startGameServer()` from
 * its own server.ts, so all games get the same /health, logging and static hosting.
 * Owner: platform team.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { monitor } from "@colyseus/monitor";
import config from "@colyseus/tools";
import { type HealthResponse, isDebugEnabled, Routes } from "@kit/core/shared";
import express from "express";
import { APP_ENV, DEBUG_TOOLS, GIT_SHA, STARTED_AT } from "./env.ts";
import { type GameRoomDeps, LiveRoomRegistry, type RoomClass, type RoomLog } from "./gameRoom.ts";
import { createLogger } from "./logger.ts";
import type { ProcessStats } from "./processStats.ts";
import { registerRoutes } from "./routes.ts";
import { MemoryStores } from "./stores.ts";

export type { RoomClass } from "./gameRoom.ts";

/** Builds a game's Room class from the shared deps, e.g. `(deps) => createGameRoom(myGame, deps)`. */
export type RoomFactory = (deps: GameRoomDeps) => RoomClass;

const MB = 1024 * 1024;
const PROCESS_STATS_INTERVAL_MS = 10_000;

export interface GameServerOptions {
  /** Game id, e.g. "team-2". Reported by /health. */
  gameId: string;
  /** Room name → room factory. Clients join with `client.joinOrCreate(name)` or by code. */
  rooms?: Record<string, RoomFactory>;
  /** Folder with the built client (vite build output). Served at the site root when it exists. */
  clientDist?: string;
}

/** Shared per-process services: logger, stores and the live room registry. */
export interface GameServerContext {
  logger: RoomLog;
  stores: MemoryStores;
  registry: LiveRoomRegistry;
  deps: GameRoomDeps;
}

export function createGameServerContext(
  gameId: string,
  logger: RoomLog = createLogger(gameId),
): GameServerContext {
  const stores = new MemoryStores({ budgetBytes: Number(process.env.MEMORY_BUDGET_MB ?? 256) * MB });
  const registry = new LiveRoomRegistry();
  return {
    logger,
    stores,
    registry,
    deps: { env: APP_ENV, debugTools: DEBUG_TOOLS, sha: GIT_SHA, stores, logger, registry },
  };
}

export function createGameServer(
  options: GameServerOptions,
  context: GameServerContext = createGameServerContext(options.gameId),
): ReturnType<typeof config> {
  const { gameId, rooms = {}, clientDist } = options;
  const { env } = context.deps;
  const debug = isDebugEnabled(env, context.deps.debugTools);
  let processStats: ProcessStats | undefined;
  let statsTimer: NodeJS.Timeout | undefined;

  return config({
    options: { gracefullyShutdown: true },

    beforeListen: () => {
      watchProcess(context);
      statsTimer = setInterval(() => {
        if (!processStats) return;
        context.logger.info(processStats.snapshot(), "process.stats");
        processStats.reset();
      }, PROCESS_STATS_INTERVAL_MS);
      statsTimer.unref();
    },

    initializeGameServer: (gameServer) => {
      for (const [name, factory] of Object.entries(rooms)) {
        gameServer.define(name, factory(context.deps));
      }
    },

    initializeExpress: (app) => {
      // Local dev only: the Vite dev server runs on another port.
      if (env === "local") {
        app.use((req, res, next) => {
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Access-Control-Allow-Headers", "content-type");
          res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
          if (req.method === "OPTIONS") {
            res.sendStatus(204);
            return;
          }
          next();
        });
      }

      processStats = registerRoutes(app, {
        env,
        stores: context.stores,
        registry: context.registry,
        gameId,
        logger: context.logger,
      });
      if (debug) app.use("/colyseus", monitor());

      app.get(Routes.health, (_req, res) => {
        const body: HealthResponse = {
          ok: true,
          env,
          debug,
          sha: GIT_SHA,
          startedAt: STARTED_AT,
          games: [gameId],
        };
        res.json(body);
      });

      if (clientDist && existsSync(clientDist)) {
        app.use(express.static(clientDist));
        // Single-page app fallback for every path that isn't the API or health check.
        app.get(/^\/(?!api\/|health$|colyseus).*/, (_req, res) =>
          res.sendFile(path.join(clientDist, "index.html")),
        );
      }
    },
  });
}

let watching = false;

/** Process-level hooks, registered once: restart notices on SIGTERM and logs for crashes. */
function watchProcess(context: GameServerContext): void {
  if (watching) return;
  watching = true;
  // Colyseus closes the rooms itself on SIGTERM (gracefullyShutdown); tell players first.
  process.once("SIGTERM", () => {
    context.logger.info({ rooms: context.registry.all().length }, "server restarting");
    for (const room of context.registry.all()) room.notify({ level: "warn", text: "Server restarting" });
  });
  process.on("unhandledRejection", (err) => context.logger.error({ err }, "unhandled rejection"));
  process.on("uncaughtException", (err) => {
    context.logger.error({ err }, "uncaught exception");
    process.exit(1);
  });
}
