/**
 * Railway infrastructure for the hackathon: one project, one environment, one service per game plus the gateway.
 *
 *   production   deploys `main`: a promotion from feature/team-N is a deploy
 *
 * The gateway is the only service with a public domain. It serves every game at `<address>/<game>` and
 * reaches each one over Railway's private network, so all teams run side by side from the same branch.
 *
 * Change it through a reviewed platform PR that includes the `railway config plan` output, then apply from an up-to-date `main` (see "Railway" in server/ARCHITECTURE.md).
 * Anything missing from this file is DELETED on apply. The rules are in "Deploying to Railway" in CLAUDE.md.
 *
 * The Railway CLI runs this file with `node --experimental-strip-types`: keep it erasable TypeScript
 * (no enums, no namespaces) and import only Node built-ins and `railway/iac`.
 */
import { existsSync, readFileSync } from "node:fs";
import { defineRailway, github, project, service } from "railway/iac";

/** The repository and project name, set once per hackathon in kit.json. */
const KIT: { repo: string; railwayProject: string } = JSON.parse(
  readFileSync(new URL("../kit.json", import.meta.url), "utf8"),
);
const REPO = KIT.repo;
const PROJECT = KIT.railwayProject;

/** Every service runs in one EU region, close to the players. */
export const REGION = "europe-west4";

/** The server listens on $PORT. Fixed, so a domain can target it: `railway domain --port 8080`. */
export const PORT = "8080";

/** Railway environment → the branch it deploys and the APP_ENV the code (and /health) sees. */
export const ENVIRONMENTS = {
  production: { branch: "main", appEnv: "production" },
} as const;

export type EnvironmentName = keyof typeof ENVIRONMENTS;

interface Game {
  /** Railway service name. */
  service: string;
  /** Folder of the game package, relative to the repo root. Holds `server.ts`. */
  dir: string;
  /** Package name, for `pnpm --filter`. */
  package: string;
  /**
   * Sets DEBUG_TOOLS=on: debug commands, the state inspector and F8 reports on this game only, in production.
   * For the event's testing; remove it before judging or a demo, because debug commands change game state.
   */
  debug?: true;
}

/**
 * One service per game. Add a team's game here, in a platform PR, once its package is on `main`
 * (e.g. `{ service: "team-2", dir: "games/team-2", package: "@team-2/game" }`). Add `debug: true` to
 * turn the debug tools on for that game alone (see "Debug tools on Railway" in server/ARCHITECTURE.md).
 */
export const GAMES: readonly Game[] = [
  { service: "template", dir: "server/template", package: "@kit/template" },
  { service: "team-1", dir: "games/team-1", package: "@team-1/game" },
  { service: "team-2", dir: "games/team-2", package: "@team-2/game" },
  { service: "team-3", dir: "games/team-3", package: "@team-3/game" },
  { service: "team-4", dir: "games/team-4", package: "@team-4/game" },
];

/** Teams that get a path on the gateway even before their game is in `GAMES` (the index lists them as "not released yet"). */
const TEAMS = ["team-1", "team-2", "team-3", "team-4"];

/** Railway service name of the gateway. */
export const GATEWAY = "gateway";

/** Names a game cannot have: the gateway's own service, and the one path it answers itself (`/health`). */
const RESERVED = [GATEWAY, "health"];

/** Platform files every game runs on: a change here redeploys every game. */
export const PLATFORM_WATCH = [
  "/server/core/**",
  "/server/host/**",
  "/tooling/tsconfig.base.json",
  "/tooling/check-node.mjs",
  "/package.json",
  "/pnpm-lock.yaml",
  "/pnpm-workspace.yaml",
  "/.nvmrc",
];

/** Gitignore-style negations: docs and tests never trigger a deploy. Keep these last. */
export const NEVER_WATCH = ["!**/*.md", "!**/*.test.ts"];

/** Folder of the gateway package. */
export const GATEWAY_DIR = "server/gateway";

/** The files whose change redeploys the service in `dir`; the smoke check reads the same list. */
export function watchPatterns(dir: string): string[] {
  return [`/${dir}/**`, ...PLATFORM_WATCH, ...NEVER_WATCH];
}

