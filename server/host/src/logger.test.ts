import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger, roomLogger } from "./logger.ts";

describe("logger", () => {
  it("writes Railway-friendly JSON: message key, level name, base and room fields", () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk, _enc, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const log = roomLogger(createLogger("template", { destination }), "r1", "QXTR");
    log.info({ tick: 5, playerId: "p1" }, "player joined");
    const line = JSON.parse(lines[0] ?? "{}");
    expect(line).toMatchObject({
      message: "player joined",
      level: "info",
      game: "template",
      roomId: "r1",
      code: "QXTR",
      tick: 5,
      playerId: "p1",
    });
    expect(line.env).toBeDefined();
    expect(line.sha).toBeDefined();
    expect(line.msg).toBeUndefined();
  });
});
