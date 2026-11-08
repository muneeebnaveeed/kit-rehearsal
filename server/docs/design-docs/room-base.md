# Room base design

**Status:** draft for review · **Issue:** #12 · **Owner:** platform · **Date:** 2026-11-06

## Why

Four teams each build a real-time multiplayer browser game on one shared platform during a hackathon. With AI-driven development, writing code is cheap. The real bottlenecks are netcode, game feel and tuning, and reproducing bugs found in playtests. The room base handles the netcode and makes every room replayable, so each team can spend its time on its game instead of on infrastructure.

The host (`@kit/host`: Colyseus 0.18 + Express, `/health`, static client) and the contract (`@kit/core/shared`: messages, input envelope, replay format, `SeededRandom`) already exist. This doc covers the missing middle piece, `@kit/core/server`, plus the host endpoints and the template game that prove it works.

## Goals

- A game author writes a pure game definition (state, input schema, `init`/`join`/`leave`/`step`) and gets a working multiplayer room from it.
- Every room is deterministic and replayable. Re-running a room's recorded replay produces the same final state hash.
- Players join a private room with a 4-letter code or a `?room=CODE` link, and a page refresh puts them back in their seat.
- Debug commands work in `local` and `development` and are rejected in production.
- Each game sets its own room settings (tick rate, send rate, maximum players, reconnect window) in its own folder.
- The client can optionally predict its own player by running the same `step` function, so the shared game code must run in the browser.
- When a room misbehaves on Railway, its logs and stats show whether the server or the network is at fault, without any service beyond Railway.
- The template game uses all of the above and has tests.

## Non-goals

- The client core and debug overlay. This doc only makes sure they're possible.
- Bots, scenarios, smoke tests and load tests.
- Lockstep or rollback netcode.
- Persistent storage of any kind: no database, no object storage, no Redis. One server process per game.
- Accounts or authentication.
- The server creating GitHub issues.

## Anti-goals (a failure even if it works)

- Game logic that only runs inside a Colyseus `Room`, so replays and tests need a live server.
- Platform code that assumes a genre, a renderer or particular state fields. Teams' games range from a co-op shared vehicle (Deepwell) to whatever the others choose.
- Hidden defaults inside `server/`. A team should never need a platform PR to tune its own game.
- Secrets (GitHub tokens) on the game servers.
- A replay that diverges from the live room. Anything that changes the simulation, debug commands included, must be recorded.

## The model (decided)

**Server-authoritative state sync.** Clients send only inputs; they never send state.

1. The client sends `room.send("input", { seq, data })`. `seq` increases by one per input from that client (`InputEnvelopeSchema`).
2. The room checks the envelope, then checks `data` with the game's zod input schema. Inputs that fail either check are dropped and logged at debug level. So are inputs with `seq` at or below the last one queued for that player.
3. The room queues valid inputs and applies them on the next fixed tick.
4. On each tick the room calls the game's `step`, sets each player's `lastSeq` to the highest seq applied, and increments `state.tick`.
5. Colyseus sends changed fields to clients at the game's send rate.
6. Clients interpolate remote entities. When a client turns prediction on, it runs `step` locally for its own player and reconciles against `lastSeq`.

**Logic lives in a pure game definition (decided).** The room is a thin shell around it. The same definition runs in three places: the live room, the headless replay runner, and, if the client opts in, the browser.

**Prediction is opt-in per client (decided).** The base provides what prediction needs (`lastSeq`, and a `step` that runs in the browser). The client core offers it as a switch.

## The game definition

`@kit/core/sim` exports the types (browser-safe); `@kit/host` exports `createGameRoom()`. *(Changed during the build: the room lives in the host so every room shares one copy of the Colyseus runtime.)* Shapes are indicative; the builder can refine names.

```ts
interface RoomSettings {        // RoomSettingsSchema (zod), exported by @kit/core/server
  version: string;              // config version, recorded in replays
  tickRate: number;             // simulation ticks per second
  patchRate: number;            // state sends per second
  maxPlayers: number;
  reconnectSeconds: number;     // how long a dropped player's seat is held
}

interface SimContext<S, C> {
  state: S;                     // the game's Colyseus schema instance
  rng: SeededRandom;
  config: C;                    // the game's full config (extends RoomSettings)
  tick: number;
}

interface TickInput<I> { playerId: string; seq: number; data: I }

interface GameDefinition<S, I, C extends RoomSettings> {
  id: string;                               // e.g. "template", "team-2"
  createState(): S;
  inputSchema: z.ZodType<I>;
  joinOptionsSchema: z.ZodType<Record<string, unknown>>;  // name, color, ...
  config: C;
  init(ctx: SimContext<S, C>): void;
  join(ctx: SimContext<S, C>, playerId: string, options: Record<string, unknown>, info: { guest: string }): void;
  leave(ctx: SimContext<S, C>, playerId: string): void;
  step(ctx: SimContext<S, C>, inputs: TickInput<I>[]): void;  // inputs in arrival order
  commands?: Record<string, DebugCommandHandler<S, C>>;        // game-specific debug commands
}
```

