// Validates commit messages against the repo's format (Conventional Commits plus an issue reference).
// Pure: no git, so every rule is unit-tested.

export const COMMIT_TYPES = ["feat", "fix", "docs", "refactor", "chore", "ci", "build", "test", "perf"];

const SUBJECT = /^([a-z]+)(?:\(([a-z0-9][a-z0-9-]*)\))?(!)?: (\S.*)$/;
export const ISSUE_REFERENCE = /^(?:Refs|Closes|Fixes|Resolves) #\d+/im;
// Past tense and -ing forms that sneak in instead of the imperative ("added", "fixing", "updates").
const NOT_IMPERATIVE =
  /^(?:added|fixed|updated|removed|changed|created|renamed|moved|adding|fixing|updating|removing|changing|creating|adds|fixes|updates|removes|changes|creates)\b/i;
// Messages git or a tool generates; they cannot follow the format.
export const EXEMPT = /^(?:Merge |Revert "|fixup! |squash! |amend! )/;

/**
 * Checks a Conventional-Commit subject line: "type(scope): description". Used for commit subjects
 * and pull request titles, so both follow exactly the same rules.
 * @param {string} subject
 * @returns {{ problems: { rule: string, message: string }[], type: string | null, scope: string | null, breaking: boolean }}
 */
export function checkSubject(subject) {
  /** @type {{ rule: string, message: string }[]} */
  const problems = [];
  const add = (rule, text) => problems.push({ rule, message: text });

  const m = SUBJECT.exec(subject);
  if (!m) {
    add(
      "format",
      `Subject must look like "type(scope): description" with a type from ${COMMIT_TYPES.join(", ")}; got "${subject}".`,
    );
  } else {
    if (!COMMIT_TYPES.includes(m[1]))
      add("type", `Unknown type "${m[1]}". Use one of: ${COMMIT_TYPES.join(", ")}.`);
    if (/^[A-Z]/.test(m[4]))
      add("case", `The description must start with a lowercase letter ("${m[4].slice(0, 20)}...").`);
    if (NOT_IMPERATIVE.test(m[4]))
      add(
        "mood",
        `Write the description in the imperative mood ("add login page", not "${m[4].split(" ")[0]}").`,
      );
  }
  if (subject.length > 72) add("length", `Subject is ${subject.length} characters; keep it to 72 or fewer.`);
  if (subject.endsWith(".")) add("period", "Subject must not end with a period.");
  return { problems, type: m?.[1] ?? null, scope: m?.[2] ?? null, breaking: Boolean(m?.[3]) };
}

/**
 * @param {string} message the full commit message
 * @param {{ stripComments?: boolean }} [opts] strip "#" lines, as git does for a message written in an editor
 * @returns {{ ok: boolean, exempt: boolean, subject: string, problems: { rule: string, message: string }[] }}
 */
export function checkCommit(message, opts = {}) {
  const lines = message.replace(/\r\n/g, "\n").split("\n");
  const kept = opts.stripComments ? lines.filter((l) => !l.startsWith("#")) : lines;
  while (kept.length > 0 && kept[0].trim() === "") kept.shift();
  const subject = kept[0] ?? "";
  const rest = kept.slice(1);

  if (EXEMPT.test(subject)) return { ok: true, exempt: true, subject, problems: [] };

  /** @type {{ rule: string, message: string }[]} */
  const problems = [];
  const add = (rule, text) => problems.push({ rule, message: text });

  if (subject === "") {
    add("empty", "The commit message is empty.");
    return { ok: false, exempt: false, subject, problems };
  }

  problems.push(...checkSubject(subject).problems);
  if (rest.length > 0 && rest[0].trim() !== "")
    add("blank-line", "Leave a blank line between the subject and the body.");

  const body = rest.join("\n");
  if (!ISSUE_REFERENCE.test(body))
    add("issue", 'The body needs an issue reference on its own line, e.g. "Refs #14" or "Closes #14".');

  return { ok: problems.length === 0, exempt: false, subject, problems };
}

/**
 * Splits `git log --format=%H%x1f%B%x1e` output into commits.
 * @param {string} out
 */
export function parseLog(out) {
  return out
    .split("\x1e")
    .map((rec) => rec.replace(/^\n/, ""))
    .filter((rec) => rec.trim() !== "")
    .map((rec) => {
      const i = rec.indexOf("\x1f");
      return { sha: rec.slice(0, i).trim(), message: rec.slice(i + 1) };
    });
}

/**
 * Git log arguments for a commit range, optionally excluding commits reachable from a trusted ref.
 * @param {string[]} range
 * @param {string | undefined} exclude
 */
export function commitRangeArgs(range, exclude) {
  return ["log", "--no-merges", "--format=%H%x1f%B%x1e", ...range, ...(exclude ? ["--not", exclude] : [])];
}
