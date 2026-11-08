// Rules for `node course/tooling/student-report.mjs`: per-student activity, a 1-5 score and a justification.
// Pure functions only, so they can be unit tested. The criteria follow "Evaluation" in course/README.md.
import { contributionCells, contributionOf } from "./contribution.mjs";

/** Logins that are never scored: instructors, organizer accounts and bots. */
export const NOT_SCORED = {
  claude: "AI co-author; its commits are credited to the PR author",
};

/** Logins that stand for an AI agent: their commits count for the PR author. */
const AGENTS = new Set(["claude"]);

const ISSUE_REF = /^(Refs|Closes|Fixes|Resolves) #\d+\s*$/im;

const emptyStats = (login) => ({
  login,
  teams: {},
  prsOpened: 0,
  prsMerged: 0,
  prsOpen: 0,
  prsClosed: 0,
  additions: 0,
  deletions: 0,
  commits: 0,
  commitsWithRefs: 0,
  docPass: 0,
  docFail: 0,
  docProblems: {},
  reviewsGiven: 0,
  comments: 0,
  merges: 0,
  issuesOpened: 0,
  issuesBadlyNamed: 0,
  issuesAssigned: 0,
});

/**
 * Reads the PR documentation results from `pr-report.mjs --json`.
 * @param {{ teams: { failing?: { number: number, problems: { rule: string }[] }[], passing?: { number: number }[] }[] }} report
 * @returns {Map<number, { ok: boolean, rules: string[] }>}
 */
export function docsFromReport(report) {
  const docs = new Map();
  for (const team of report.teams) {
    for (const p of team.passing ?? []) docs.set(p.number, { ok: true, rules: [] });
    for (const p of team.failing ?? [])
      docs.set(p.number, { ok: false, rules: p.problems.map((x) => x.rule) });
  }
  return docs;
}

/**
 * Builds per-user statistics.
 * @param {object} input
 * @param {Array} input.prs  {number, state, additions, deletions, author, mergedBy, labels[], reviewers[], commenters[], commits[{oid, message, authors[]}]}, oldest first
 * @param {Array} input.issues  {number, title, author, assignees[], labels[], commenters[]}
 * @param {Map<number, {ok: boolean, rules: string[]}>} input.docs  PR documentation results from pr-report
 * @param {string[]} input.teamLabels
 * @param {string[]} [input.members]  logins to include even without activity (repository collaborators)
 */
