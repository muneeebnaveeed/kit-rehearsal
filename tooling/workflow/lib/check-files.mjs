// What a branch adds: no dependencies, build output, .env files or large binaries (check:files), and
// no tokens, keys or passwords in the added lines (check:secrets). Pure: callers pass paths and lines.

const MAX_FILE_BYTES = 1_000_000;

/** @type {[RegExp, string][]} */
const FORBIDDEN = [
  [/(^|\/)node_modules\//, "dependencies"],
  [/(^|\/)dist\//, "build output"],
  [/(^|\/)\.env(\.[^/]*)?$/, "an environment file, which may hold secrets"],
];

/** @param {{ path: string, bytes: number }[]} files */
export function checkFiles(files) {
  /** @type {import("./report.mjs").Problem[]} */
  const problems = [];
  for (const { path, bytes } of files) {
    if (path.endsWith(".env.example")) continue;
    const forbidden = FORBIDDEN.find(([re]) => re.test(path));
    if (forbidden) {
      problems.push({
        rule: "forbidden",
        file: path,
        message: `This is ${forbidden[1]} and must not be committed.`,
        fix: `git rm --cached ${path}, and make sure .gitignore covers it.`,
      });
    } else if (bytes > MAX_FILE_BYTES) {
      problems.push({
        rule: "size",
        file: path,
        message: `${(bytes / 1_000_000).toFixed(1)} MB is over the 1 MB limit.`,
        fix: "Compress it, or keep it outside the repo and load it at runtime.",
      });
    }
  }
  return problems;
}

/** @type {[RegExp, string][]} */
const SECRET_PATTERNS = [
  [/\bghp_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b|\bgh[osu]_[A-Za-z0-9]{36}\b/, "GitHub token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key"],
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, "private key"],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}\b/, "Slack token"],
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/, "API secret key"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, "Google API key"],
  [
    /\b(?:api[_-]?key|secret|password|passwd|token)\b["']?\s*[:=]\s*["'][^"'\s]{12,}["']/i,
    "hard-coded credential",
  ],
];
// Obvious placeholders and templates are fine.
const PLACEHOLDER = /(example|placeholder|changeme|your[-_]?|xxx|<[^>]+>|\$\{)/i;

/** @param {{ file: string, line: string }[]} lines added lines */
export function findSecrets(lines) {
  /** @type {import("./report.mjs").Problem[]} */
  const problems = [];
  for (const { file, line } of lines) {
    for (const [re, kind] of SECRET_PATTERNS) {
      const m = re.exec(line);
      if (m && !PLACEHOLDER.test(m[0])) {
        problems.push({
          rule: "secret",
          file,
          message: `Looks like a ${kind}: ${m[0].slice(0, 12)}...`,
          fix: "Remove it, rotate the secret, and read it from an environment variable instead.",
        });
        break;
      }
    }
  }
  return problems;
}

/**
 * Splits `git diff --unified=0` output into the lines it adds, with their file.
 * @param {string} diff
 */
export function addedLines(diff) {
  const lines = [];
  let file = "";
  for (const row of diff.split("\n")) {
    if (row.startsWith("+++ b/")) file = row.slice(6);
    else if (row.startsWith("+") && !row.startsWith("+++")) lines.push({ file, line: row.slice(1) });
  }
  return lines;
}
