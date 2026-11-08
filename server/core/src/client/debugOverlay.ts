/**
 * Debug overlay: a text panel in the top-right corner, toggled with the ~ key.
 * Plain DOM on top of the page, so it works with any renderer (Canvas, Phaser, Three.js).
 * Shown only when the server says debug is on (`debug` in /health).
 */
import type { AppEnv } from "../shared/env.ts";
import type { DebugCommand, DebugResult } from "../shared/messages.ts";
import { createCommandHistory, createConsoleTranscript, parseDebugCommand } from "./debugConsole.ts";

/** The game server's /health, or the part of it the debug tools need. */
export interface BuildInfo {
  readonly env: AppEnv;
  readonly sha: string;
  readonly debug: boolean;
}

/** The server decides, not the client's own env: one production game can have DEBUG_TOOLS on. */
export function showsDebugTools(build: BuildInfo): boolean {
  return build.debug;
}

/** What the overlay shows. `null` means "not known yet" and is shown as a dash. */
export interface DebugStats {
  readonly roomId: string | null;
  readonly roomCode: string | null;
  readonly playerId: string | null;
  readonly tick: number | null;
  readonly pingMs: number | null;
  readonly patchesPerSecond: number | null;
  readonly bytesPerSecond: number | null;
  readonly fps: number;
  readonly frameMs: number;
}

/** Game-specific lines, e.g. `{ pickups: 5 }`. */
export type DebugExtras = Readonly<Record<string, string | number | boolean>>;

export interface DebugOverlay {
  readonly isOpen: boolean;
  /** Call every frame; the text is redrawn at most a few times a second. */
  update(stats: DebugStats, extras?: DebugExtras, now?: number): void;
  /** Pass every `debug:result` message from the room here, so the console shows the reply. */
  handleDebugResult(result: DebugResult): void;
  toggle(): void;
  destroy(): void;
}

export interface DebugConsoleOptions {
  /** Sends a command to the room, e.g. `(cmd) => room.send(ClientMessage.DebugCommand, cmd)`. */
  readonly send: (command: DebugCommand) => void;
}

export interface DebugOverlayOptions {
  readonly build: BuildInfo;
  /** Open right away, e.g. from `?debug`. */
  readonly startOpen?: boolean;
  /** Where to put the panel. Defaults to document.body. */
  readonly parent?: HTMLElement;
  /** Where to listen for the ~ key. Defaults to window. */
  readonly keyTarget?: Window;
  /** Adds a command box under the stats. Leave it out when there is no room to talk to. */
  readonly console?: DebugConsoleOptions;
}

const LABEL_WIDTH = 8;
const SHORT_SHA_LENGTH = 7;
const BYTES_PER_KB = 1_024;
const REFRESH_MS = 250;
// Matched by key position (code) and by character (key), because layouts put ~ in different places.
const TOGGLE_CODE = "Backquote";
const TOGGLE_CHARACTERS = ["`", "~"];

const FONT = "13px/1.4 ui-monospace, Consolas, Menlo, monospace";
const TEXT_COLOR = "#b8f5c8";
const CONSOLE_WIDTH = "360px";
const CONSOLE_OUTPUT_HEIGHT = "160px";

const CONTAINER_STYLE: Partial<CSSStyleDeclaration> = {
  position: "fixed",
  top: "8px",
  right: "8px",
  zIndex: "9999",
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-end",
  gap: "6px",
  pointerEvents: "none",
};

const BOX_STYLE: Partial<CSSStyleDeclaration> = {
  margin: "0",
  padding: "10px 12px",
  borderRadius: "6px",
  background: "rgba(10, 12, 20, 0.85)",
  color: TEXT_COLOR,
  font: FONT,
  whiteSpace: "pre",
};

const NO_OVERLAY: DebugOverlay = {
  isOpen: false,
  update() {},
  handleDebugResult() {},
  toggle() {},
  destroy() {},
};

const isToggleKey = (event: KeyboardEvent): boolean =>
  event.code === TOGGLE_CODE || TOGGLE_CHARACTERS.includes(event.key);

export function formatDebugLines(build: BuildInfo, stats: DebugStats, extras: DebugExtras = {}): string[] {
  const lines: [string, string][] = [
    ["env", build.env],
    ["sha", build.sha.slice(0, SHORT_SHA_LENGTH)],
    ["room", formatRoom(stats.roomCode, stats.roomId)],
    ["player", stats.playerId ?? "-"],
    ["tick", stats.tick === null ? "-" : String(stats.tick)],
    ["ping", stats.pingMs === null ? "-" : `${Math.round(stats.pingMs)} ms`],
    ["patches", stats.patchesPerSecond === null ? "-" : `${Math.round(stats.patchesPerSecond)}/s`],
    ["bytes", stats.bytesPerSecond === null ? "-" : formatBytesPerSecond(stats.bytesPerSecond)],
    ["fps", String(Math.round(stats.fps))],
    ["frame", `${stats.frameMs.toFixed(1)} ms`],
    ...Object.entries(extras).map(([label, value]): [string, string] => [label, String(value)]),
  ];
  return lines.map(([label, value]) => `${label.padEnd(LABEL_WIDTH)} ${value}`);
}

