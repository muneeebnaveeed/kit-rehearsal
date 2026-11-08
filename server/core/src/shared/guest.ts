/**
 * Guest identity: a random ID the browser keeps (`getGuestId()` in @kit/core/client) and sends as the
 * join option `guestId`, so a game can tell that the same person came back.
 *
 * The guest is a hint to recognise a returning player in this game, not authentication: never use it
 * to hand over a seat, a score or ownership. Every game on the shared origin can read the stored ID,
 * and a client can send any UUID (a fresh one to avoid being recognised, or someone else's).
 *
 * The server never puts the raw ID in synced state, logs, replays or HTTP responses. It turns it into a
 * short public fingerprint per game (`guest`: the first 12 hex characters of SHA-256 of
 * `<game id>:<ID>`) and stores only that, so `guest` values can't link one player across games.
 */

/** The join option the client sends the raw guest ID in. */
export const GUEST_ID_OPTION = "guestId";

/** Length of the public fingerprint, in hex characters (48 bits). */
export const GUEST_FINGERPRINT_LENGTH = 12;

/** A fingerprint, or "" for a player who sent no valid guest ID. */
export const GUEST_FINGERPRINT_PATTERN = /^(?:[0-9a-f]{12})?$/;

const GUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a UUID (any version, either case): what `getGuestId()` produces and the server accepts. */
export function isGuestId(value: unknown): value is string {
  return typeof value === "string" && GUEST_ID_PATTERN.test(value);
}
