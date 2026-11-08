/**
 * URL parameters every game understands:
 * `?room=QXTR` join a room by code, `?name=Ada` player name,
 * `?scenario=crowded` load a QA scenario, `?debug` open the debug overlay at start.
 */

/**
 * Room codes are four letters from A–Z without I and O, exactly what the server generates
 * (`ROOM_CODE_ALPHABET` in server/roomCodes.ts; a test keeps the two in sync). Rejecting the
 * rest here gives the player an instant error instead of a "room not found" from the server.
 */
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z]{4}$/;
export const MAX_NAME_LENGTH = 24;
const DEBUG_OFF_VALUES = ["0", "false", "off"];

export interface ClientParams {
  readonly room: string | null;
  readonly name: string | null;
  readonly scenario: string | null;
  readonly debug: boolean;
}

/** Returns the code in upper case, or null if it is not a valid room code. */
export function normalizeRoomCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  return ROOM_CODE_PATTERN.test(code) ? code : null;
}

export function readClientParams(search: string): ClientParams {
  const params = new URLSearchParams(search);
  const room = params.get("room");
  const debug = params.get("debug");
  return {
    room: room === null ? null : normalizeRoomCode(room),
    name: nonEmpty(params.get("name"))?.slice(0, MAX_NAME_LENGTH) ?? null,
    scenario: nonEmpty(params.get("scenario")),
    debug: debug !== null && !DEBUG_OFF_VALUES.includes(debug.toLowerCase()),
  };
}

/** The current page's URL with only `?room=<code>`: the link players share. */
export function buildInviteLink(currentHref: string, code: string): string {
  const url = new URL(currentHref);
  url.search = "";
  url.hash = "";
  url.searchParams.set("room", code);
  return url.toString();
}

/**
 * The server address for a page served by the game server itself, so the same build works at the root
 * of a domain and behind the gateway at `<address>/team-N/`. It is the page's folder without a trailing
 * slash: `https://host/team-2/` gives `https://host/team-2`, `https://host/` gives `https://host`.
 * `levelsUp` climbs out of folders when the page sits below the server root (`multiplayer/index.html`).
 * Never use `location.origin` for this: it drops the `/team-N` prefix.
 */
export function serverUrlFromPage(pageHref: string, levelsUp = 0): string {
  const url = new URL(pageHref);
  const folders = url.pathname.slice(0, url.pathname.lastIndexOf("/")).split("/").filter(Boolean);
  const kept = folders.slice(0, Math.max(0, folders.length - levelsUp));
  return `${url.origin}${kept.map((folder) => `/${folder}`).join("")}`;
}

function nonEmpty(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}
