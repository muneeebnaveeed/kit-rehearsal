import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { HealthResponse } from "@kit/core/shared";
import { createProxyServer } from "http-proxy-3";
import type { GatewayConfig } from "./config.ts";
import { indexPage, notFoundPage, unavailablePage } from "./pages.ts";

/** What to do with a request, decided from its URL alone. */
export type Route =
  | { kind: "index" }
  | { kind: "health" }
  | { kind: "redirect"; location: string }
  | { kind: "proxy"; game: string; url: string }
  | { kind: "notfound"; game?: string };

/**
 * `/` is the index, `/health` the gateway's own health, `/<game>` redirects to `/<game>/`, and `/<game>/rest`
 * is proxied to that game as `/rest`: the first path segment picks the game and is removed, so the game
 * itself never knows it lives under a prefix. Anything else is not found.
 */
export function route(rawUrl: string, games: readonly string[]): Route {
  const q = rawUrl.indexOf("?");
  const path = q === -1 ? rawUrl : rawUrl.slice(0, q);
  const search = q === -1 ? "" : rawUrl.slice(q);
  if (path === "/") return { kind: "index" };
  if (path === "/health") return { kind: "health" };
  const m = /^\/([^/]+)(\/.*)?$/.exec(path);
  if (!m) return { kind: "notfound" };
  const [, game = "", rest] = m;
  if (!games.includes(game)) return { kind: "notfound", game };
  if (rest === undefined) return { kind: "redirect", location: `/${game}/${search}` };
  return { kind: "proxy", game, url: rest + search };
}

/** How long a game may stay silent on an HTTP request before the gateway answers 502 itself. */
export const UPSTREAM_TIMEOUT_MS = 30_000;

export interface GatewayOptions {
  /** One structured log line per problem. Defaults to JSON on stdout. */
  log?: (fields: Record<string, unknown>) => void;
  /** Idle time before a game's HTTP response is given up on (not applied to WebSockets). Default 30 s. */
  upstreamTimeoutMs?: number;
}

const HTML = { "content-type": "text/html; charset=utf-8" };

/**
 * The public face of an environment: one address, one path per game. Each game keeps running as its own
 * service on Railway's private network, so a crash in one game never takes the others down.
 */
export function createGateway(config: GatewayConfig, options: GatewayOptions = {}): Server {
  const log = options.log ?? ((fields) => console.log(JSON.stringify(fields)));
  const upstreamTimeoutMs = options.upstreamTimeoutMs ?? UPSTREAM_TIMEOUT_MS;
  const gameOf = new WeakMap<object, string>();

  // No xfwd: X-Forwarded-For/-Proto/-Host go to the game exactly as Railway's edge set them. The game trusts
  // one proxy and reads the last X-Forwarded-For entry, which is the edge's view of the player. Appending the
  // gateway's own peer address would push that entry one step left and break the game's per-IP limits.
  const proxy = createProxyServer();
  proxy.on("error", (err, req, res) => {
    const game = gameOf.get(req) ?? "unknown";
    log({ level: "error", msg: "upstream error", game, err: err.message });
    if ("writeHead" in res) {
      if (!res.headersSent) {
        res.writeHead(502, HTML);
        res.end(unavailablePage(game));
      } else {
        res.destroy();
      }
    } else if (res.bytesWritten === 0) {
      // A WebSocket upgrade that never got through: say 502, so the client can tell "game down" from a
      // network drop, the same way the 404 for an unknown game does. After the handshake the socket is
      // carrying WebSocket frames and must just be closed.
      res.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
    } else {
      res.destroy();
    }
  });

  const send = (res: ServerResponse, status: number, headers: Record<string, string>, body: string) => {
    res.writeHead(status, headers);
    res.end(body);
  };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const r = route(req.url ?? "/", config.games);
    switch (r.kind) {
      case "index":
      case "health": {
        if (req.method !== "GET" && req.method !== "HEAD") {
          send(res, 405, { allow: "GET, HEAD" }, "");
          return;
        }
        if (r.kind === "index") {
          send(res, 200, HTML, indexPage(config.games, config.planned));
          return;
        }
        const body: HealthResponse = {
          ok: true,
          env: config.env,
          // The gateway has no debug tools; each game's /health reports its own.
          debug: false,
          sha: config.sha,
          startedAt: config.startedAt,
          games: [...config.games],
        };
        send(res, 200, { "content-type": "application/json" }, JSON.stringify(body));
        return;
      }
      case "redirect":
        // 308 keeps the method, so a POST to /team-2 is not turned into a GET.
        send(res, 308, { location: r.location }, "");
        return;
      case "notfound":
        send(res, 404, HTML, notFoundPage(r.game, config.games));
        return;
      case "proxy":
        gameOf.set(req, r.game);
        req.url = r.url;
        // The timeout is for plain requests only: a WebSocket stays open, silent or not, for a whole game.
        proxy.web(req, res, { target: config.upstream(r.game), proxyTimeout: upstreamTimeoutMs });
    }
  });

  // WebSockets: Colyseus connects to /<game>/<processId>/<roomId>, so the same route applies.
  server.on("upgrade", (req, socket, head) => {
    const r = route(req.url ?? "/", config.games);
    socket.on("error", () => {});
    if (r.kind !== "proxy") {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    gameOf.set(req, r.game);
    req.url = r.url;
    proxy.ws(req, socket as Socket, head, { target: config.upstream(r.game) });
  });

  // Railway's edge reuses connections; a keep-alive shorter than its own makes it hit a closed socket and 502.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  return server;
}
