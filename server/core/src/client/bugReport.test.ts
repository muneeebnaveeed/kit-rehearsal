import { describe, expect, it } from "vitest";
import { BugReportSchema } from "../shared/messages.ts";
import {
  type BugReportContext,
  buildBugReport,
  buildIssueUrl,
  createBugReporter,
  createLogBuffer,
  sendBugReport,
  serverLink,
} from "./bugReport.ts";

const CONTEXT: BugReportContext = {
  game: "template",
  build: { env: "development", sha: "0123456789abcdef", debug: true },
  roomId: "abc123",
  roomCode: "QXTR",
  playerId: "s1",
  tick: 420,
  scenario: null,
  net: { latencyMs: 150, jitterMs: 30, lossPct: 5 },
  url: "http://localhost:5173/?room=QXTR",
  userAgent: "test-agent",
};

describe("createLogBuffer", () => {
  it("keeps the newest lines with a level and time", () => {
    const logs = createLogBuffer(2, () => 1_000);
    logs.add("info", "joined");
    logs.add("warn", "slow tick");
    logs.add("error", "boom");
    expect(logs.lines).toEqual(["+1.0s warn slow tick", "+1.0s error boom"]);
  });

  it("turns objects and errors into readable text", () => {
    const logs = createLogBuffer(5, () => 0);
    logs.add("error", new Error("bad input"), { x: 1 });
    expect(logs.lines[0]).toContain("bad input");
    expect(logs.lines[0]).toContain('{"x":1}');
  });

  it("copies console output and stops when restored", () => {
    const logs = createLogBuffer(10, () => 0);
    const silent = (..._args: unknown[]): void => {};
    const fake = { log: silent, info: silent, warn: silent, error: silent };
    const restore = logs.captureConsole(fake);
    fake.warn("careful");
    restore();
    fake.warn("not captured");
    expect(logs.lines).toEqual(["+0.0s warn careful"]);
  });
});

describe("buildBugReport", () => {
  it("builds a report the server's schema accepts", () => {
    const report = buildBugReport(CONTEXT, {
      title: "Player stuck in wall",
      description: "Walked left at the door",
      logs: ["a", "b"],
      screenshot: "data:image/png;base64,AAAA",
    });
    expect(() => BugReportSchema.parse(report)).not.toThrow();
    expect(report).toMatchObject({ roomId: "abc123", tick: 420, sha: "0123456789abcdef", game: "template" });
  });

  it("uses a default title and drops a screenshot the server would reject", () => {
    const report = buildBugReport(CONTEXT, { title: "  ", logs: [], screenshot: "not-an-image" });
    expect(report.title).toBe("Bug report at tick 420");
    expect(report.screenshot).toBeNull();
  });

  it("keeps only the newest 500 log lines", () => {
    const logs = Array.from({ length: 600 }, (_, i) => `line ${i}`);
    const report = buildBugReport(CONTEXT, { title: "x", logs, screenshot: null });
    expect(report.logs).toHaveLength(500);
    expect(report.logs[0]).toBe("line 100");
  });
});

describe("buildIssueUrl", () => {
  it("opens the bug template with the report link and the room's details", () => {
    const report = buildBugReport(CONTEXT, { title: "Player stuck", logs: [], screenshot: null });
    const url = new URL(
      buildIssueUrl({
        repo: "OWNER/REPO",
        teamLabel: "team-2",
        report,
        roomCode: "QXTR",
        reportUrl: "http://localhost:2567/api/bug-reports/42",
        replayUrl: "http://localhost:2567/api/replays/abc123",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://github.com/OWNER/REPO/issues/new");
    expect(url.searchParams.get("template")).toBe("bug.md");
    expect(url.searchParams.get("labels")).toBe("bug,team-2");
    expect(url.searchParams.get("title")).toBe("Player stuck");
    const body = url.searchParams.get("body") ?? "";
    expect(body).toContain("## Goal");
    expect(body).toContain("## Done when");
    expect(body).toContain("http://localhost:2567/api/bug-reports/42");
    expect(body).toContain("tick 420");
    expect(body).toContain("150 ms");
  });
});

describe("sendBugReport", () => {
  const report = buildBugReport(CONTEXT, { title: "x", logs: [], screenshot: null });
  const reply = (status: number, body: unknown) => async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("returns the stored report's id and full link", async () => {
    const created = await sendBugReport(
      "http://localhost:2567",
      report,
      reply(201, {
        id: "0b6c6a4e-3c3b-4f0b-9a55-6f6a2b1c9d10",
        url: "/api/bug-reports/0b6c6a4e-3c3b-4f0b-9a55-6f6a2b1c9d10",
      }),
    );
    expect(created.url).toBe("http://localhost:2567/api/bug-reports/0b6c6a4e-3c3b-4f0b-9a55-6f6a2b1c9d10");
  });

  it("keeps the path the game is served under, so the links work behind the gateway", async () => {
    const urls: string[] = [];
    const created = await sendBugReport("https://game.example/team-2", report, async (url) => {
      urls.push(String(url));
      return new Response(
        JSON.stringify({
          id: "0b6c6a4e-3c3b-4f0b-9a55-6f6a2b1c9d10",
          url: "/api/bug-reports/0b6c6a4e-3c3b-4f0b-9a55-6f6a2b1c9d10",
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    });
    expect(urls).toEqual(["https://game.example/team-2/api/bug-reports"]);
    expect(created.url).toBe(
      "https://game.example/team-2/api/bug-reports/0b6c6a4e-3c3b-4f0b-9a55-6f6a2b1c9d10",
    );
  });

  it("explains rejected reports", async () => {
    await expect(sendBugReport("http://x", report, reply(413, {}))).rejects.toThrow(/too large/);
    await expect(sendBugReport("http://x", report, reply(429, {}))).rejects.toThrow(/a minute/);
    await expect(
      sendBugReport("http://x", report, reply(400, { error: "invalid bug report" })),
    ).rejects.toThrow(/invalid bug report/);
  });
});

describe("serverLink", () => {
  it("adds the path below the server's own path instead of replacing it", () => {
    expect(serverLink("https://game.example/team-2", "/api/replays/r1")).toBe(
      "https://game.example/team-2/api/replays/r1",
    );
    expect(serverLink("https://game.example", "/api/replays/r1")).toBe("https://game.example/api/replays/r1");
    expect(serverLink("http://localhost:2567/", "/api/replays/r1")).toBe(
      "http://localhost:2567/api/replays/r1",
    );
  });
});

describe("createBugReporter", () => {
  it("adds no F8 listener when the server has debug off, even in development", () => {
    // No DOM in this test run: touching window would throw.
    const reporter = createBugReporter({
      serverUrl: "http://x",
      issueRepo: "OWNER/REPO",
      teamLabel: "platform",
      logs: createLogBuffer(),
      getContext: () => ({ ...CONTEXT, build: { ...CONTEXT.build, debug: false } }),
    });
    expect(() => reporter.destroy()).not.toThrow();
  });
});
