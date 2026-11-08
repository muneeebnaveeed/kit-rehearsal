// Scores a pull request against the rubric behind `pnpm pr:rubric`: only what a script can judge from
// the title, body and changed files. Pure: the caller fetches the PR. Advice, never a gate.
import { screenshotsOf } from "./check-pr.mjs";
import { matchesAny } from "./glob.mjs";
import { CLIENT_FILE } from "./pr-open.mjs";
import { fieldsOf, stripComments } from "./template.mjs";

export const MARKER = "<!-- kit:pr-rubric -->";
export const MAX_CHANGED_LINES = 1000;
// Lockfiles and generated output say nothing about how big the change is to review.
export const UNCOUNTED_PATHS = [
  "**/pnpm-lock.yaml",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/generated/**",
  "**/dist/**",
  "**/*.min.js",
  "**/*.snap",
];
// Folders whose code needs tests: the games and the platform.
const TESTED_ROOTS = ["games/**", "server/**", "tooling/**"];

export interface PrFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface RubricInput {
  title: string;
  body: string | null;
  head: string;
  base: string;
  files: PrFile[];
  commits?: number;
  config: { testPaths: string[]; codePaths: string[]; docsPaths: string[] };
}

export interface Criterion {
  id: "tests" | "how-to-test" | "screenshots" | "summary" | "size" | "root-cause";
  label: string;
  // false when the criterion does not apply to this PR; it is then not counted.
  applies: boolean;
  pass: boolean;
  detail: string;
  tip: string;
}

export interface RubricResult {
  skipped: string | null;
  score: number;
  total: number;
  changedLines: number;
  commits: number | null;
  criteria: Criterion[];
}

const PLACEHOLDER = /^(?:none|n\/?a|-+|tbd|todo|\.{3}|see (?:above|below|issue)|tested|works)\.?$/i;

const fieldValue = (body: string, label: string): string | null => {
  const f = fieldsOf(body).find((x) => x.heading.toLowerCase() === label.toLowerCase());
  return f ? stripComments(f.body).trim() : null;
};

const filled = (value: string | null): value is string =>
  value !== null && value.replace(/^\s*(?:[-*]|\d+\.)\s*$/gm, "").trim() !== "" && !PLACEHOLDER.test(value);

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

