// `pnpm qa:smoke`: checks that an environment runs a commit and that every game loads, through the gateway.
// CI runs it on production after every merge into main (production-check.yml).
//
//   1. waits until the gateway and every game in GAMES (.railway/railway.ts) answer /health with the
//      right APP_ENV and the commit, or an older one when nothing that service deploys changed since
//   2. opens every game's page in headless Chromium: no page errors or console errors, and when the
//      page has the template's lobby (#create), creating a room works
//
//   --url <url>       the gateway's address (default: $KIT_GATEWAY)
//   --sha <sha>       the commit the environment should run (required)
//   --env <name>      the APP_ENV to expect: production (default), or development / local for a local stack
//   --timeout <s>     how long to wait for the deploys (default 900)
//   --interval <s>    how often to look (default 15)
//   --since <sha>     the commit before this push: when nothing any service deploys changed since, there is no
//                     deploy to wait for, so it passes at once (and writes deployed=false to $GITHUB_OUTPUT)
//   --json            machine-readable output
//
// Exit codes: 0 passed, 1 failed or timed out, 2 usage error, 3 environment problem.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { chromium } from "playwright";
import { GAMES, GATEWAY, GATEWAY_DIR, watchPatterns } from "../../.railway/railway.ts";
import { EXIT, parseArgs } from "../workflow/lib/args.mjs";
import { root } from "../workflow/lib/context.mjs";
import { fetchHealth } from "../workflow/lib/remote.mjs";
import {
  type Health,
  judge,
  overall,
  type PageResult,
  pagesOk,
  redeploys,
  smokeMarkdown,
  type Target,
  type Verdict,
} from "./lib/smoke.ts";

const USAGE =
  "pnpm qa:smoke --sha <sha> [--url <gateway>] [--env <app-env>] [--timeout <s>] [--interval <s>] [--since <sha>] [--json]";
const { flags } = parseArgs(process.argv.slice(2), { boolean: ["json"] });
const str = (name: string) => (typeof flags[name] === "string" ? (flags[name] as string) : null);
const usage = (message: string): never => {
  console.error(`error: ${message}\nusage: ${USAGE}`);
  process.exit(EXIT.usage);
};
const env = str("env") ?? "production";
if (!["production", "development", "local"].includes(env)) usage(`unknown --env "${env}".`);
const sha = (str("sha") ?? usage("give the commit with --sha.")).toLowerCase();
if (!/^[0-9a-f]{7,40}$/.test(sha)) usage(`"${sha}" is not a commit SHA.`);
const url = (str("url") ?? process.env.KIT_GATEWAY)?.replace(/\/+$/, "");
if (!url) {
  console.error("error: no gateway address. Pass --url, or set KIT_GATEWAY.");
  process.exit(EXIT.environment);
}
const seconds = (name: string, fallback: number) => {
  const v = str(name);
  if (v === null) return fallback * 1000;
  if (!/^\d+$/.test(v)) usage(`--${name} takes a number of seconds.`);
  return Number(v) * 1000;
};
const timeoutMs = seconds("timeout", 900);
const intervalMs = seconds("interval", 15);

const targets: Target[] = [
  { service: GATEWAY, path: "", watch: watchPatterns(GATEWAY_DIR) },
  ...GAMES.map((g) => ({ service: g.service, path: `/${g.service}`, watch: watchPatterns(g.dir) })),
];

/** Files changed between a deployed commit and the release, or null when git doesn't know the commit. */
const changedSince = (from: string): string[] | null => {
  try {
    return execFileSync("git", ["diff", "--name-only", `${from}..${sha}`], { cwd: root, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
  } catch {
    return null;
  }
};

const look = async (): Promise<Verdict[]> =>
  Promise.all(
    targets.map(async (target) => {
      const r = (await fetchHealth(`${url}${target.path}`)) as { health?: Health; error?: string };
      const health = r.health ?? null;
      const changed = health && !sha.startsWith(health.sha) ? changedSince(health.sha) : [];
      return judge({ target, env, sha, health, error: r.error ?? null, changed });
    }),
  );

const output = (line: string) => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`);
};
const since = str("since");
if (since && !/^0+$/.test(since)) {
  const changed = changedSince(since);
  // null: git doesn't know the commit (a force push, a shallow clone), so check as if everything deployed.
  if (changed && !targets.some((t) => redeploys(changed, t.watch))) {
    output("deployed=false");
    console.log(`Nothing any service deploys changed since ${since.slice(0, 7)}: no deploy to check.`);
    process.exit(EXIT.ok);
  }
}
output("deployed=true");

const log = (line: string) => {
  if (!flags.json) console.error(line);
};
const started = Date.now();
let verdicts = await look();
while (overall(verdicts) === "pending" && Date.now() - started < timeoutMs) {
  const waiting = verdicts.filter((v) => v.state !== "ok").map((v) => `${v.service} (${v.message})`);
  log(`Waiting ${Math.round((Date.now() - started) / 1000)}s: ${waiting.join(", ")}`);
  await new Promise((r) => setTimeout(r, intervalMs));
  verdicts = await look();
}

const pages: PageResult[] = [];
if (overall(verdicts) === "ok") {
  const browser = await chromium.launch();
  for (const target of targets.filter((t) => t.path !== "")) {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(`page error: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console error: ${msg.text()}`);
    });
    let room: PageResult["room"] = "no lobby";
    try {
      const response = await page.goto(`${url}${target.path}/`, { waitUntil: "load", timeout: 30_000 });
      if (!response || response.status() >= 400)
        errors.push(`page answered HTTP ${response?.status() ?? "nothing"}`);
      await page.waitForTimeout(3_000);
      if (await page.$("#create")) {
        await page.click("#create");
        room = (await page.waitForSelector("#view", { timeout: 15_000 }).catch(() => null))
          ? "created"
          : "failed";
      }
    } catch (err) {
      errors.push((err as Error).message.split("\n")[0] ?? "page did not load");
    }
    pages.push({ service: target.service, errors, room });
    await page.close();
  }
  await browser.close();
}

const state = overall(verdicts);
const passed = state === "ok" && pagesOk(pages);
const markdown = smokeMarkdown({ url, env, sha, verdicts, pages });
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
if (flags.json) console.log(JSON.stringify({ passed, state, url, env, sha, verdicts, pages }, null, 2));
else
  process.stdout.write(markdown + (state === "pending" ? `\nTimed out after ${timeoutMs / 1000}s.\n` : ""));
process.exit(passed ? EXIT.ok : EXIT.failed);
