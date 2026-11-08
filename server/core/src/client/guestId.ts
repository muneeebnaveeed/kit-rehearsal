/**
 * Guest ID: a random UUID this browser keeps in localStorage, so every tab of a game shares it and it
 * survives reloads. Send it as the join option `guestId`:
 *
 *   client.joinById(roomId, { name, guestId: getGuestId() })
 *
 * One key for the whole browser, deliberately not scoped to the game's path: every game on the shared
 * origin reads the same ID, and the server makes the public fingerprint (`seats[sessionId].guest`)
 * different in each game, so players can't be linked across games.
 *
 * It is a hint to recognise a returning player in this game, not a login: other games on the origin
 * can read it and a client can send a fresh one, so never use it to hand over a seat, score or
 * ownership. The server never stores or shows the raw ID; don't log it, put it in a URL or a bug
 * report, or show it to players either.
 */
import { isGuestId } from "../shared/guest.ts";

export const GUEST_ID_STORAGE_KEY = "kit:guestId";

/** The part of `Storage` getGuestId needs; pass a fake in tests. */
export type GuestIdStorage = Pick<Storage, "getItem" | "setItem">;

let pageGuestId: string | null = null;

/**
 * Returns this browser's guest ID, creating and storing one the first time. When storage is missing
 * or throws (private windows, blocked site data), returns one ID kept in memory for this page, so the
 * player still joins, just without being recognised after a reload.
 */
export function getGuestId(storage: GuestIdStorage | null = defaultStorage()): string {
  if (storage) {
    try {
      const saved = storage.getItem(GUEST_ID_STORAGE_KEY);
      if (isGuestId(saved)) return saved;
      const id = newGuestId();
      storage.setItem(GUEST_ID_STORAGE_KEY, id);
      return id;
    } catch {
      // Fall through to the in-memory ID.
    }
  }
  pageGuestId ??= newGuestId();
  return pageGuestId;
}

function defaultStorage(): GuestIdStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // Reading localStorage itself throws when site data is blocked.
  }
}

/** A version 4 UUID. `crypto.randomUUID` only exists on https and localhost, so build one otherwise. */
function newGuestId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
