import { z } from "zod";

/**
 * Where a build is running. Railway sets APP_ENV per environment; PR environments
 * inherit "development". "local" is a laptop running `pnpm dev`.
 */
export const APP_ENVS = ["local", "development", "staging", "production"] as const;
export const AppEnvSchema = z.enum(APP_ENVS);
export type AppEnv = z.infer<typeof AppEnvSchema>;

/** The value of DEBUG_TOOLS that turns the debug tools on in production. */
export const DEBUG_TOOLS_ON = "on";

/** DEBUG_TOOLS is set per game service on Railway; anything but "on" leaves it off. */
export function parseDebugTools(raw: string | undefined): boolean {
  return raw?.trim().toLowerCase() === DEBUG_TOOLS_ON;
}

/**
 * Debug commands, the state inspector and test hooks are on everywhere except production, and in
 * production too when the game's DEBUG_TOOLS is on (one hosted game during the event's testing).
 */
export function isDebugEnabled(env: AppEnv, debugTools = false): boolean {
  return debugTools || env !== "production";
}

/** Response of `GET /health`. Scripts (`env:wait`, `env:status`) and smoke tests read this. */
export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  env: AppEnvSchema,
  /** Whether this server accepts debug commands. Clients show their debug tools only when it is true. */
  debug: z.boolean(),
  /** Git commit SHA of the running build ("dev" when unknown). */
  sha: z.string(),
  /** ISO timestamp of when this server process started. */
  startedAt: z.string(),
  /** Game ids this server hosts, e.g. ["sample"]. */
  games: z.array(z.string()),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
