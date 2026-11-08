/**
 * The shared pino logger. JSON everywhere except local, with `message` as the message key and
 * level names, so Railway's log explorer shows the text and can filter on every field.
 */
import { type Logger, pino } from "pino";
import { APP_ENV, GIT_SHA } from "./env.ts";

export type { Logger } from "pino";

export function createLogger(
  game: string,
  opts: { level?: string; destination?: pino.DestinationStream } = {},
): Logger {
  const options: pino.LoggerOptions = {
    level: opts.level ?? process.env.LOG_LEVEL ?? "info",
    messageKey: "message",
    formatters: { level: (label) => ({ level: label }) },
    base: { env: APP_ENV, sha: GIT_SHA, game },
  };
  if (opts.destination) return pino(options, opts.destination);
  if (APP_ENV === "local") {
    return pino({ ...options, transport: { target: "pino-pretty", options: { messageKey: "message" } } });
  }
  return pino(options);
}

/** Child logger carrying the room's id and code on every line. */
export function roomLogger(logger: Logger, roomId: string, code: string): Logger {
  return logger.child({ roomId, code });
}
