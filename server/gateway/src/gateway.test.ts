import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { createGateway, type GatewayConfig, readConfig, route } from "./index.ts";
import { indexPage } from "./pages.ts";

const games = ["team-2", "team-4"] as const;

describe("route", () => {
  it.each([
    ["/", { kind: "index" }],
    ["/health", { kind: "health" }],
    ["/team-2", { kind: "redirect", location: "/team-2/" }],
    ["/team-2?room=ABCD", { kind: "redirect", location: "/team-2/?room=ABCD" }],
    ["/team-2/", { kind: "proxy", game: "team-2", url: "/" }],
    ["/team-2/api/stats?x=1", { kind: "proxy", game: "team-2", url: "/api/stats?x=1" }],
    ["/team-4/abc/def?sessionId=s", { kind: "proxy", game: "team-4", url: "/abc/def?sessionId=s" }],
    ["/team-2/health", { kind: "proxy", game: "team-2", url: "/health" }],
    ["/team-9/", { kind: "notfound", game: "team-9" }],
    ["/favicon.ico", { kind: "notfound", game: "favicon.ico" }],
    ["//", { kind: "notfound" }],
  ])("%s", (url, expected) => {
    expect(route(url, games)).toEqual(expected);
  });

  it("does not let a game name that merely starts like another through", () => {
    expect(route("/team-22/", games)).toEqual({ kind: "notfound", game: "team-22" });
    expect(route("/team-2x", games)).toEqual({ kind: "notfound", game: "team-2x" });
  });

  it("keeps the rest of the path as it was: the game decides what it means", () => {
    expect(route("/team-2/../team-4/x", games)).toEqual({
      kind: "proxy",
      game: "team-2",
      url: "/../team-4/x",
    });
  });
});

describe("indexPage", () => {
  it("links the released games and marks the planned ones", () => {
    const html = indexPage(["team-2"], ["team-1", "team-3"]);
    expect(html).toContain('<a href="/team-2/">team-2</a>');
    expect(html).toContain("team-1: not released yet");
    expect(html).toContain("team-3: not released yet");
  });

  it("escapes names", () => {
    expect(indexPage(['a"><script>'], [])).not.toContain("<script>");
  });
});

describe("readConfig", () => {
  const base = { GAMES: "team-2,team-4", APP_ENV: "production", RAILWAY_GIT_COMMIT_SHA: "abc123" };

  it("reads the games, the environment and the commit", () => {
    const c = readConfig(base);
    expect(c.games).toEqual(["team-2", "team-4"]);
    expect(c).toMatchObject({ env: "production", sha: "abc123", port: 2570, planned: [] });
  });

  it("reaches a game on Railway's private network, on the port it listens on", () => {
    expect(readConfig(base).upstream("team-2")).toBe("http://team-2.railway.internal:8080");
    expect(readConfig({ ...base, UPSTREAM_PORT: "9000" }).upstream("team-4")).toBe(
      "http://team-4.railway.internal:9000",
    );
  });

  it("lists planned games that are not released, once", () => {
    const c = readConfig({ ...base, PLANNED_GAMES: "team-1, team-2, team-3,team-3" });
    expect(c.planned).toEqual(["team-1", "team-3"]);
  });

  it("UPSTREAMS says where games are for a local run, and names the games when GAMES is unset", () => {
    const c = readConfig({ UPSTREAMS: "team-2=http://127.0.0.1:2601/, team-4=http://127.0.0.1:2602" });
    expect(c.games).toEqual(["team-2", "team-4"]);
    expect(c.upstream("team-2")).toBe("http://127.0.0.1:2601");
  });

  it.each([
    ["no games at all", {}, /GAMES is empty/],
    ["a game name that is not URL- and DNS-safe", { GAMES: "Team_2" }, /not a valid game name/],
    [
      "a game with no address in UPSTREAMS",
      { GAMES: "team-2,team-4", UPSTREAMS: "team-2=http://x:1" },
      /no address for: team-4/,
    ],
    ["an UPSTREAMS entry that is not a URL", { UPSTREAMS: "team-2=nope" }, /not a URL/],
    ["a bad upstream port", { GAMES: "team-2", UPSTREAM_PORT: "http" }, /UPSTREAM_PORT/],
    ["a bad port", { GAMES: "team-2", PORT: "-1" }, /PORT must be/],
  ])("refuses %s", (_name, env, message) => {
    expect(() => readConfig(env)).toThrow(message);
  });
});

// --- the gateway in front of fake upstreams ---------------------------------------------------------------

interface Seen {
  method?: string;
  url?: string;
  headers: IncomingMessage["headers"];
  body: string;
}

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const listen = (server: Server) =>
  new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
    closers.push(
      () =>
        new Promise((r) => {
          server.closeAllConnections();
          server.close(() => r());
        }),
    );
  });