### State the base owns *(my call)*

The base never touches a game's own fields. Instead, `@kit/core/server` (in a browser-safe module) exports a `BaseState` schema that every game's state extends:

```ts
BaseState {
  tick: uint32
  code: string            // room code, "" for quick-match rooms
  paused: boolean
  seats: map<Seat>        // keyed by sessionId, written only by the base
}
Seat { connected: boolean; lastSeq: uint32; guest: string }   // guest: see Guest identity
```

- Games keep their own entities wherever they like: a player map, one shared vehicle, or anything else. The base doesn't assume there is one entity per player.
- The client reconciles prediction against `state.seats[sessionId].lastSeq`.
- The template's `Player` loses `connected` and `lastSeq`, which move to `Seat`.
- Games may *read* `seats` inside the simulation. That's deterministic because every seat change is recorded (see Replays).
- Optional hooks `disconnect(ctx, playerId)` and `reconnect(ctx, playerId)` let a game react, for example a vehicle losing its driver. Each runs on the tick the event is applied.

Rules for the definition, enforced by review and documented in `server/CLAUDE.md`:

- Nothing in it may import from `colyseus`, `@kit/host`, Node built-ins or `@kit/core/server` runtime code. It may import `@colyseus/schema`, `zod` and `@kit/core/shared`, which all run in the browser.
- It uses `ctx.rng` and `ctx.tick` only: no `Math.random()`, no `Date.now()`, no timers.
- `step` mutates `ctx.state` in place.

`createGameRoom(definition)` returns a Room class that the game exports from `room/index.ts` and passes to `startGameServer()`, as today.

## Config lives in the team's folder (decided)

- `@kit/core/server` exports `RoomSettingsSchema`.
- Each game's config schema in `games/team-N/shared/` extends it with its own tuning values (the template's `SampleConfigSchema` today).
- The game loads `games/team-N/config/game.json`, checks it with its schema, and puts it in its definition. A config file that fails the check stops the server at startup with a clear message.
- The base never reads files and has no fallback values for room settings.

## Replays (decided: in memory plus download)

- Each room records a `Replay` (format `ReplaySchema`, already in the contract) from creation: seed, tick rate, config version, SHA, start time, and every join, leave, input and debug event with the tick it was applied on.
- A join's recorded `options` are the checked join options, so a replay runner can call `join` with exactly the same values.
- *(My call, contract change:)* `ReplayEventSchema` gains `drop` and `reconnect` events, and `REPLAY_VERSION` goes to 2. Nothing consumes replays yet, so no game has to migrate. A drop sets `connected: false`. A reconnect within the window sets it back. If the window expires, the room records a `leave` at the tick it happens.
- *(My call, contract change:)* a replay embeds the full checked config, not only `configVersion`. `runReplay` uses the replay's config, so editing `game.json` without bumping `version` can't make old replays drift. The runner still warns when the definition's game id differs.
- When a room closes, its final tick and state hash are written and the replay is kept in an in-memory store. *(My call:)* keep the most recent 50 finished rooms or one hour, whichever is smaller. Live rooms are always available.
- *(My call:)* memory limits are in bytes, not counts, so one long playtest can't take the server down.
  - The replay and bug-report stores share one budget, `MEMORY_BUDGET_MB` (default 256). The oldest finished replays are evicted first, then the oldest bug reports.
  - A live room's recording is capped by `REPLAY_MAX_EVENTS` (default 1,000,000, about an hour of 8 players at 30 Hz). Past the cap, recording stops, the replay is marked `truncated` (so the runner refuses to assert its hash), and a `warn` is logged once.
  - Inputs are stored compactly (an array per event rather than an object with repeated keys). The exact encoding is the builder's choice.