export function sentencesOf(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Code names in prose: backticked text, file paths, and camelCase, snake_case or call() identifiers. */
export function codeNamesIn(text: string): string[] {
  const found = [
    ...text.matchAll(/`[^`]+`/g),
    ...text.matchAll(/(?:^|\s)\.?[\w-]+(?:\/[\w.-]+)+/g),
    ...text.matchAll(/\b[\w-]+\.(?:[cm]?[jt]sx?|json|ya?ml|md|css|html|go|py|sh)\b/g),
    ...text.matchAll(/\b[a-z]+(?:[A-Z][a-z0-9]*)+\b/g),
    ...text.matchAll(/\b[a-z0-9]+(?:_[a-z0-9]+)+\b/g),
    ...text.matchAll(/\b\w+\(\)/g),
  ].map((m) => m[0].trim());
  // "and/or" or "players/teams" are prose: a slash only means a path with an extension, two slashes,
  // or a repo folder in front.
  const pathLike = (s: string) =>
    !s.includes("/") ||
    s.startsWith("`") ||
    /\.\w+$|\/.*\/|^\.{0,2}\/|^(?:games|server|tooling|course|\.github|src)\//.test(s);
  return [...new Set(found)].filter(pathLike);
}

/** Why the rubric does not apply, or null. Syncs and promotions carry other people's reviewed work. */
export function skipReason(head: string, base: string): string | null {
  if (head === "main") return "This is a sync PR (head `main`): its changes were reviewed on main.";
  if (/^feature\/team-\d+$/.test(head) && base === "main")
    return `This is a promotion (\`${head}\` into \`main\`): its changes were reviewed in their own PRs.`;
  return null;
}

export function scoreRubric(input: RubricInput): RubricResult {
  const { title, head, base, files, config } = input;
  const body = input.body ?? "";
  // Tests and docs are what the rubric asks for, so they never count against the size.
  const counted = files.filter(
    (f) =>
      !matchesAny(f.path, UNCOUNTED_PATHS) &&
      !matchesAny(f.path, config.testPaths) &&
      !matchesAny(f.path, config.docsPaths),
  );
  const changedLines = counted.reduce((n, f) => n + f.additions + f.deletions, 0);
  const commits = input.commits ?? null;
  const skipped = skipReason(head, base);
  if (skipped) return { skipped, score: 0, total: 0, changedLines, commits, criteria: [] };

  const paths = files.map((f) => f.path);
  const isTest = (p: string) => matchesAny(p, config.testPaths);
  const code = paths.filter(
    (p) => matchesAny(p, TESTED_ROOTS) && matchesAny(p, config.codePaths) && !isTest(p),
  );
  const tests = paths.filter(isTest);
  const client = paths.filter((p) => CLIENT_FILE.test(p));
  const rootCause = fieldValue(body, "Root cause");
  const isBug = /^fix(?:\(|!|:)/.test(title.trim()) || rootCause !== null;

  const criteria: Criterion[] = [];

  criteria.push({
    id: "tests",
    label: "Tests changed with the code",
    applies: code.length > 0,
    pass: tests.length > 0,
    detail:
      code.length === 0
        ? "No game or platform code changed."
        : tests.length > 0
          ? `${tests.length} test file(s) changed with ${code.length} code file(s).`
          : `${code.length} code file(s) changed, no test file.`,
    tip: "Add or update a `*.test.ts` that fails without your change.",
  });

  const howTo = fieldValue(body, "How to test");
  const concrete =
    filled(howTo) && (/^\s*(?:[-*]|\d+\.)\s+\S/m.test(howTo) || /`[^`]+`/.test(howTo) || words(howTo) >= 8);
  criteria.push({
    id: "how-to-test",
    label: "How to test has concrete steps",
    applies: true,
    pass: concrete,
    detail: concrete
      ? "Steps a reviewer can follow."
      : filled(howTo)
        ? "Too short to follow."
        : "Empty or a placeholder.",
    tip: "List the steps a reviewer runs, with the command and what they should see.",
  });

  const shots = screenshotsOf(fieldValue(body, "Screenshots") ?? "");
  criteria.push({
    id: "screenshots",
    label: "Screenshots of client changes",
    applies: client.length > 0,
    pass: shots.kind === "image" || shots.kind === "none",
    detail:
      client.length === 0
        ? "No client files changed."
        : shots.kind === "image"
          ? "Has an image or link."
          : shots.kind === "none"
            ? `No image, with a reason: ${shots.reason}`
            : `${client.length} client file(s) changed, no image and no reason.`,
    tip: "Drag a screenshot or GIF of the change into the Screenshots field, or write `None, <why there is nothing to show>`.",
  });

  const summary = fieldValue(body, "Summary");
  const sentences = filled(summary) ? sentencesOf(summary).length : 0;
  const names = summary ? codeNamesIn(summary) : [];
  const summaryOk = sentences >= 1 && sentences <= 4 && names.length === 0;
  criteria.push({
    id: "summary",
    label: "Summary says why, in 1 to 4 sentences",
    applies: true,
    pass: summaryOk,
    detail:
      sentences === 0
        ? "Empty or a placeholder."
        : names.length > 0
          ? `Names code: ${names.slice(0, 3).join(", ")}.`
          : `${sentences} sentence(s).`,
    tip:
      names.length > 0
        ? "Say what changes for players or teams and why; the diff already shows the files and names."
        : "Explain the problem and why this fixes it in 1 to 4 sentences, not a list of changes.",
  });

  criteria.push({
    id: "size",
    label: `Under ${MAX_CHANGED_LINES} changed lines of code`,
    applies: true,
    pass: changedLines < MAX_CHANGED_LINES,
    detail: `${changedLines} changed line(s), tests, docs, lockfiles and generated files excluded.`,
    tip: "Consider splitting it into smaller PRs, each with its own issue.",
  });

  const rootOk = filled(rootCause) && words(rootCause) >= 5;
  criteria.push({
    id: "root-cause",
    label: "Root cause explained",
    applies: isBug,
    pass: rootOk,
    detail: !isBug ? "Not a bug fix." : rootOk ? "Filled in." : "Empty, a placeholder or too short.",
    tip: "Say which assumption or missed case caused the bug, not which lines you changed.",
  });

  const counting = criteria.filter((c) => c.applies);
  return {
    skipped: null,
    score: counting.filter((c) => c.pass).length,
    total: counting.length,
    changedLines,
    commits,
    criteria,
  };
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

/** The sticky comment's Markdown, starting with MARKER so the next run finds and updates it. */
export function rubricMarkdown(result: RubricResult): string {
  const lines = [MARKER, ""];
  if (result.skipped) {
    lines.push("### PR rubric: skipped", "", result.skipped);
    return `${lines.join("\n")}\n`;
  }
  lines.push(
    `### PR rubric: ${result.score} of ${result.total}`,
    "",
    "Advice only: this never blocks the merge. It updates when the PR changes.",
    "",
    "| Passed | Criterion | Details |",
    "|---|---|---|",
  );
  for (const c of result.criteria.filter((x) => x.applies)) {
    lines.push(
      `| ${c.pass ? "✅" : "❌"} | ${cell(c.label)} | ${cell(c.pass ? c.detail : `${c.detail} ${c.tip}`)} |`,
    );
  }
  const skipped = result.criteria.filter((c) => !c.applies);
  if (skipped.length > 0) {
    lines.push(
      "",
      `Not counted: ${skipped.map((c) => `${c.label.toLowerCase()} (${c.detail.replace(/\.$/, "").toLowerCase()})`).join("; ")}.`,
    );
  }
  return `${lines.join("\n")}\n`;
}