/** A fake game: records every request and answers with a header that says which game it is. */
async function fakeGame(name: string, status = 200) {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      seen.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString(),
      });
      res.writeHead(status, { "content-type": "application/json", "x-game": name });
      res.end(JSON.stringify({ game: name, url: req.url }));
    });
  });
  const wsSeen: string[] = [];
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws, req) => {
    wsSeen.push(req.url ?? "");
    ws.on("message", (m) => ws.send(`${name}:${m}`));
  });
  const port = await listen(server);
  return { port, seen, wsSeen, url: `http://127.0.0.1:${port}` };
}

async function gatewayFor(
  upstreams: Record<string, string>,
  planned: string[] = [],
  options: { upstreamTimeoutMs?: number } = {},
) {
  const logs: Record<string, unknown>[] = [];
  const config: GatewayConfig = {
    games: Object.keys(upstreams),
    planned,
    upstream: (g) => upstreams[g] as string,
    env: "development",
    sha: "abc123",
    startedAt: "2026-01-01T00:00:00.000Z",
  };
  const server = createGateway(config, { log: (f) => logs.push(f), ...options });
  const port = await listen(server);
  return { base: `http://127.0.0.1:${port}`, port, logs };
}

describe("the gateway", () => {
  it("serves the index with the released and the planned games", async () => {
    const { base } = await gatewayFor({ "team-2": "http://127.0.0.1:1" }, ["team-1"]);
    const res = await fetch(base);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain('href="/team-2/"');
    expect(html).toContain("team-1: not released yet");
  });

  it("answers /health itself, without asking any game", async () => {
    const { base } = await gatewayFor({ "team-2": "http://127.0.0.1:1" });
    const res = await fetch(`${base}/health`);
    expect(await res.json()).toEqual({
      ok: true,
      env: "development",
      debug: false,
      sha: "abc123",
      startedAt: "2026-01-01T00:00:00.000Z",
      games: ["team-2"],
    });
    expect((await fetch(`${base}/health`, { method: "POST" })).status).toBe(405);
  });

  it("redirects /team-2 to /team-2/ and keeps the query and the method", async () => {
    const { base } = await gatewayFor({ "team-2": "http://127.0.0.1:1" });
    const res = await fetch(`${base}/team-2?room=ABCD`, { redirect: "manual", method: "POST" });
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("/team-2/?room=ABCD");
  });

  it("gives an unknown game a 404 page, escaped", async () => {
    const { base } = await gatewayFor({ "team-2": "http://127.0.0.1:1" });
    const res = await fetch(`${base}/team-9/`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("There is no game called <code>team-9</code>");
    expect(await (await fetch(`${base}/%3Cscript%3E/`)).text()).not.toContain("<script>");
  });

  it("sends /team-2/... to team-2 without the prefix, and each game to its own service", async () => {
    const a = await fakeGame("team-2");
    const b = await fakeGame("team-4");
    const { base } = await gatewayFor({ "team-2": a.url, "team-4": b.url });

    expect(await (await fetch(`${base}/team-2/api/stats?x=1`)).json()).toEqual({
      game: "team-2",
      url: "/api/stats?x=1",
    });
    expect(await (await fetch(`${base}/team-4/`)).json()).toEqual({ game: "team-4", url: "/" });
    expect(a.seen.map((s) => s.url)).toEqual(["/api/stats?x=1"]);
    expect(b.seen.map((s) => s.url)).toEqual(["/"]);
  });

  it("passes the method, the body, the status and the headers through", async () => {
    const a = await fakeGame("team-2", 201);
    const { base } = await gatewayFor({ "team-2": a.url });
    const res = await fetch(`${base}/team-2/api/bug-reports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "stuck" }),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("x-game")).toBe("team-2");
    expect(a.seen[0]).toMatchObject({ method: "POST", url: "/api/bug-reports", body: '{"title":"stuck"}' });
  });

  it("passes X-Forwarded-For, -Proto and -Host through as Railway's edge set them, and adds nothing", async () => {
    const a = await fakeGame("team-2");
    const { base } = await gatewayFor({ "team-2": a.url });
    await fetch(`${base}/team-2/`, {
      headers: {
        "x-forwarded-for": "203.0.113.9, 198.51.100.7",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "game.example",
      },
    });
    const h = a.seen[0]?.headers;
    // The last entry is the one the edge appended: the game, trusting one proxy, reads it as the player.
    expect(h?.["x-forwarded-for"]).toBe("203.0.113.9, 198.51.100.7");
    expect(h?.["x-forwarded-proto"]).toBe("https");
    expect(h?.["x-forwarded-host"]).toBe("game.example");

    await fetch(`${base}/team-2/`); // no edge in front (a local run): the gateway invents no address
    expect(a.seen[1]?.headers["x-forwarded-for"]).toBeUndefined();
  });

  it("answers 502 with a readable page when the game is not reachable, and logs it", async () => {
    const dead = await fakeGame("team-2");
    const url = dead.url;
    await closers.pop()?.(); // stop the game, keep the gateway
    const { base, logs } = await gatewayFor({ "team-2": url });
    const res = await fetch(`${base}/team-2/`);
    expect(res.status).toBe(502);
    expect(await res.text()).toContain("team-2 is not reachable");
    expect(logs[0]).toMatchObject({ level: "error", msg: "upstream error", game: "team-2" });
  });

  it("answers 502 itself when a game accepts the request but never answers", async () => {
    const hung = createServer(() => {}); // takes the request and says nothing, like a stuck event loop
    const hungPort = await listen(hung);
    const { base, logs } = await gatewayFor({ "team-2": `http://127.0.0.1:${hungPort}` }, [], {
      upstreamTimeoutMs: 150,
    });
    const started = Date.now();
    const res = await fetch(`${base}/team-2/`);
    expect(res.status).toBe(502);
    expect(await res.text()).toContain("team-2 is not reachable");
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(logs[0]).toMatchObject({ level: "error", msg: "upstream error", game: "team-2" });
  });

  it("does not time out a slow answer that keeps sending", async () => {
    const slow = createServer((_req, res) => {
      res.writeHead(200);
      const tick = setInterval(() => res.write("."), 50);
      setTimeout(() => {
        clearInterval(tick);
        res.end("done");
      }, 400);
    });
    const slowPort = await listen(slow);
    const { base } = await gatewayFor({ "team-2": `http://127.0.0.1:${slowPort}` }, [], {
      upstreamTimeoutMs: 150,
    });
    const res = await fetch(`${base}/team-2/`);
    expect(res.status).toBe(200);
    expect((await res.text()).endsWith("done")).toBe(true);
  });

  it("keeps working for the other games when one is down", async () => {
    const dead = await fakeGame("team-2");
    const deadUrl = dead.url;
    await closers.pop()?.();
    const b = await fakeGame("team-4");
    const { base } = await gatewayFor({ "team-2": deadUrl, "team-4": b.url });
    expect((await fetch(`${base}/team-2/`)).status).toBe(502);
    expect((await fetch(`${base}/team-4/`)).status).toBe(200);
  });
});

