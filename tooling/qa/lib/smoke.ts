// The rules behind `pnpm qa:smoke`: whether an environment runs a commit, service by service, and how
// to report it. No I/O here, so it is tested without Railway.
import { globToRegExp } from "../../workflow/lib/glob.mjs";

/** One deployed service: the gateway or a game, with the folder whose changes redeploy it. */
export interface Target {
  service: string;
  /** Path on the gateway: "" for the gateway itself, else "/<service>". */
  path: string;
  watch: string[];
}

export interface Health {
  ok: boolean;
  env: string;
  sha: string;
}

export type State = "ok" | "pending" | "failed";

export interface Verdict {
  service: string;
  state: State;
  message: string;
}

/**
 * Whether a change to these files redeploys a service, with Railway's watch patterns: a file counts
 * when it matches a pattern and no later "!" pattern excludes it. Patterns start at the repo root ("/").
 */
export function redeploys(files: string[], patterns: string[]): boolean {
  return files.some((file) => {
    let hit = false;
    for (const pattern of patterns) {
      const negated = pattern.startsWith("!");
      const glob = (negated ? pattern.slice(1) : pattern).replace(/^\//, "");
      if (globToRegExp(glob).test(file)) hit = !negated;
    }
    return hit;
  });
}

/**
 * One service's verdict. A service only redeploys when its watched files change, so an older SHA is
 * fine when nothing it watches changed between that SHA and the release (`changed` lists the files;
 * null when the older commit isn't known locally).
 */
export function judge(input: {
  target: Target;
  env: string;
  sha: string;
  health: Health | null;
  error: string | null;
  changed: string[] | null;
}): Verdict {
  const { target, env, sha, health, error, changed } = input;
  const service = target.service;
  if (!health) return { service, state: "pending", message: error ?? "no answer yet" };
  if (health.env !== env) {
    return { service, state: "failed", message: `reports APP_ENV ${health.env}, expected ${env}` };
  }
  if (!health.ok) return { service, state: "pending", message: "/health is not ok yet" };
  if (sha.startsWith(health.sha) || health.sha.startsWith(sha)) {
    return { service, state: "ok", message: `runs ${sha.slice(0, 7)}` };
  }
  if (changed === null) {
    return {
      service,
      state: "pending",
      message: `runs ${health.sha.slice(0, 7)}, which is not in this history`,
    };
  }
  if (redeploys(changed, target.watch)) {
    return {
      service,
      state: "pending",
      message: `runs ${health.sha.slice(0, 7)}; waiting for the deploy of ${sha.slice(0, 7)}`,
    };
  }
  return {
    service,
    state: "ok",
    message: `runs ${health.sha.slice(0, 7)}; nothing it deploys changed up to ${sha.slice(0, 7)}`,
  };
}

/** All services are judged: done when every one is ok, stopped when one failed. */
export function overall(verdicts: Verdict[]): State {
  if (verdicts.some((v) => v.state === "failed")) return "failed";
  return verdicts.every((v) => v.state === "ok") ? "ok" : "pending";
}

export interface PageResult {
  service: string;
  errors: string[];
  room: "created" | "no lobby" | "failed";
}

/** The Markdown summary: one row per service, then the page errors, if any. */
export function smokeMarkdown(opts: {
  url: string;
  env: string;
  sha: string;
  verdicts: Verdict[];
  pages: PageResult[];
}) {
  const { url, env, sha, verdicts, pages } = opts;
  const lines = [
    `# Smoke test: ${env} at ${sha.slice(0, 7)}`,
    "",
    url,
    "",
    "| Service | Deploy | Page | Room |",
    "|---|---|---|---|",
  ];
  for (const v of verdicts) {
    const page = pages.find((p) => p.service === v.service);
    const pageCell = !page ? "-" : page.errors.length === 0 ? "ok" : `${page.errors.length} error(s)`;
    lines.push(`| ${v.service} | ${v.state}: ${v.message} | ${pageCell} | ${page?.room ?? "-"} |`);
  }
  for (const page of pages.filter((p) => p.errors.length > 0)) {
    lines.push("", `## ${page.service}`, "", ...page.errors.map((e) => `- ${e}`));
  }
  return `${lines.join("\n")}\n`;
}

/** Page checks pass when no page threw or logged an error and no lobby failed to create a room. */
export function pagesOk(pages: PageResult[]): boolean {
  return pages.every((p) => p.errors.length === 0 && p.room !== "failed");
}
