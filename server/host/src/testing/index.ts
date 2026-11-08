/**
 * Test helpers for room tests in every game: `import { boot } from "@kit/host/testing"`.
 * Re-exported from the host so tests use the host's single copy of the Colyseus runtime.
 */
import { createServer } from "node:net";
import { type ColyseusTestServer, boot as colyseusBoot } from "@colyseus/testing";
import type { ConfigOptions } from "@colyseus/tools";

export type { ColyseusTestServer } from "@colyseus/testing";
export { captureLog, type LogLine } from "./captureLog.ts";

/** A TCP port nothing is listening on right now, picked by the operating system. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address ? resolve(address.port) : reject(new Error("no port")),
      );
    });
  });
}

/**
 * Boots a game server for room tests. Without a port it picks a free one, so test files, worktrees and
 * agents running at the same time never collide. (`@colyseus/testing` builds its client URL from the
 * number you pass, so port 0 can't be used directly.)
 */
export async function boot(
  // biome-ignore lint/suspicious/noExplicitAny: room definitions and routes vary per game.
  config: ConfigOptions<any, any>,
  port?: number,
): Promise<ColyseusTestServer> {
  return colyseusBoot(config, port ?? (await freePort()));
}
