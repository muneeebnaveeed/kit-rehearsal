// Rules for `pnpm env:status` and `pnpm env:wait`: the Railway environment, where to reach it, and
// how its `/health` (HealthResponse in server/core/src/shared/env.ts) compares with the branch they
// deploys. Pure: the commands fetch and pass the results in.

/**
 * Railway environment -> the branch it deploys and the APP_ENV its /health reports. Must match
 * ENVIRONMENTS in .railway/railway.ts (env.test.ts checks it). The gateway's address isn't in the repo,
 * so it comes from a flag or an environment variable.
 */
export const ENVIRONMENTS = {
  production: { branch: "main", appEnv: "production", variable: "KIT_GATEWAY", flag: "url" },
};

/**
 * @param {string} name production
 * @param {{ flags: Record<string, string | true>, env: Record<string, string | undefined> }} sources
 * @returns {{ url: string, error?: undefined } | { error: string, url?: undefined }}
 */
export function envUrl(name, { flags, env }) {
  const { variable, flag } = ENVIRONMENTS[name];
  const raw = typeof flags[flag] === "string" ? flags[flag] : env[variable];
  if (!raw) {
    return {
      error: `No URL for the ${name} environment. Set ${variable} to the gateway's address (e.g. ${variable}=https://<gateway>.up.railway.app) or pass --${flag} <url>.`,
    };
  }
  if (!/^https?:\/\/[^/\s]+/.test(raw)) {
    return { error: `The ${name} URL "${raw}" must start with http:// or https://.` };
  }
  return { url: raw.replace(/\/+$/, "") };
}

/**
 * @param {unknown} data the parsed JSON of /health
 * @returns {{ health: { ok: true, env: string, sha: string }, error?: undefined } | { error: string, health?: undefined }}
 */
export function parseHealth(data) {
  if (!data || typeof data !== "object") return { error: "/health did not return a JSON object." };
  const h = /** @type {Record<string, unknown>} */ (data);
  if (typeof h.sha !== "string" || typeof h.env !== "string") {
    return { error: "/health has no sha or env; is this a game server from server/host?" };
  }
  if (h.ok !== true) return { error: `/health reports ok: ${JSON.stringify(h.ok)}.` };
  return { health: /** @type {any} */ (h) };
}

/** A reported SHA matches an expected one if one starts with the other and both have 7+ characters. */
export function shaMatches(reported, expected) {
  const a = String(reported).toLowerCase();
  const b = String(expected).toLowerCase();
  if (a.length < 7 || b.length < 7 || !/^[0-9a-f]+$/.test(a) || !/^[0-9a-f]+$/.test(b)) return false;
  return a.startsWith(b) || b.startsWith(a);
}

/**
 * @param {{ name: string, health?: { env: string, sha: string }, error?: string, expectedSha: string }} input
 * @returns {import("./report.mjs").Problem[]}
 */
export function compareHealth({ name, health, error, expectedSha }) {
  const { branch, appEnv } = ENVIRONMENTS[name];
  if (error || !health) {
    return [{ rule: "unreachable", message: `${name}: ${error ?? "no response"}` }];
  }
  const problems = [];
  if (health.env !== appEnv) {
    problems.push({
      rule: "app-env",
      message: `${name}: /health reports APP_ENV ${health.env}, not ${appEnv}. Is the URL right?`,
    });
  }
  if (!shaMatches(health.sha, expectedSha)) {
    problems.push({
      rule: "sha",
      message: `${name} runs ${health.sha === "dev" ? "an unknown commit (sha: dev)" : health.sha.slice(0, 7)}, but ${branch} is at ${expectedSha.slice(0, 7)}.`,
      fix: `A deploy may still be running: pnpm env:wait ${expectedSha.slice(0, 7)}. Otherwise check the deploy in Railway.`,
    });
  }
  return problems;
}
