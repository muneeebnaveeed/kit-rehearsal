/**
 * F8 bug report: a player or tester presses F8, types one line, and gets a report with a screenshot,
 * recent logs and the room's details, saved on the server (with the room's replay) and linked from a
 * pre-filled GitHub issue. The pure parts (log buffer, report, issue link, sending) are tested;
 * `createBugReporter` adds the F8 key and a small status message. Off when the server has debug off.
 */
import {
  type BugReport,
  BugReportCreatedSchema,
  BugReportSchema,
  type NetConditions,
  Routes,
} from "../shared/messages.ts";
import { type BuildInfo, showsDebugTools } from "./debugOverlay.ts";

export type LogLevel = "log" | "info" | "warn" | "error";
const LOG_LEVELS: readonly LogLevel[] = ["log", "info", "warn", "error"];
const MS_PER_SECOND = 1_000;
const DEFAULT_LOG_LINES = 200;
const MAX_REPORT_LOGS = 500;
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 5_000;
const SHORT_SHA_LENGTH = 7;

type ConsoleLike = Record<LogLevel, (...args: unknown[]) => void>;

export interface LogBuffer {
  readonly lines: readonly string[];
  add(level: LogLevel, ...parts: unknown[]): void;
  /** Also records everything written to the console. Returns a function that stops it. */
  captureConsole(target?: ConsoleLike): () => void;
}

/** Keeps the newest log lines, stamped with seconds since the page loaded. */
export function createLogBuffer(
  maxLines = DEFAULT_LOG_LINES,
  now: () => number = () => performance.now(),
): LogBuffer {
  let lines: readonly string[] = [];
  const add = (level: LogLevel, ...parts: unknown[]): void => {
    const seconds = (now() / MS_PER_SECOND).toFixed(1);
    lines = [...lines, `+${seconds}s ${level} ${parts.map(describe).join(" ")}`].slice(-maxLines);
  };
  return {
    get lines() {
      return lines;
    },
    add,
    captureConsole(target = console) {
      const originals = LOG_LEVELS.map((level) => [level, target[level]] as const);
      for (const [level, original] of originals) {
        target[level] = (...args: unknown[]) => {
          add(level, ...args);
          original.apply(target, args);
        };
      }
      return () => {
        for (const [level, original] of originals) target[level] = original;
      };
    },
  };
}

function describe(part: unknown): string {
  if (typeof part === "string") return part;
  if (part instanceof Error) return `${part.name}: ${part.message}`;
  try {
    return JSON.stringify(part) ?? String(part);
  } catch {
    return String(part);
  }
}

/** Where the report comes from. Room fields are null when the player is not in a room. */
export interface BugReportContext {
  readonly game: string;
  readonly build: BuildInfo;
  readonly roomId: string | null;
  readonly roomCode: string | null;
  readonly playerId: string | null;
  readonly tick: number | null;
  readonly scenario: string | null;
  /** Active network simulation, if any (see createNetSimulator). */
  readonly net: NetConditions | null;
  readonly url: string;
  readonly userAgent: string;
}

export interface BugReportInput {
  readonly title: string;
  readonly description?: string;
  readonly logs: readonly string[];
  /** A data:image/… URL of the game canvas, or null. */
  readonly screenshot: string | null;
}

export function buildBugReport(context: BugReportContext, input: BugReportInput): BugReport {
  const title = input.title.trim() || `Bug report at tick ${context.tick ?? "?"}`;
  const isImage = input.screenshot?.startsWith("data:image/") ?? false;
  return BugReportSchema.parse({
    title: title.slice(0, MAX_TITLE),
    description: (input.description ?? "").slice(0, MAX_DESCRIPTION),
    game: context.game,
    env: context.build.env,
    sha: context.build.sha,
    roomId: context.roomId,
    playerId: context.playerId,
    tick: context.tick,
    scenario: context.scenario,
    url: context.url,
    userAgent: context.userAgent,
    net: context.net,
    logs: input.logs.slice(-MAX_REPORT_LOGS),
    screenshot: isImage ? input.screenshot : null,
  });
}

export interface IssueLinkOptions {
  /** GitHub repository, e.g. "OWNER/REPO". */
  readonly repo: string;
  /** The team that owns the game, e.g. "team-2". */
  readonly teamLabel: string;
  readonly report: BugReport;
  readonly roomCode: string | null;
  readonly reportUrl: string;
  readonly replayUrl: string | null;
}

/** A link that opens a new GitHub issue from the bug template, filled in with the report's details. */
export function buildIssueUrl(options: IssueLinkOptions): string {
  const { report } = options;
  const room = options.roomCode ? `${options.roomCode} (${report.roomId ?? "?"})` : (report.roomId ?? "none");
  const net = report.net
    ? `${report.net.latencyMs} ms lag, ${report.net.jitterMs} ms jitter, ${report.net.lossPct}% loss`
    : "none";
  const body = [
    "## Goal",
    "",
    `${report.title}. Reported from the game with F8.`,
    "",
    `- Bug report (screenshot, logs, replay): ${options.reportUrl}`,
    ...(options.replayUrl ? [`- Replay: ${options.replayUrl}`] : []),
    `- Room ${room}, player ${report.playerId ?? "none"}, tick ${report.tick ?? "?"}`,
    `- Build: ${report.env}, ${report.sha.slice(0, SHORT_SHA_LENGTH)}`,
    `- Network simulation: ${net}`,
    "",
    "## Steps to reproduce",
    "",
    "1. Open the bug report link above: it has the screenshot, the logs and the room's replay.",
    "2. Run the replay to the tick above.",
    "",
    "## Expected behaviour",
    "",
    "Describe what should have happened.",
    "",
    "## Actual behaviour",
    "",
    report.description || report.title,
    "",
    "## What changes",
    "",
    "Unknown yet",
    "",
    "## Done when",
    "",
    "- [ ] The replay no longer shows the bug",
  ].join("\n");

  const url = new URL(`https://github.com/${options.repo}/issues/new`);
  url.searchParams.set("template", "bug.md");
  url.searchParams.set("labels", `bug,${options.teamLabel}`);
  url.searchParams.set("title", report.title);
  url.searchParams.set("body", body);
  return url.toString();
}

