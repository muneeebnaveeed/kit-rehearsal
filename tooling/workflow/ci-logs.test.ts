// Tests for `pnpm pr:ci-logs` (lib/ci-logs.ts).
import { describe, expect, it } from "vitest";
import {
  type Check,
  cleanLog,
  errorLines,
  excerpt,
  failingChecks,
  logFileName,
  parseJobLink,
  summaryMarkdown,
} from "./lib/ci-logs.ts";

const job = "https://github.com/OWNER/REPO/actions/runs/42401518305/job/128490133602";
const check = (over: Partial<Check>): Check => ({
  name: "🧪 test",
  state: "FAILURE",
  bucket: "fail",
  link: job,
  workflow: "CI",
  startedAt: "2026-11-07T10:00:00Z",
  ...over,
});

describe("parseJobLink", () => {
  it("reads the run and job ids of an Actions job", () => {
    expect(parseJobLink(job)).toEqual({ runId: "42401518305", jobId: "128490133602" });
  });

  it("returns null for any other link", () => {
    expect(parseJobLink("https://railway.com/project/abc")).toBeNull();
  });
});

describe("failingChecks", () => {
  it("keeps failing Actions jobs and external statuses apart", () => {
    const { jobs, external } = failingChecks([
      check({}),
      check({ name: "📦 build", bucket: "pass", state: "SUCCESS" }),
      check({ workflow: "", name: "Railway", link: "https://railway.com/x" }),
    ]);
    expect(jobs.map((j) => j.name)).toEqual(["🧪 test"]);
    expect(jobs[0]?.jobId).toBe("128490133602");
    expect(external.map((e) => e.name)).toEqual(["Railway"]);
  });

  it("judges each check by its latest run, so a re-run that passed is not a failure", () => {
    const { jobs } = failingChecks([
      check({ startedAt: "2026-11-07T10:00:00Z" }),
      check({ startedAt: "2026-11-07T11:00:00Z", bucket: "pass", state: "SUCCESS" }),
    ]);
    expect(jobs).toEqual([]);
  });

  it("reports a check whose latest run failed after an earlier pass", () => {
    const { jobs } = failingChecks([
      check({ startedAt: "2026-11-07T10:00:00Z", bucket: "pass" }),
      check({ startedAt: "2026-11-07T11:00:00Z" }),
    ]);
    expect(jobs).toHaveLength(1);
  });
});

describe("cleanLog", () => {
  it("drops GitHub's timestamps and colour codes", () => {
    expect(cleanLog("2026-11-07T10:00:01.1234567Z \u001b[31mFAIL\u001b[0m room.test.ts\r\nplain")).toEqual([
      "FAIL room.test.ts",
      "plain",
    ]);
  });
});

describe("excerpt", () => {
  // The shape of a real Workflow checks log: two failed steps, each a setup group, output, ##[error].
  const log = [
    "##[group]Run node check-pr.mjs",
    "node check-pr.mjs",
    "env:",
    "  BASE_REF: feature/team-4",
    "##[endgroup]",
    "PR does not follow the feature template:",
    "  - [labels] Needs exactly one team label; has 0.",
    "##[error]Process completed with exit code 1.",
    "##[group]Run node check-branch.mjs",
    "node check-branch.mjs",
    "##[endgroup]",
    "  - [issue] Issue #66 is closed.",
    "##[error]Process completed with exit code 1.",
    "Post job cleanup.",
  ];

  it("shows each failed step's command and its output, not its setup", () => {
    expect(excerpt(log)).toEqual([
      "$ node check-pr.mjs",
      "PR does not follow the feature template:",
      "  - [labels] Needs exactly one team label; has 0.",
      "Process completed with exit code 1.",
      "",
      "$ node check-branch.mjs",
      "  - [issue] Issue #66 is closed.",
      "Process completed with exit code 1.",
    ]);
  });

  it("keeps the end of a long step", () => {
    const long = ["##[endgroup]", ...Array.from({ length: 50 }, (_, i) => `line ${i}`), "##[error]boom"];
    expect(excerpt(long, 2)).toEqual(["…", "line 48", "line 49", "boom"]);
  });

  it("falls back to error-looking lines when the log has no ##[error] marker", () => {
    expect(excerpt(["setup", "FAIL room.test.ts", "done", "cleanup"])).toEqual([
      "setup",
      "FAIL room.test.ts",
      "done",
    ]);
  });
});

describe("errorLines", () => {
  it("keeps error lines with one line of context around each", () => {
    const lines = [
      "setup",
      "install",
      "run tests",
      "FAIL room.test.ts > joins",
      "AssertionError: expected 1",
      "done",
      "cleanup",
    ];
    expect(errorLines(lines)).toEqual([
      "run tests",
      "FAIL room.test.ts > joins",
      "AssertionError: expected 1",
      "done",
    ]);
  });

  it("marks gaps between distant error lines", () => {
    expect(errorLines(["error one", "a", "b", "c", "error two"])).toEqual([
      "error one",
      "a",
      "…",
      "c",
      "error two",
    ]);
  });

  it("falls back to the end of the log when no line looks like an error", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    expect(errorLines(lines, 3)).toEqual(["line 97", "line 98", "line 99"]);
  });
});

describe("logFileName", () => {
  it("makes a plain file name from the workflow and check", () => {
    expect(logFileName({ workflow: "CI", name: "🧪 test" })).toBe("ci-test.log");
    expect(logFileName({ workflow: "Workflow checks", name: "pull request follows the template" })).toBe(
      "workflow-checks-pull-request-follows-the-template.log",
    );
  });

  it("never returns an empty name", () => {
    expect(logFileName({ workflow: "", name: "🧪" })).toBe("job.log");
  });
});

describe("summaryMarkdown", () => {
  const pr = { number: 7, url: "https://github.com/OWNER/REPO/pull/7" };

  it("says so when nothing fails", () => {
    expect(summaryMarkdown(pr, [], [])).toContain("No check is failing.");
  });

  it("lists each failing job with its log file and excerpt", () => {
    const { jobs } = failingChecks([check({})]);
    const md = summaryMarkdown(
      pr,
      [
        {
          job: jobs[0] as (typeof jobs)[number],
          file: ".git/kit/pr-7/ci/ci-test.log",
          excerpt: ["FAIL x"],
          error: null,
        },
      ],
      [],
    );
    expect(md).toContain("## CI / 🧪 test");
    expect(md).toContain("Full log: .git/kit/pr-7/ci/ci-test.log");
    expect(md).toContain("```text\nFAIL x\n```");
  });
});
