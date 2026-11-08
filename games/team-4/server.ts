/** Entry point for this game's server: `pnpm dev:server` locally, `pnpm start` on Railway. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startGameServer } from "@kit/host";
import { rooms } from "./room/index.ts";
import { GAME_ID } from "./shared/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

void startGameServer({ gameId: GAME_ID, rooms, clientDist: path.join(here, "dist") });