export interface SavedBugReport {
  readonly id: string;
  /** Absolute link to the stored report. */
  readonly url: string;
}

const HTTP_TOO_LARGE = 413;
const HTTP_TOO_MANY = 429;

/**
 * `path` below the game server's address. Never `new URL(path, serverUrl)`: a path that starts with `/`
 * replaces the base's own path, which drops the prefix a game is served under (`/team-2` behind the gateway).
 */
export function serverLink(serverUrl: string, path: string): string {
  return `${serverUrl.replace(/\/+$/, "")}${path}`;
}

/** Posts the report to the game server. Throws an Error with a message players can read. */
export async function sendBugReport(
  serverUrl: string,
  report: BugReport,
  fetchFn: typeof fetch = fetch,
): Promise<SavedBugReport> {
  const res = await fetchFn(serverLink(serverUrl, Routes.bugReports), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(report),
  });
  if (res.status === HTTP_TOO_LARGE) throw new Error("The report is too large (over 3 MB).");
  if (res.status === HTTP_TOO_MANY) throw new Error("Too many bug reports: try again in a minute.");
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (body as { error?: unknown } | null)?.error;
    throw new Error(`Bug report failed: ${typeof error === "string" ? error : `HTTP ${res.status}`}`);
  }
  const created = BugReportCreatedSchema.parse(body);
  return { id: created.id, url: serverLink(serverUrl, created.url) };
}

export interface BugReporterOptions {
  readonly serverUrl: string;
  /** GitHub repository for the pre-filled issue, e.g. "OWNER/REPO". */
  readonly issueRepo: string;
  readonly teamLabel: string;
  readonly logs: LogBuffer;
  /** Called when F8 is pressed, so the report has the room's details at that moment. */
  readonly getContext: () => BugReportContext;
  /** The game's canvas for the screenshot. Leave out, or return null, for no screenshot. */
  readonly getCanvas?: () => HTMLCanvasElement | null;
  readonly keyTarget?: Window;
}

export interface BugReporter {
  destroy(): void;
}

const REPORT_KEY = "F8";
const MAX_SCREENSHOT_CHARS = 2_500_000; // stays under the server's 3 MB limit with the rest
const JPEG_QUALITY = 0.7;
const STATUS_MS = 15_000;

/** Listens for F8 and files a bug report. Does nothing when the server has debug off. */
export function createBugReporter(options: BugReporterOptions): BugReporter {
  if (!showsDebugTools(options.getContext().build)) return { destroy() {} };
  const keyTarget = options.keyTarget ?? window;

  const status = document.createElement("div");
  Object.assign(status.style, {
    position: "fixed",
    left: "8px",
    bottom: "8px",
    zIndex: "9999",
    maxWidth: "420px",
    padding: "8px 12px",
    borderRadius: "6px",
    background: "rgba(10, 12, 20, 0.9)",
    color: "#b8f5c8",
    font: "13px/1.4 ui-monospace, Consolas, Menlo, monospace",
  });
  status.hidden = true;
  document.body.append(status);
  let hideTimer = 0;
  let isBusy = false;

  const show = (text: string, links: readonly [string, string][] = []): void => {
    status.replaceChildren(document.createTextNode(text));
    for (const [label, href] of links) {
      const link = document.createElement("a");
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = label;
      Object.assign(link.style, { color: "#9ecbff", marginLeft: "8px" });
      status.append(link);
    }
    status.hidden = false;
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      status.hidden = true;
    }, STATUS_MS);
  };

  const report = async (): Promise<void> => {
    const context = options.getContext();
    const screenshot = takeScreenshot(options.getCanvas?.() ?? null);
    const title = window.prompt("Bug report: what went wrong? (one line)", "");
    if (title === null) return;
    const bugReport = buildBugReport(context, { title, logs: options.logs.lines, screenshot });
    show("Sending bug report…");
    const saved = await sendBugReport(options.serverUrl, bugReport);
    const issueUrl = buildIssueUrl({
      repo: options.issueRepo,
      teamLabel: options.teamLabel,
      report: bugReport,
      roomCode: context.roomCode,
      reportUrl: saved.url,
      replayUrl: context.roomId ? serverLink(options.serverUrl, Routes.replay(context.roomId)) : null,
    });
    show("Bug report saved.", [
      ["Open report", saved.url],
      ["Create GitHub issue", issueUrl],
    ]);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== REPORT_KEY || event.repeat) return;
    event.preventDefault();
    if (isBusy) return;
    isBusy = true;
    report()
      .catch((error: unknown) => show(error instanceof Error ? error.message : String(error)))
      .finally(() => {
        isBusy = false;
      });
  };
  keyTarget.addEventListener("keydown", onKeyDown);

  return {
    destroy() {
      keyTarget.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(hideTimer);
      status.remove();
    },
  };
}

/** PNG of the canvas, or a smaller JPEG when the PNG would be too big for the server. */
function takeScreenshot(canvas: HTMLCanvasElement | null): string | null {
  if (!canvas) return null;
  try {
    const png = canvas.toDataURL("image/png");
    return png.length <= MAX_SCREENSHOT_CHARS ? png : canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  } catch {
    return null; // e.g. a canvas tainted by a cross-origin image
  }
}
