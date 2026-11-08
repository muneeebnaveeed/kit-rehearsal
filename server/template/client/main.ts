/**
 * Template game client. Deliberately minimal: a lobby (create, or join by code), a Canvas 2D view
 * and keyboard input, using the client core from @kit/core/client: the ~ debug overlay with its
 * console, network stats and state inspector, F8 bug reports, and the netcode in ./netcode.ts
 * (prediction, interpolation, ?lag= simulation). Teams replace this file with their own lobby and
 * renderer.
 */
import { Client, type Room } from "@colyseus/sdk";
import {
  type BuildInfo,
  buildInviteLink,
  createBugReporter,
  createDebugOverlay,
  createFrameMeter,
  createLogBuffer,
  formatServerStats,
  getGuestId,
  inspectState,
  NO_NET_CONDITIONS,
  normalizeRoomCode,
  readClientParams,
  readNetConditions,
  serverUrlFromPage,
  trackRoomNetStats,
} from "@kit/core/client";
import {
  ClientMessage,
  type DebugResult,
  HealthResponseSchema,
  JoinByCodeResponseSchema,
  type Notice,
  Routes,
  ServerMessage,
  type DebugStats as ServerTickStats,
} from "@kit/core/shared";
import kit from "../../../kit.json";
import { templateGame } from "../shared/game.ts";
import type { SampleState } from "../shared/index.ts";
import { createTemplateNetcode } from "./netcode.ts";

/**
 * In local dev the server runs on :2567; deployed builds are served by the server itself, possibly under
 * a path (`<address>/team-2/` behind the gateway), so the address comes from the page, not `location.origin`.
 */
export const SERVER_URL: string =
  import.meta.env.VITE_SERVER_URL ??
  (import.meta.env.DEV ? "http://localhost:2567" : serverUrlFromPage(location.href));

const ROOM_NAME = "game";
// Every game shares one address behind the gateway, so the keys carry the game's path: a token or room code from
// /team-2/ must never be tried on /team-4/ in the same tab.
const SCOPE = new URL(SERVER_URL).pathname;
const TOKEN_KEY = `kit:${SCOPE}:reconnectionToken`;
const CODE_KEY = `kit:${SCOPE}:roomCode`;

/** F8 bug reports open a pre-filled issue here, labelled with this team. Teams set their own label. */
const ISSUE_REPO = kit.repo;
const TEAM_LABEL = "platform";

const app = document.getElementById("app") as HTMLElement;
const params = readClientParams(location.search);
// ?lag=300&jitter=50&loss=5 simulates a bad connection; null when none is set.
const netConditions = readNetConditions(location.search);
const client = new Client(SERVER_URL);
/** Same in every tab and after a reload: the room shows its fingerprint as `seats[id].guest`. */
const guestId = getGuestId();
// Recent console output goes into F8 bug reports.
const logs = createLogBuffer();
logs.captureConsole();

async function main(): Promise<void> {
  const health = HealthResponseSchema.parse(await (await fetch(`${SERVER_URL}${Routes.health}`)).json());
  const room = (await tryReconnect()) ?? (params.room ? await joinByCode(params.room) : null);
  if (room) play(room, health);
  else showLobby(health);
}

async function tryReconnect(): Promise<Room<SampleState> | null> {
  const token = safeSession(() => sessionStorage.getItem(TOKEN_KEY));
  if (!token) return null;
  try {
    return await client.reconnect<SampleState>(token);
  } catch {
    // Seat expired or room closed: fall back to the saved code, as a new player.
    safeSession(() => sessionStorage.removeItem(TOKEN_KEY));
    const code = safeSession(() => sessionStorage.getItem(CODE_KEY));
    return code ? joinByCode(code).catch(() => null) : null;
  }
}

async function joinByCode(raw: string): Promise<Room<SampleState>> {
  const code = normalizeRoomCode(raw);
  if (!code) throw new Error("A room code is four letters.");
  const res = await fetch(`${SERVER_URL}${Routes.joinByCode}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`);
  const { roomId } = JoinByCodeResponseSchema.parse(await res.json());
  return client.joinById<SampleState>(roomId, { name: params.name ?? "player", guestId });
}

function showLobby(health: BuildInfo, error?: string): void {
  app.innerHTML = `
    <h1>template</h1>
    <div>env ${health.env} · ${health.sha.slice(0, 7)}</div>
    <p><button id="create">Create room</button></p>
    <p><input id="code" maxlength="4" placeholder="CODE" size="6" /> <button id="join">Join by code</button></p>
    <p class="bad" id="error">${error ?? ""}</p>`;
  const fail = (err: unknown) => showLobby(health, err instanceof Error ? err.message : String(err));
  app.querySelector("#create")?.addEventListener("click", () => {
    client
      .create<SampleState>(ROOM_NAME, { private: true, name: params.name ?? "player", guestId })
      .then((room) => play(room, health), fail);
  });
  app.querySelector("#join")?.addEventListener("click", () => {
    const input = app.querySelector<HTMLInputElement>("#code");
    joinByCode(input?.value ?? "").then((room) => play(room, health), fail);
  });
}

