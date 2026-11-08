import { describe, expect, it } from "vitest";
import { DebugCommandSchema } from "../shared/messages.ts";
import { createCommandHistory, createConsoleTranscript, parseDebugCommand } from "./debugConsole.ts";

describe("parseDebugCommand", () => {
  it("splits a command and its arguments", () => {
    expect(parseDebugCommand("set player.speed 300")).toEqual({
      ok: true,
      command: "set",
      args: ["player.speed", "300"],
    });
  });

  it("accepts a leading slash, extra spaces and upper case", () => {
    expect(parseDebugCommand("  /STEP   5 ")).toEqual({ ok: true, command: "step", args: ["5"] });
  });

  it("produces commands the server's schema accepts", () => {
    const parsed = parseDebugCommand("tp p1 10 20");
    if (!parsed.ok) throw new Error(parsed.error);
    expect(() =>
      DebugCommandSchema.parse({ id: "c1", command: parsed.command, args: parsed.args }),
    ).not.toThrow();
  });

  it("rejects empty input and invalid command names", () => {
    expect(parseDebugCommand("   ").ok).toBe(false);
    expect(parseDebugCommand("1pause").ok).toBe(false);
    expect(parseDebugCommand("pa$use").ok).toBe(false);
  });

  it("rejects too many or too long arguments", () => {
    expect(parseDebugCommand(`set ${"a ".repeat(17)}`).ok).toBe(false);
    expect(parseDebugCommand(`set ${"x".repeat(201)}`).ok).toBe(false);
  });
});

describe("createCommandHistory", () => {
  it("walks back and forward through sent commands", () => {
    const history = createCommandHistory();
    history.push("pause");
    history.push("step 5");
    expect(history.previous()).toBe("step 5");
    expect(history.previous()).toBe("pause");
    expect(history.previous()).toBe("pause");
    expect(history.next()).toBe("step 5");
    expect(history.next()).toBe("");
  });

  it("skips empty lines and repeats of the last command", () => {
    const history = createCommandHistory();
    history.push("pause");
    history.push("pause");
    history.push("  ");
    expect(history.previous()).toBe("pause");
    expect(history.previous()).toBe("pause");
    expect(history.next()).toBe("");
  });

  it("keeps only the newest entries", () => {
    const history = createCommandHistory(2);
    for (const line of ["a", "b", "c"]) history.push(line);
    expect(history.previous()).toBe("c");
    expect(history.previous()).toBe("b");
    expect(history.previous()).toBe("b");
  });
});

describe("createConsoleTranscript", () => {
  it("shows a command and then its reply", () => {
    const transcript = createConsoleTranscript();
    transcript.sent("c1", "pause");
    transcript.received({ id: "c1", ok: true, output: "paused" });
    expect(transcript.lines).toEqual(["> pause", "  paused"]);
    expect(transcript.pending).toBe(0);
  });

  it("marks failed commands and replies to unknown ids", () => {
    const transcript = createConsoleTranscript();
    transcript.sent("c1", "kick nobody");
    transcript.received({ id: "c1", ok: false, output: "no such player" });
    transcript.received({ id: "zz", ok: true, output: "late reply" });
    expect(transcript.lines).toEqual(["> kick nobody", "  error: no such player", "  (zz) late reply"]);
  });

  it("splits multi-line output and keeps only the newest lines", () => {
    const transcript = createConsoleTranscript(3);
    transcript.sent("c1", "help");
    transcript.received({ id: "c1", ok: true, output: "a\nb\nc" });
    expect(transcript.lines).toEqual(["  a", "  b", "  c"]);
  });

  it("records local errors without sending anything", () => {
    const transcript = createConsoleTranscript();
    transcript.note("Unknown command name");
    expect(transcript.lines).toEqual(["  error: Unknown command name"]);
  });
});