- `GET /api/replays/:roomId` returns the replay as a JSON download, for a live room (with `final` set to the current tick and hash) or a finished one. It returns 404 when the room is unknown or has been evicted.
- A deploy wipes everything. To keep a replay, download it and attach it to the issue.
- **Replay runner:** `runReplay(definition, replay, { untilTick? })` in `@kit/core/server` runs headless with no Colyseus server or network. It returns `{ state, tick, stateHash }`. It checks that `replay.game` and `replay.configVersion` match the definition and fails clearly when they don't.
- *(My call:)* **state hash** = SHA-256 of a canonical JSON of `state.toJSON()`, with object keys sorted. This doesn't depend on Colyseus's change tracking, so the live room and the runner hash the same way.
- *(My call:)* **seed** = a random 31-bit integer from `node:crypto` when the room is created. It's outside the simulation, so it's allowed, and it's recorded.

## Room codes

- `client.create(roomName, { private: true, ...joinOptions })` creates a room that isn't in quick match. The room picks a 4-letter code and sets `state.code`. It also stores the code in room metadata so the code can be found.
- *(My call:)* the alphabet excludes letters that can be mistaken for others: `ABCDEFGHJKLMNPQRSTUVWXYZ` (no I, O). Codes are unique among the live rooms of the process, retried on collision.
- Joining by code fails clearly when the code is unknown or the room is full (`ServerMessage.Notice` or a join error the client can show).
- `?room=CODE` is the invite link. The client core already parses it (`readClientParams`, `normalizeRoomCode` and `buildInviteLink` in `@kit/core/client`). The client accepts any four letters A–Z, and our alphabet is a subset of that, so the two stay compatible. Codes the client accepts but the server never issues simply come back as "unknown room".
- Quick match (`joinOrCreate(roomName)`) keeps working for public rooms.
- How the code lookup works is the builder's choice. It could be Colyseus `filterBy(["code"])`, or a small `POST /api/rooms/join` that returns a room id for `joinById`. Note that Colyseus "private" rooms are excluded from matchmaking, so with the `filterBy` route, use unlisted rooms instead.

## Guest identity

