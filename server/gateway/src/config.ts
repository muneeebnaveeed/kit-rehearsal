import { type AppEnv, AppEnvSchema } from "@kit/core/shared";

/** A game's name is its first path segment and its private hostname on Railway, so keep it URL- and DNS-safe. */
const GAME_NAME = /^[a-z0-9][a-z0-9-]*$/;

export interface GatewayConfig {
  /** The games deployed in this environment. `/<game>/` is proxied to each. */
  games: readonly string[];
  /** Games planned but not released yet: listed on the index page, not routed. */
  planned: readonly string[];
  /** Base URL of a game's service, without a trailing slash. */
  upstream: (game: string) => string;
  env: AppEnv;
  sha: string;
  /** ISO time the gateway started, reported by /health. */
  startedAt: string;
}

export interface GatewayRuntime extends GatewayConfig {
  port: number;
}

function list(name: string, value: string | undefined): string[] {
  const items = (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const item of items) {
    if (!GAME_NAME.test(item))
      throw new Error(`${name}: "${item}" is not a valid game name (a-z, 0-9 and -).`);
  }
  return [...new Set(items)];
}

/** `UPSTREAMS="team-2=http://127.0.0.1:2601,team-4=http://127.0.0.1:2602"`, for running the gateway locally. */
function parseUpstreams(value: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const eq = entry.indexOf("=");
    const game = entry.slice(0, eq);
    const url = entry.slice(eq + 1);
    if (eq === -1 || !GAME_NAME.test(game))
      throw new Error(`UPSTREAMS: expected "<game>=<url>", got "${entry}".`);
    try {
      new URL(url);
    } catch {
      throw new Error(`UPSTREAMS: "${url}" is not a URL.`);
    }
    map.set(game, url.replace(/\/+$/, ""));
  }
  return map;
}

/**
 * Reads the gateway's configuration from the environment.
 *   GAMES          the deployed games, e.g. "team-2,team-4" (Railway's config sets it from its own list)
 *   PLANNED_GAMES  games not released yet, shown on the index page
 *   UPSTREAM_PORT  port of the game services on Railway's private network (default 8080)
 *   UPSTREAMS      "<game>=<url>,..." overrides where a game is, for local runs; GAMES defaults to its names
 *   PORT, APP_ENV, RAILWAY_GIT_COMMIT_SHA (or GIT_SHA)  as for the games
 */
export function readConfig(env: NodeJS.ProcessEnv = process.env): GatewayRuntime {
  const overrides = parseUpstreams(env.UPSTREAMS);
  const games = env.GAMES ? list("GAMES", env.GAMES) : [...overrides.keys()];
  if (games.length === 0) throw new Error("GAMES is empty: the gateway has nothing to serve.");

  const upstreamPort = Number(env.UPSTREAM_PORT ?? 8080);
  if (!Number.isInteger(upstreamPort) || upstreamPort < 1 || upstreamPort > 65535) {
    throw new Error(`UPSTREAM_PORT must be a port number (got "${env.UPSTREAM_PORT}").`);
  }
  const missing = games.filter((g) => !overrides.has(g));
  if (overrides.size > 0 && missing.length > 0) {
    throw new Error(`UPSTREAMS has no address for: ${missing.join(", ")}.`);
  }

  const port = Number(env.PORT ?? 2570);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error(`PORT must be a port number (got "${env.PORT}").`);

  return {
    port,
    games,
    planned: list("PLANNED_GAMES", env.PLANNED_GAMES).filter((g) => !games.includes(g)),
    upstream: (game) => overrides.get(game) ?? `http://${game}.railway.internal:${upstreamPort}`,
    env: AppEnvSchema.catch("local").parse(env.APP_ENV),
    sha: env.RAILWAY_GIT_COMMIT_SHA ?? env.GIT_SHA ?? "dev",
    startedAt: new Date().toISOString(),
  };
}
