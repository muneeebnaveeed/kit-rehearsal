// The rules behind `pnpm pr:ci-logs`: which checks failed, where their logs are, and the part of a
// log worth reading first. No I/O here, so it is tested without GitHub.

/** One row of `gh pr checks --json name,state,bucket,link,workflow,startedAt`. */
export interface Check {
  name: string;
  state: string;
  bucket: string;
  link: string;
  workflow: string;
  startedAt: string;
}

/** A failed check whose log lives in a GitHub Actions job. */
export interface FailedJob {
  workflow: string;
  name: string;
  link: string;
  runId: string;
  jobId: string;
}

/** A failed check that is not an Actions job (an external status), so it has no log to download. */
export interface FailedExternal {
  workflow: string;
  name: string;
  link: string;
}

export interface Failures {
  jobs: FailedJob[];
  external: FailedExternal[];
}

const JOB_LINK = /\/actions\/runs\/(\d+)\/job\/(\d+)/;

/** The run and job ids in an Actions job link, or null for any other link. */
export function parseJobLink(link: string): { runId: string; jobId: string } | null {
  const match = JOB_LINK.exec(link);
  if (!match?.[1] || !match[2]) return null;
  return { runId: match[1], jobId: match[2] };
}

/**
 * The checks that are failing now. `gh pr checks` also lists older runs of a check, so only the
 * latest run of each workflow and name counts: a check that failed and then passed is not a failure.
 */
export function failingChecks(checks: Check[]): Failures {
  const latest = new Map<string, Check>();
  for (const check of checks) {
    const key = `${check.workflow}\0${check.name}`;
    const seen = latest.get(key);
    if (!seen || check.startedAt > seen.startedAt) latest.set(key, check);
  }
  const jobs: FailedJob[] = [];
  const external: FailedExternal[] = [];
  for (const check of latest.values()) {
    if (check.bucket !== "fail") continue;
    const ids = parseJobLink(check.link);
    if (ids) jobs.push({ workflow: check.workflow, name: check.name, link: check.link, ...ids });
    else external.push({ workflow: check.workflow, name: check.name, link: check.link });
  }
  return { jobs, external };
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z ?/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: strips terminal colour codes from CI logs
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

/** A job log without the timestamp GitHub puts before every line and without colour codes. */
export function cleanLog(raw: string): string[] {
  return raw.split(/\r?\n/).map((line) => line.replace(TIMESTAMP, "").replace(ANSI, ""));
}

const ERROR_LINE =
  /(^|\W)(error|fail(ed|ure)?|✗|×|ERR_|Assertion|expected|Unexpected|not found|cannot|exit code [1-9])/i;
const NOISE = /^##\[(group|endgroup)\]|^\s*$/;

const ERROR_MARK = "##[error]";
const GROUP_RUN = /^##\[group\]Run (.*)$/;

/**
 * The lines to read first. GitHub marks a failed step with a `##[error]` line, so for each one this
 * shows the step's command and its output: the lines between the step's setup group and the error,
 * the last `perStep` of them. A log without that marker falls back to `errorLines`.
 */
export function excerpt(lines: string[], perStep = 40): string[] {
  const out: string[] = [];
  let stepStart = 0;
  let command: string | null = null;
  lines.forEach((line, i) => {
    const run = GROUP_RUN.exec(line);
    if (run) command = run[1] ?? null;
    if (line.startsWith("##[endgroup]")) stepStart = i + 1;
    if (!line.startsWith(ERROR_MARK)) return;
    const output = lines.slice(stepStart, i).filter((l) => !NOISE.test(l) && !l.startsWith(ERROR_MARK));
    if (out.length > 0) out.push("");
    if (command) out.push(`$ ${command}`);
    if (output.length > perStep) out.push("…");
    out.push(...output.slice(-perStep), line.slice(ERROR_MARK.length));
    stepStart = i + 1;
  });
  return out.length > 0 ? out : errorLines(lines);
}

/**
 * Every line that looks like an error, with one line before and after it, capped at `limit` lines.
 * Falls back to the end of the log when nothing matches.
 */
export function errorLines(lines: string[], limit = 60): string[] {
  const keep = new Set<number>();
  lines.forEach((line, i) => {
    if (NOISE.test(line) || !ERROR_LINE.test(line)) return;
    for (const j of [i - 1, i, i + 1])
      if (j >= 0 && j < lines.length && !NOISE.test(lines[j] ?? "")) keep.add(j);
  });
  if (keep.size === 0) return lines.filter((line) => !NOISE.test(line)).slice(-limit);
  const picked = [...keep].sort((a, b) => a - b).slice(0, limit);
  const out: string[] = [];
  picked.forEach((j, k) => {
    const prev = picked[k - 1];
    if (k > 0 && prev !== undefined && j > prev + 1) out.push("…");
    out.push(lines[j] ?? "");
  });
  return out;
}

/** A file name for a job's log: "CI / 🧪 test" → "ci-test.log". */
export function logFileName(job: { workflow: string; name: string }): string {
  const slug = `${job.workflow} ${job.name}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "job"}.log`;
}

export interface JobReport {
  job: FailedJob;
  file: string | null;
  excerpt: string[];
  error: string | null;
}

/** The summary saved next to the logs and printed: one section per failed check, with its excerpt. */
export function summaryMarkdown(
  pr: { number: number; url: string },
  jobs: JobReport[],
  external: FailedExternal[],
) {
  const lines = [`# Failing checks on PR #${pr.number}`, "", pr.url, ""];
  if (jobs.length === 0 && external.length === 0) {
    lines.push("No check is failing.");
    return `${lines.join("\n")}\n`;
  }
  for (const { job, file, excerpt: shown, error } of jobs) {
    lines.push(`## ${job.workflow} / ${job.name}`, "", `Run: ${job.link}`);
    if (file) lines.push(`Full log: ${file}`);
    if (error) lines.push(`Log not downloaded: ${error}`);
    if (shown.length > 0) lines.push("", "```text", ...shown, "```");
    lines.push("");
  }
  for (const check of external) {
    lines.push(
      `## ${check.workflow || "External"} / ${check.name}`,
      "",
      `Not a GitHub Actions job, so no log: ${check.link}`,
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}
