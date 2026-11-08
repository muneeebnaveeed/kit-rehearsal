/**
 * Server rooms for this game. Each entry builds a Room class from the host's shared deps;
 * the host registers them by name. Clients create or join "game".
 */
import { createGameRoom, type RoomFactory } from "@kit/host";
import { templateGame } from "../shared/game.ts";

export const rooms: Record<string, RoomFactory> = {
  game: (deps) => createGameRoom(templateGame, deps),
};
