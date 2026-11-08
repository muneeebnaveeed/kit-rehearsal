import { listen } from "@colyseus/tools";
import { createGameServer, type GameServerOptions } from "./app.config.ts";
import { PORT } from "./env.ts";

export {
  createGameServer,
  createGameServerContext,
  type GameServerContext,
  type GameServerOptions,
  type RoomClass,
  type RoomFactory,
} from "./app.config.ts";
export { APP_ENV, DEBUG_TOOLS, GIT_SHA, PORT } from "./env.ts";
export {
  createGameRoom,
  type GameRoomDeps,
  type LiveRoom,
  LiveRoomRegistry,
  type ReplaySink,
  type RoomLog,
} from "./gameRoom.ts";
export { createLogger, type Logger, roomLogger } from "./logger.ts";
export { MemoryStores, type StoredBugReport } from "./stores.ts";

/** Start the shared game server on $PORT (default 2567). */
export function startGameServer(options: GameServerOptions): ReturnType<typeof listen> {
  return listen(createGameServer(options), PORT);
}
