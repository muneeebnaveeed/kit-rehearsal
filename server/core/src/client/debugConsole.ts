/**
 * Debug console: type a room debug command (`pause`, `step 5`, `set player.speed 300`, `kick <id>`,
 * or a game's own) and see the server's reply. The pure parts live here and are tested; the text box
 * itself is part of the ~ debug overlay (see `console` in DebugOverlayOptions).
 * The server rejects debug commands in production, and the overlay is off there too.
 */
import { DebugCommandSchema, type DebugResult } from "../shared/messages.ts";

export type ParsedCommand =
  | { readonly ok: true; readonly command: string; readonly args: string[] }
  | { readonly ok: false; readonly error: string };

/** Turns "set player.speed 300" (an optional leading "/" is fine) into a command and its arguments. */
export function parseDebugCommand(line: string): ParsedCommand {
  const words = line.trim().replace(/^\//, "").split(/\s+/).filter(Boolean);
  const [name, ...args] = words;
  if (!name) return { ok: false, error: "Type a command, e.g. pause or step 5." };

  const command = name.toLowerCase();
  const checked = DebugCommandSchema.safeParse({ id: "check", command, args });
  if (checked.success) return { ok: true, command, args };

  const field = checked.error.issues[0]?.path[0];
  return {
    ok: false,
    error:
      field === "command"
        ? `"${name}" is not a command name: use letters, digits, ":" and "-", starting with a letter.`
        : "Use at most 16 arguments of up to 200 characters each.",
  };
}

export interface CommandHistory {
  push(line: string): void;
  /** The older entry (up arrow); stays on the oldest one. */
  previous(): string;
  /** The newer entry (down arrow); "" after the newest one. */
  next(): string;
}

const DEFAULT_HISTORY_SIZE = 50;

export function createCommandHistory(maxEntries = DEFAULT_HISTORY_SIZE): CommandHistory {
  let entries: readonly string[] = [];
  let cursor = 0;

  return {
    push(line) {
      const trimmed = line.trim();
      if (trimmed && trimmed !== entries.at(-1)) entries = [...entries, trimmed].slice(-maxEntries);
      cursor = entries.length;
    },
    previous() {
      if (cursor > 0) cursor -= 1;
      return entries[cursor] ?? "";
    },
    next() {
      if (cursor < entries.length) cursor += 1;
      return entries[cursor] ?? "";
    },
  };
}

export interface ConsoleTranscript {
  readonly lines: readonly string[];
  /** Commands sent that have no reply yet. */
  readonly pending: number;
  sent(id: string, line: string): void;
  received(result: DebugResult): void;
  /** A message from the client itself, e.g. a command that could not be parsed. */
  note(error: string): void;
}

const DEFAULT_TRANSCRIPT_LINES = 100;
const INDENT = "  ";

export function createConsoleTranscript(maxLines = DEFAULT_TRANSCRIPT_LINES): ConsoleTranscript {
  let lines: readonly string[] = [];
  let pending: ReadonlyMap<string, string> = new Map();

  const add = (...added: string[]): void => {
    lines = [...lines, ...added].slice(-maxLines);
  };

  return {
    get lines() {
      return lines;
    },
    get pending() {
      return pending.size;
    },
    sent(id, line) {
      pending = new Map([...pending, [id, line]]);
      add(`> ${line}`);
    },
    received(result) {
      const isKnown = pending.has(result.id);
      pending = new Map([...pending].filter(([id]) => id !== result.id));
      const prefix = `${isKnown ? "" : `(${result.id}) `}${result.ok ? "" : "error: "}`;
      const [first = "", ...rest] = result.output.split("\n");
      add(`${INDENT}${prefix}${first}`, ...rest.map((text) => `${INDENT}${text}`));
    },
    note(error) {
      add(`${INDENT}error: ${error}`);
    },
  };
}