export function collectStats({ prs, issues, docs, teamLabels, members = [] }) {
  const users = new Map();
  const user = (login) => {
    if (!login) return null;
    if (!users.has(login)) users.set(login, emptyStats(login));
    return users.get(login);
  };
  const teamOf = (labels) => labels.find((l) => teamLabels.includes(l)) ?? null;
  const seenCommits = new Set();

  for (const pr of prs) {
    const team = teamOf(pr.labels);
    const author = user(pr.author);
    if (pr.mergedBy) user(pr.mergedBy).merges++;
    if (author) {
      if (team) author.teams[team] = (author.teams[team] ?? 0) + 1;
      author.prsOpened++;
      if (pr.state === "MERGED") {
        author.prsMerged++;
        author.additions += pr.additions;
        author.deletions += pr.deletions;
      } else if (pr.state === "OPEN") author.prsOpen++;
      else author.prsClosed++;
      const doc = docs.get(pr.number);
      if (doc) {
        if (doc.ok) author.docPass++;
        else author.docFail++;
        for (const rule of new Set(doc.rules)) author.docProblems[rule] = (author.docProblems[rule] ?? 0) + 1;
      }
    }
    // A commit shows up again in integration PRs (work branch, feature/team-N, main): count it once, for the
    // first PR that has it. Commits by an AI agent count for the PR author.
    for (const c of pr.commits) {
      if (seenCommits.has(c.oid)) continue;
      seenCommits.add(c.oid);
      const logins = new Set(c.authors.map((a) => (!a || AGENTS.has(a) ? pr.author : a)));
      const hasRef = ISSUE_REF.test(c.message);
      for (const login of logins) {
        const u = user(login);
        if (!u) continue;
        u.commits++;
        if (hasRef) u.commitsWithRefs++;
      }
    }
    for (const r of new Set(pr.reviewers)) if (r !== pr.author) user(r).reviewsGiven++;
    for (const c of pr.commenters) if (c !== pr.author) user(c).comments++;
  }

  for (const issue of issues) {
    const team = teamOf(issue.labels);
    const author = user(issue.author);
    if (author) {
      author.issuesOpened++;
      if (team) author.teams[team] = (author.teams[team] ?? 0) + 1;
      if (!team || !issue.title.startsWith(`[${team}]`)) author.issuesBadlyNamed++;
    }
    for (const a of issue.assignees) user(a).issuesAssigned++;
    for (const c of issue.commenters) if (c !== issue.author) user(c).comments++;
  }

  for (const m of members) user(m);
  return [...users.values()];
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Scores one student: points per area, the 1-5 score and a justification. */
export function scoreStudent(s) {
  const why = [];

  // Delivery, 0-4: merged pull requests.
  let delivery = 0;
  if (s.prsMerged >= 5) delivery = 4;
  else if (s.prsMerged >= 2) delivery = 3;
  else if (s.prsMerged === 1) delivery = 2;
  else if (s.prsOpen > 0) delivery = 1;
  if (s.prsMerged) why.push(`${plural(s.prsMerged, "merged PR")} (+${s.additions}/−${s.deletions} lines)`);
  if (s.prsOpen) why.push(`${plural(s.prsOpen, "PR")} still open`);
  if (!s.prsOpened) why.push("no pull requests");

  // Process, 0-3: documented PRs, commits with an issue reference, correctly named issues.
  let process = 0;
  const docTotal = s.docPass + s.docFail;
  if (docTotal) {
    if (s.docPass * 2 >= docTotal) {
      process++;
      why.push(`PR documentation passes the report for ${s.docPass}/${docTotal} PRs`);
    } else {
      const top = Object.entries(s.docProblems)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([rule]) => rule);
      why.push(
        `only ${s.docPass}/${docTotal} PRs pass the documentation report${top.length ? ` (mostly: ${top.join(", ")})` : ""}`,
      );
    }
  }
  if (s.commits) {
    if (s.commitsWithRefs * 5 >= s.commits * 4) {
      process++;
      why.push(`${s.commitsWithRefs}/${s.commits} commits reference an issue`);
    } else why.push(`only ${s.commitsWithRefs}/${s.commits} commits reference an issue`);
  }
  if (s.issuesOpened) {
    if (s.issuesBadlyNamed === 0) {
      process++;
      why.push(`${plural(s.issuesOpened, "issue")} opened, all with a team label and a matching title`);
    } else
      why.push(
        `${plural(s.issuesOpened, "issue")} opened, ${s.issuesBadlyNamed} without a team label or a matching title`,
      );
  }

  // Collaboration, 0-3: reviews of other people's PRs and comments on their issues and PRs.
  let collaboration = 0;
  if (s.reviewsGiven >= 5) collaboration = 2;
  else if (s.reviewsGiven >= 1) collaboration = 1;
  if (s.reviewsGiven) why.push(`reviewed ${plural(s.reviewsGiven, "PR")} of others`);
  if (s.comments) {
    collaboration++;
    why.push(`${plural(s.comments, "comment")} on others' issues or PRs`);
  }
  if (s.merges) why.push(`merged ${plural(s.merges, "PR")}`);

  const points = delivery + process + collaboration;
  const score = points >= 8 ? 5 : points >= 5 ? 4 : points >= 3 ? 3 : points >= 1 ? 2 : 1;
  if (
    points === 0 &&
    !s.prsOpened &&
    !s.issuesOpened &&
    !s.issuesAssigned &&
    !s.merges &&
    !s.commits &&
    !s.commitsImported
  )
    why.splice(
      0,
      why.length,
      "no visible activity in the repository yet (no issues, PRs, commits or reviews)",
    );
  else if (s.issuesAssigned && !s.prsOpened)
    why.push(`assigned to ${plural(s.issuesAssigned, "issue")}, none delivered yet`);

  const team =
    Object.entries(s.teams)
      .sort((a, b) => b[1] - a[1])
      .map(([t]) => t)[0] ?? null;
  return {
    login: s.login,
    team,
    score,
    points,
    delivery,
    process,
    collaboration,
    justification: `${why.join("; ")}.`,
    stats: s,
  };
}

/**
 * Parses the instructors' roster (`course/teams.json`):
 * `{ "instructors": ["login", ...], "students": [{ "login", "name", "nickname", "team", "note" }, ...] }`.
 * Only `login` is required for a student; entries without a login are skipped.
 * @returns {{instructors: Set<string>, students: Map<string, {name: string|null, nickname: string|null, team: string|null, note: string|null}>}}
 */