/** Fail the plan early, with a clear message, instead of deploying a service that can't start. */
export function checkGame(game: Game): Game {
  if (RESERVED.includes(game.service)) {
    throw new Error(
      `Game "${game.service}": the name is reserved (${RESERVED.join(", ")}): the gateway uses it for itself.`,
    );
  }
  const dir = new URL(`../${game.dir}/`, import.meta.url);
  const pkgFile = new URL("package.json", dir);
  if (!existsSync(pkgFile) || !existsSync(new URL("server.ts", dir))) {
    throw new Error(`Game "${game.service}": ${game.dir} needs a package.json and a server.ts.`);
  }
  const pkg = JSON.parse(readFileSync(pkgFile, "utf8")) as {
    name?: string;
    scripts?: Record<string, string>;
  };
  if (pkg.name !== game.package) {
    throw new Error(
      `Game "${game.service}": ${game.dir}/package.json is "${pkg.name}", not "${game.package}".`,
    );
  }
  if (!pkg.scripts?.build) throw new Error(`Game "${game.service}": ${game.package} has no "build" script.`);
  return game;
}

/** The variables of a game's service. DEBUG_TOOLS is absent unless asked for, so apply removes it again. */
export function gameVariables(
  game: Game,
  env: (typeof ENVIRONMENTS)[EnvironmentName],
): Record<string, string> {
  return {
    APP_ENV: env.appEnv,
    PORT,
    LOG_LEVEL: "info",
    ...(game.debug ? { DEBUG_TOOLS: "on" } : {}),
  };
}

function gameService(game: Game, env: (typeof ENVIRONMENTS)[EnvironmentName]) {
  return service(game.service, {
    // Wait for CI: a commit deploys only after every GitHub check suite on it has passed.
    source: github(REPO, { branch: env.branch, checkSuites: true }),
    build: {
      builder: "RAILPACK",
      // Railpack runs `pnpm install --frozen-lockfile` first (dev dependencies included, so tsx is there).
      buildCommand: `pnpm --filter ${game.package} build`,
      watchPatterns: watchPatterns(game.dir),
    },
    // Node runs the server directly (no pnpm in between), so Railway's SIGTERM reaches it and players
    // get the "Server restarting" notice before the rooms close.
    start: `node --import tsx ${game.dir}/server.ts`,
    healthcheck: "/health",
    healthcheckTimeout: 60,
    // Exactly one replica: rooms, room codes and replays live in this process's memory.
    replicas: { [REGION]: 1 },
    deploy: {
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 5,
      // Railway's default is 0 s between SIGTERM and SIGKILL; give the rooms time to close cleanly.
      drainingSeconds: 15,
      // Never sleep: an idle service would drop every open WebSocket.
      sleepApplication: false,
    },
    env: gameVariables(game, env),
  });
}

/** The public front: `<address>/<game>/` goes to that game's service, WebSockets included. */
function gatewayService(env: (typeof ENVIRONMENTS)[EnvironmentName]) {
  const dir = GATEWAY_DIR;
  const pkgFile = new URL(`../${dir}/package.json`, import.meta.url);
  if (!existsSync(pkgFile) || !existsSync(new URL(`../${dir}/server.ts`, import.meta.url))) {
    throw new Error(`The gateway: ${dir} needs a package.json and a server.ts.`);
  }
  const games = GAMES.map((game) => game.service);
  return service(GATEWAY, {
    source: github(REPO, { branch: env.branch, checkSuites: true }),
    build: {
      builder: "RAILPACK",
      // Nothing to bundle: the gateway runs from source. The build step only fails the deploy on a type error.
      buildCommand: "pnpm --filter @kit/gateway typecheck",
      watchPatterns: watchPatterns(dir),
    },
    start: `node --import tsx ${dir}/server.ts`,
    healthcheck: "/health",
    healthcheckTimeout: 60,
    // One replica ("Keep it small" in CLAUDE.md). The gateway keeps no state, so adding one later is safe.
    replicas: { [REGION]: 1 },
    deploy: {
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 5,
      drainingSeconds: 15,
      sleepApplication: false,
    },
    env: {
      APP_ENV: env.appEnv,
      PORT,
      // The games' port is the one they listen on (PORT above): one value, so changing it cannot leave the
      // gateway calling a port nobody listens on.
      UPSTREAM_PORT: PORT,
      GAMES: games.join(","),
      PLANNED_GAMES: TEAMS.filter((team) => !games.includes(team)).join(","),
    },
  });
}

export default defineRailway((ctx) => {
  const name = ctx.environment ?? "";
  if (!Object.hasOwn(ENVIRONMENTS, name)) {
    throw new Error(
      `This file manages the environment ${Object.keys(ENVIRONMENTS).join(" and ")}, not "${name}". ` +
        "Link it with `railway link` or pass `--environment`.",
    );
  }
  const env = ENVIRONMENTS[name as EnvironmentName];
  return project(PROJECT, {
    resources: [gatewayService(env), ...GAMES.map((game) => gameService(checkGame(game), env))],
  });
});