describe("the gateway and WebSockets", () => {
  const open = (url: string) =>
    new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.once("open", () => resolve(ws));
      ws.once("error", reject);
      ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
      closers.push(async () => ws.terminate());
    });
  const next = (ws: WebSocket) =>
    new Promise<string>((resolve) => ws.once("message", (m) => resolve(String(m))));

  it("upgrades /team-2/<processId>/<roomId> and strips the prefix, the way Colyseus connects", async () => {
    const a = await fakeGame("team-2");
    const { port } = await gatewayFor({ "team-2": a.url });
    const ws = await open(`ws://127.0.0.1:${port}/team-2/proc1/room9?sessionId=s1`);
    ws.send("hello");
    expect(await next(ws)).toBe("team-2:hello");
    expect(a.wsSeen).toEqual(["/proc1/room9?sessionId=s1"]);
  });

  it("routes WebSockets of two games side by side", async () => {
    const a = await fakeGame("team-2");
    const b = await fakeGame("team-4");
    const { port } = await gatewayFor({ "team-2": a.url, "team-4": b.url });
    const [wa, wb] = await Promise.all([
      open(`ws://127.0.0.1:${port}/team-2/p/r`),
      open(`ws://127.0.0.1:${port}/team-4/p/r`),
    ]);
    wa.send("x");
    wb.send("y");
    expect([await next(wa), await next(wb)]).toEqual(["team-2:x", "team-4:y"]);
  });

  it("refuses an upgrade for an unknown game with a 404", async () => {
    const a = await fakeGame("team-2");
    const { port } = await gatewayFor({ "team-2": a.url });
    await expect(open(`ws://127.0.0.1:${port}/team-9/p/r`)).rejects.toThrow("HTTP 404");
  });

  it("does not crash when the game is down: the upgrade just fails", async () => {
    const dead = await fakeGame("team-2");
    const url = dead.url;
    await closers.pop()?.();
    const { port, base } = await gatewayFor({ "team-2": url });
    await expect(open(`ws://127.0.0.1:${port}/team-2/p/r`)).rejects.toBeTruthy();
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  it("tells the client 502 when the game is down, so it is not mistaken for a network drop", async () => {
    const dead = await fakeGame("team-2");
    const url = dead.url;
    await closers.pop()?.();
    const { port } = await gatewayFor({ "team-2": url });
    await expect(open(`ws://127.0.0.1:${port}/team-2/p/r`)).rejects.toThrow("HTTP 502");
  });

  it("keeps a WebSocket open however long it is silent: the timeout is for plain requests", async () => {
    const a = await fakeGame("team-2");
    const { port } = await gatewayFor({ "team-2": a.url }, [], { upstreamTimeoutMs: 100 });
    const ws = await open(`ws://127.0.0.1:${port}/team-2/p/r`);
    await new Promise((r) => setTimeout(r, 400));
    ws.send("still here");
    expect(await next(ws)).toBe("team-2:still here");
  });
});