export function parseRoster(text) {
  const data = JSON.parse(text);
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("the roster must be a JSON object");
  const { instructors = [], students = [] } = data;
  if (!Array.isArray(instructors) || !instructors.every((l) => typeof l === "string"))
    throw new Error('"instructors" must be a list of GitHub logins');
  if (!Array.isArray(students)) throw new Error('"students" must be a list');
  const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const map = new Map();
  for (const s of students) {
    const login = str(s?.login);
    if (!login) continue;
    map.set(login, { name: str(s.name), nickname: str(s.nickname), team: str(s.team), note: str(s.note) });
  }
  return { instructors: new Set(instructors), students: map };
}

/** Logins in the roster that should be listed even without activity. */
export const rosterLogins = (roster) => (roster ? [...roster.students.keys()] : []);

/**
 * Scores every user except NOT_SCORED and the roster's instructors, best first. With a roster, the team comes
 * from it (the label-based guess is the fallback) and its name, nickname and note are added.
 * @param {ReturnType<typeof collectStats>} stats
 * @param {ReturnType<typeof parseRoster> | null} [roster]
 */
export function scoreAll(stats, roster = null) {
  return stats
    .filter((s) => !NOT_SCORED[s.login] && !roster?.instructors.has(s.login))
    .map((s) => {
      const row = scoreStudent(s);
      const entry = roster?.students.get(s.login);
      if (!entry) return row;
      return {
        ...row,
        team: entry.team ?? row.team,
        name: entry.name,
        nickname: entry.nickname,
        note: entry.note,
        justification: entry.note ? `${row.justification} Note: ${entry.note}` : row.justification,
      };
    })
    .sort((a, b) => b.score - a.score || b.points - a.points || a.login.localeCompare(b.login));
}

/** Formats the scored students as a Markdown report. */
export function formatStudentReport(rows, meta) {
  const cell = (t) => String(t).replace(/\|/g, "\\|");
  const who = (r) => {
    const person = [r.name, r.nickname && r.nickname !== r.name ? `(${r.nickname})` : null].filter(Boolean);
    return person.length ? `\`${r.login}\`<br>${cell(person.join(" "))}` : `\`${r.login}\``;
  };
  const lines = [
    "# Student activity scores",
    "",
    `Repository \`${meta.repo}\`, generated ${meta.generatedAt} (${meta.prCount} pull requests, ${meta.issueCount} issues).`,
    "**For instructors only. Don't commit this report: the repository is public.**",
    "",
  ];
  // The contribution columns appear when the rows carry them.
  const withContribution = rows.some((r) => r.contribution);
  lines.push(
    `| Student | Team | Score | Points (D/P/C) | Merged / open PRs | Commits (with \`Refs\`) | Docs OK | Reviews |${withContribution ? " Lines added | Share in team | Feature | Main areas | Merged work |" : ""} Justification |`,
    `|---|---|:-:|:-:|:-:|:-:|:-:|:-:|${withContribution ? "--:|--:|--:|---|---|" : ""}---|`,
  );
  for (const r of rows) {
    const s = r.stats;
    const contribution = withContribution
      ? ` ${contributionCells(r.contribution ?? contributionOf(undefined, 0), cell).join(" | ")} |`
      : "";
    lines.push(
      `| ${who(r)} | ${r.team ?? "–"} | **${r.score}** | ${r.points} (${r.delivery}/${r.process}/${r.collaboration}) | ${s.prsMerged} / ${s.prsOpen} | ${s.commits} (${s.commitsWithRefs}) | ${s.docPass}/${s.docPass + s.docFail} | ${s.reviewsGiven} |${contribution} ${cell(r.justification)} |`,
    );
  }
  lines.push("");
  if (withContribution)
    lines.push(
      `**Contribution columns:** what each student's merged work PRs added. Syncs and integration PRs, which repeat work merged elsewhere, and generated files such as lockfiles are left out. *Share in team* is the student's part of the team's added lines; *Feature* is the part of their own lines in feature PRs. Lines measure size, not quality: read them with *Merged work*.${meta.repeats?.length ? ` Left out as syncs or integration PRs: ${meta.repeats.map((n) => `#${n}`).join(", ")}.` : ""}${meta.truncated?.length ? ` Only the first 100 files were read of ${meta.truncated.map((n) => `#${n}`).join(", ")}.` : ""}`,
      "",
    );
  lines.push(
    "Scoring rules and limitations: see *Student activity report* in `course/README.md`.",
    `Not scored: ${[
      ...Object.entries(NOT_SCORED),
      ...(meta.instructors ?? [])
        .filter((l) => !NOT_SCORED[l])
        .map((l) => [l, "instructor, from the roster"]),
    ]
      .map(([login, why]) => `\`${login}\` (${why})`)
      .join(", ")}.`,
    "",
  );
  return lines.join("\n");
}