function play(room: Room<SampleState>, health: BuildInfo): void {
  safeSession(() => sessionStorage.setItem(TOKEN_KEY, room.reconnectionToken));
  const { width, height } = templateGame.config.arena;
  app.innerHTML = `<div id="hud"></div><canvas id="view" width="${width}" height="${height}"></canvas>`;
  const hud = app.querySelector("#hud") as HTMLElement;
  const canvas = app.querySelector("#view") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

  // F8: screenshot + logs + room details → saved on the server, with a link to a pre-filled issue.
  createBugReporter({
    serverUrl: SERVER_URL,
    issueRepo: ISSUE_REPO,
    teamLabel: TEAM_LABEL,
    logs,
    getCanvas: () => canvas,
    getContext: () => ({
      game: templateGame.id,
      build: health,
      roomId: room.roomId,
      roomCode: room.state.code || null,
      playerId: room.sessionId,
      tick: room.state.tick,
      scenario: params.scenario,
      net: netConditions,
      url: location.href,
      userAgent: navigator.userAgent,
    }),
  });

  const keys = new Set<string>();
  addEventListener("keydown", (e) => keys.add(e.key.toLowerCase()));
  addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
  let left = false;
  // Prediction for you, interpolation for others, and the ?lag= simulation (see ./netcode.ts).
  const netcode = createTemplateNetcode({
    myId: room.sessionId,
    conditions: netConditions ?? NO_NET_CONDITIONS,
    config: templateGame.config,
  });
  room.onStateChange((state) => netcode.onState(state, performance.now()));
  // Notices and the disconnect message stay on screen instead of being overwritten by the next frame.
  const showMessage = (text: string) => {
    hud.dataset.locked = "1";
    hud.textContent = text;
  };
  let lastSentAt = 0;
  const sendEveryMs = 1000 / templateGame.config.tickRate;

  room.onMessage(ServerMessage.Notice, (notice: Notice) => {
    showMessage(notice.text);
  });
  // The ~ overlay includes a debug console: commands go to the room, replies come back as debug:result.
  const overlay = createDebugOverlay({
    build: health,
    startOpen: params.debug,
    console: { send: (command) => room.send(ClientMessage.DebugCommand, command) },
  });
  room.onMessage(ServerMessage.DebugResult, (result: DebugResult) => overlay.handleDebugResult(result));
  // Ping, patches/s and bytes/s for the overlay; the server's tick timing arrives once a second.
  const net = trackRoomNetStats(room);
  let serverStats: ServerTickStats | null = null;
  room.onMessage(ServerMessage.DebugStats, (stats: ServerTickStats) => {
    serverStats = stats;
  });
  room.onLeave(() => {
    left = true;
    net.stop();
    showMessage("Disconnected. Refresh to rejoin.");
  });

  const meter = createFrameMeter(performance.now());
  const axis = (neg: string[], pos: string[]) =>
    (pos.some((k) => keys.has(k)) ? 1 : 0) - (neg.some((k) => keys.has(k)) ? 1 : 0);

  const frame = (now: number) => {
    const state = room.state;
    if (state.code) safeSession(() => sessionStorage.setItem(CODE_KEY, state.code));
    // One input per server tick is enough; the server applies the last input of each tick.
    if (now - lastSentAt >= sendEveryMs) {
      lastSentAt = now;
      netcode.sendInput(
        { dx: axis(["a", "arrowleft"], ["d", "arrowright"]), dy: axis(["w", "arrowup"], ["s", "arrowdown"]) },
        now,
      );
    }
    netcode.frame(now, (envelope) => room.send(ClientMessage.Input, envelope));

    const { radius } = templateGame.config.player;
    ctx.fillStyle = "#11161d";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#fcc419";
    for (const p of state.pickups?.values() ?? []) circle(ctx, p.x, p.y, templateGame.config.pickups.radius);
    // With lag on, a ring shows where the server last saw you: the gap is the lag prediction hides.
    const server = netcode.serverPosition();
    if (netConditions && server) ring(ctx, server.x, server.y, radius);
    const others = netcode.others(now);
    for (const [id, p] of state.players?.entries() ?? []) {
      const pos = (id === room.sessionId ? netcode.myPosition() : others.get(id)) ?? p;
      ctx.fillStyle = p.color;
      ctx.globalAlpha = state.seats.get(id)?.connected === false ? 0.35 : 1;
      circle(ctx, pos.x, pos.y, radius);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#d6dde4";
      ctx.fillText(`${p.name} ${p.score}`, pos.x - 14, pos.y - 20);
    }

    const invite = state.code ? buildInviteLink(location.href, state.code) : "(quick match)";
    const lag = netConditions ? ` · simulated lag ${netConditions.latencyMs} ms` : "";
    if (!hud.dataset.locked)
      hud.textContent = `code ${state.code || "-"} · invite ${invite} · WASD/arrows to move${lag}`;
    const { fps, frameMs } = meter.frame(now);
    overlay.update(
      {
        roomId: room.roomId,
        roomCode: state.code || null,
        playerId: room.sessionId,
        tick: state.tick ?? null,
        ...net.read(now),
        fps,
        frameMs,
      },
      {
        // The public fingerprint of guestId: two tabs of this browser show the same value.
        guest: state.seats?.get(room.sessionId)?.guest || "-",
        ...(serverStats ? { server: formatServerStats(serverStats) } : {}),
        // State inspector: the room's live state, pickups summarised.
        ...inspectState(state.toJSON(), { summarise: ["pickups"], maxLines: 16 }),
      },
      now,
    );
    if (!left) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(214, 221, 228, 0.5)";
  ctx.lineWidth = 2;
  ctx.stroke();
}

/** sessionStorage can throw in private windows; the game still works without it. */
function safeSession<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

main().catch((err) => {
  app.innerHTML = `<div class="bad">Can't reach the server at ${SERVER_URL}</div><div>${String(err)}</div>`;
});
