/** A RoomLog that keeps every line in memory, for tests. */
import type { RoomLog } from "../gameRoom.ts";

export interface LogLine {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  fields: Record<string, unknown>;
}

export function captureLog(
  lines: LogLine[] = [],
  bindings: Record<string, unknown> = {},
): RoomLog & { lines: LogLine[] } {
  const write = (level: LogLine["level"]) => (fields: object, message?: string) => {
    lines.push({ level, message: message ?? "", fields: { ...bindings, ...fields } });
  };
  return {
    lines,
    debug: write("debug"),
    info: write("info"),
    warn: write("warn"),
    error: write("error"),
    child: (more) => captureLog(lines, { ...bindings, ...more }),
  };
}