*(Added with #223.)* A sessionId lasts one seat, so on its own a game can't tell that the person in a new tab, or back after their seat expired, is someone it has seen before. There are no accounts, so the browser proves it instead:

- The client keeps a random UUID in `localStorage` (`getGuestId()` in `@kit/core/client`, key `kit:guestId`), shared by every tab and kept across reloads, and sends it as the join option `guestId`. It is one key for the whole browser, deliberately not scoped to the game's path, so every game behind the gateway reads the same ID. Without usable storage it falls back to one in-memory ID per page.
- The room computes the **fingerprint** `guest`: the first 12 hex characters of SHA-256 of `<game id>:<lowercased ID>`, where the game id is the definition's `id` (`guestFingerprint(def.id, guestId)` in `@kit/core/server`, using `node:crypto`, so nothing browser-side needs it). Anything that isn't a UUID gives `""`, and never rejects the join.
- The base removes `guestId` from the options before the game's `joinOptionsSchema` sees them, so no game declares it and a strict schema can't reject it.
- `Seat.guest` holds the fingerprint (synced, so clients see which seats belong to one person). The game's `join(ctx, playerId, options, info)` gets it as `info.guest`. The replay's join event records it, so `runReplay` passes the same value; a replay without it reads as `""`. The `player joined` log line carries it.

**What the guest is for:** a hint to recognise a returning player in this game, not authentication. Never use it to hand over a seat, a score or ownership: every game on the shared origin can read `kit:guestId`, and a client can send any UUID (a fresh one to avoid being recognised).

**Why the fingerprint is per game:** all games share one origin behind the gateway (`/team-N`), so one browser sends the same raw ID to every game. Hashing the game id in gives each game a different `guest` for that browser, so public state can't be used to link a player across games. The definition's `id` is used because it is per game, fixed in code, available to the room base and the replay runner, and already recorded in every replay (`replay.game`); the room name is per room type, not per game, and the server's `gameId` isn't known to the room base.

**Why only the fingerprint is stored:** state, replays, logs and the stats and replay routes can all be downloaded or read by other players and by whoever debugs a playtest. Keeping the raw ID out of them means a copied value can't be replayed into another game's room, or used to look the player up there. A 48-bit prefix of a hash can't be turned back into the ID, but is still unique enough to tell a room's guests apart. The replay schema only accepts 12 hex characters or `""` as `guest`, so a raw ID can't be recorded by mistake.

Not included: accounts, persistence across server restarts (the ID lives in the browser; the server keeps nothing), and stopping one guest from taking two seats. A game that cares can compare `guest` values itself.

**Compatibility:** adding `Seat.guest` changes `state.toJSON()`, so a replay recorded before this change still runs but no longer reproduces its recorded `final.stateHash`. Replays are in-memory and wiped on deploy, so only replays downloaded earlier and attached to issues are affected. Making the fingerprint per game doesn't touch replays: the join event carries the fingerprint the live room computed, and `runReplay` uses it as recorded instead of hashing again.

## Reconnection

- On an unexpected drop, the player's state stays and `connected` is set to `false`. The room holds the seat for `reconnectSeconds` using Colyseus 0.18's reconnection API.
- *(My call:)* on reconnect the server resets that seat's sequence: the next input is accepted whatever its `seq`, and `lastSeq` is set from it. A refreshed client can then start again at `seq` 0, and the client core doesn't have to keep `seq` across refreshes.
- The client keeps `room.reconnectionToken` in `sessionStorage` and reconnects after a refresh (the client core implements the client side; the template proves it end to end).
- A consented leave (closing the room, leaving the lobby) frees the seat right away.
- `connected` changes and seat expiry are recorded so replays match.

## Debug commands

- These arrive as `ClientMessage.DebugCommand` (`DebugCommandSchema`), and the reply is `ServerMessage.DebugResult`.
- In `production` every command is rejected with `ok: false` and logged. The check is on `APP_ENV`, not on anything the client sends.
- **Built in:**

  | Command | Effect |
  |---|---|
  | `pause` | Toggles `paused`: ticks stop advancing |
  | `step [n]` | While paused, advances n ticks (default 1) |
  | `timescale x` | Runs the tick loop x times faster or slower; ticks stay the unit, so it's deterministic |
  | `seed n` | Reseeds the room's random generator |
  | `set path value` | Changes one config value; rejected if the result fails the game's config schema |
  | `kick playerId` | Removes a player |

- Games add their own (e.g. `spawn`, `tp`) through `definition.commands`. A command handler gets the sim context and its args and returns output text.
- Every command that changes the simulation is recorded as a `debug` event and replayed through the same handler. *(My call:)* `pause` and `timescale` only change wall-clock pacing, so they're recorded but are no-ops in the runner. `kick` is recorded as a leave.
- `paused` lives on `BaseState`, so no game declares it.

## Host additions (`@kit/host`)

| Route | What it does |
|---|---|
| `GET /api/replays/:roomId` | Replay download (see above) |
| `POST /api/bug-reports` | Accepts a `BugReport`, stores it in memory, returns `{ id, url }` |
| `GET /api/bug-reports/:id` | Returns the stored report, including its screenshot and the room's replay link |
| room-code join route | Only if the builder picks the HTTP route |

- **Bug report flow (decided):** the browser posts the report, then opens a pre-filled GitHub "new issue" page that links to `/api/bug-reports/:id`. The server holds no GitHub token. Reports live in memory until the next deploy, within the shared memory budget.
- *(My call:)* when a report names a room, the server snapshots that room's replay *at submit time* into the report. The report then stays reproducible after the replay itself is evicted. Bodies over 3 MB are rejected (the screenshot is the large part).
- **In production (decided):** replays and bug reports stay on, and players can press F8, so real playtests produce reproducible reports. The F8 button must therefore work in production even though the `~` overlay doesn't (a note for #13). With no login, these protections apply *(my calls)*:
  - Bug report ids are random UUIDs, so reports can't be listed or guessed. Replays are fetched by Colyseus room id, which is random too. No route lists replays or reports.
  - `POST /api/bug-reports` is rate-limited per IP (5 a minute), as well as size-capped.
  - Replays keep player names in every environment. *(Changed during review: redacting names made production replays impossible to re-run to their hash, and names are self-chosen display names.)* In production, `/api/stats` leaves out room ids and codes, and live replay downloads are rate-limited (10 a minute per IP).
- `Routes.bugReport` in the contract says `/api/bug-report` today. Renaming it to `/api/bug-reports` and adding a `bugReportById` route is a contract change; the PR says no game uses it yet.
- **Graceful shutdown:** on SIGTERM, send every client a `Notice` that the server is restarting, then let Colyseus close the rooms.

## Observability (decided: Railway-native)

Games deploy on Railway. Everything here uses what Railway already offers (log explorer, service CPU, memory and network charts), so no extra service has to run. The question it must answer quickly: *"this playtest feels laggy: is it the server or the network?"*

**Logs**

- pino, one shared logger from `@kit/host`. JSON everywhere except `local`, where it's pretty-printed.
- The message key is `message`, not pino's default `msg`, and levels are written as names (`info`, `error`), so Railway's log explorer reads the text and level and can filter on every field (`@roomId:…`, `@code:QXTR`, `@level:error`).
- Every line carries `env`, `sha` and `game`. Room lines also carry `roomId`, `code` and `tick`, and lines about a player add `playerId`, through a child logger for each room.
- Events logged at `info`: room created and closed (with duration and peak players), join, leave (with whether it was consented), drop, reconnect, seat expired, kick, every debug command (with its args and result), replay downloaded, bug report received (with its id).
- Rejected inputs are counted (see below) and logged at `debug` only, so a misbehaving client can't flood the logs.

**Stats for each room**

- Every 10 seconds *(my call)*, each live room logs one `room.stats` line covering the interval since the last one:

  | Field | Meaning |
  |---|---|
  | `players`, `connected` | Current seats, and how many of them are connected |
  | `ticks` | Ticks run in the interval |
  | `tickMsAvg`, `tickMsP95`, `tickMsMax` | Time spent in `step` plus the base's per-tick work |
  | `lateTicks` | Ticks that started later than one tick interval behind schedule |
  | `inputs`, `inputsRejected` | Inputs received; rejected, split by reason (`envelope`, `schema`, `stale-seq`, `paused`) |
  | `patches`, `bytesOut` | State patches sent and their total size |
  | `reconnects` | Successful reconnects |

- The process logs one `process.stats` line on the same timer: `rooms`, `players`, `eventLoopLagMs` (p95, from `perf_hooks.monitorEventLoopDelay`), `heapMb`, `replaysStored`, `bugReportsStored`.
- The timing code reads wall-clock time *around* the simulation, never inside it, so determinism isn't affected.

**Errors**

- An exception thrown by a game's `init`, `join`, `leave`, `step` or command handler is caught by the base. It's logged at `error` with the stack, `roomId`, `code`, `tick` and the replay URL. Players get a `Notice` and the room closes cleanly. The replay up to that tick stays downloadable, so the crash can be reproduced with `runReplay`.
- Uncaught exceptions and unhandled rejections at process level are logged at `error` before the process exits.

**Live views (outside production)**

- `GET /api/stats`: a JSON snapshot of the process stats plus every live room's latest stats. *(My call:)* this route also exists in production but leaves out player names.
- `@colyseus/monitor` at `/colyseus`.
- In debug mode the room sends each client its latest server tick time and late-tick count, so the `~` overlay in `@kit/core/client` can show server-side numbers next to ping. *(My call:)* this goes out as a `debug:stats` server message once per second, not in the synced state. Adding it to `ServerMessage` is a contract addition.

**Not included:** Prometheus, Grafana, OpenTelemetry tracing and Sentry. Sentry is the likely first add-on if errors get hard to spot in the logs.

## Template game (proof)

`server/template/` becomes a real game: players join with a name and colour, move with `{dx, dy}`, and collect seeded pickups that respawn at seeded positions. Its `config/game.json` gains `patchRate` and `reconnectSeconds`. The client stays minimal in this PR; the full lobby and overlay come with issue #13. Two browser tabs must be able to play in the same room by code.

**Tests:**

- Room tests with `@colyseus/testing`: join, leave, input applied on the next tick, a bad input is dropped, reconnect within the window, seat expiry, a debug command rejected in production.
- Replay test: drive a room with scripted inputs, save the replay, re-run it with `runReplay`, and check the same final state hash.
- Unit tests for room code generation and `RoomSettingsSchema`.

## Done when

The checklist in the issue:

- [ ] Two clients play the template in one room joined by code
- [ ] A refresh reconnects into the same room
- [ ] A recorded replay re-runs to the same final state hash (test)
- [ ] Debug commands work in local/development and are rejected in production
- [ ] Room tests with `@colyseus/testing`

Plus: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` passes, and `server/ARCHITECTURE.md` and `server/CLAUDE.md` describe the game definition and its rules.

## Left to the builder

- Exact names and file layout inside `@kit/core/server`.
- The room-code lookup mechanism (see above).
- How the template client's minimal lobby looks.