export function createDebugOverlay(options: DebugOverlayOptions): DebugOverlay {
  if (!showsDebugTools(options.build)) return NO_OVERLAY;

  const keyTarget = options.keyTarget ?? window;
  const container = document.createElement("div");
  Object.assign(container.style, CONTAINER_STYLE);
  // The inline display: flex beats the hidden attribute, so display follows it by hand.
  const setOpen = (open: boolean): void => {
    container.hidden = !open;
    container.style.display = open ? "flex" : "none";
  };
  setOpen(options.startOpen === true);
  const statsPanel = document.createElement("pre");
  Object.assign(statsPanel.style, BOX_STYLE);
  container.append(statsPanel);

  let lastRefreshAt = Number.NEGATIVE_INFINITY;
  const toggle = (): void => {
    setOpen(container.hidden);
    lastRefreshAt = Number.NEGATIVE_INFINITY; // show fresh numbers as soon as it opens
  };

  const commandBox = options.console ? createCommandBox(options.console, toggle) : null;
  if (commandBox) container.append(commandBox.element);
  (options.parent ?? document.body).append(container);

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!isToggleKey(event) || event.repeat || isTyping(event.target)) return;
    event.preventDefault();
    toggle();
  };
  keyTarget.addEventListener("keydown", onKeyDown);

  return {
    get isOpen() {
      return !container.hidden;
    },
    update(stats, extras, now = performance.now()) {
      if (container.hidden || now - lastRefreshAt < REFRESH_MS) return;
      lastRefreshAt = now;
      statsPanel.textContent = formatDebugLines(options.build, stats, extras).join("\n");
    },
    handleDebugResult(result) {
      commandBox?.handleResult(result);
    },
    toggle,
    destroy() {
      keyTarget.removeEventListener("keydown", onKeyDown);
      container.remove();
    },
  };
}

interface CommandBox {
  readonly element: HTMLElement;
  handleResult(result: DebugResult): void;
}

/** The console's text box and output. Keys typed here never reach the game. */
function createCommandBox(consoleOptions: DebugConsoleOptions, toggleOverlay: () => void): CommandBox {
  const transcript = createConsoleTranscript();
  const history = createCommandHistory();
  let nextId = 1;

  const element = document.createElement("form");
  Object.assign(element.style, BOX_STYLE, {
    width: CONSOLE_WIDTH,
    pointerEvents: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  });
  const output = document.createElement("pre");
  Object.assign(output.style, {
    margin: "0",
    maxHeight: CONSOLE_OUTPUT_HEIGHT,
    overflowY: "auto",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  });
  output.textContent = "Debug console: type a command (pause, step 5, set player.speed 300) and press Enter.";
  const input = document.createElement("input");
  input.setAttribute("aria-label", "Debug command");
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = "command";
  Object.assign(input.style, {
    font: FONT,
    color: TEXT_COLOR,
    background: "rgba(255, 255, 255, 0.06)",
    border: "1px solid rgba(184, 245, 200, 0.3)",
    borderRadius: "4px",
    padding: "4px 6px",
  });
  element.append(output, input);

  const render = (): void => {
    output.textContent = transcript.lines.join("\n");
    output.scrollTop = output.scrollHeight;
  };

  element.addEventListener("submit", (event) => {
    event.preventDefault();
    const line = input.value;
    input.value = "";
    history.push(line);
    const parsed = parseDebugCommand(line);
    if (parsed.ok) {
      const id = `dc-${nextId++}`;
      transcript.sent(id, line.trim());
      consoleOptions.send({ id, command: parsed.command, args: parsed.args });
    } else {
      transcript.note(parsed.error);
    }
    render();
  });

  // Keys typed in the box stay here, so typing "step" doesn't also move the player.
  const keepKeysHere = (event: KeyboardEvent): void => event.stopPropagation();
  input.addEventListener("keyup", keepKeysHere);
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (isToggleKey(event)) {
      event.preventDefault();
      input.blur();
      toggleOverlay();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      input.value = history.previous();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      input.value = history.next();
    } else if (event.key === "Escape") {
      input.blur();
    }
  });

  return {
    element,
    handleResult(result) {
      transcript.received(result);
      render();
    },
  };
}

function formatRoom(code: string | null, id: string | null): string {
  if (code && id) return `${code} (${id})`;
  return code ?? id ?? "-";
}

function formatBytesPerSecond(bytes: number): string {
  return bytes < BYTES_PER_KB ? `${Math.round(bytes)} B/s` : `${(bytes / BYTES_PER_KB).toFixed(1)} KB/s`;
}

/** Don't steal the ~ key while the player types in a text field (e.g. the room code box). */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
  );
}
