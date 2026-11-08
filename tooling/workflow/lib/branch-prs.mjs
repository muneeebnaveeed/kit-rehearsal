// Rules for the commands that open PRs between the long-lived branches (see "Branches" in CLAUDE.md):
//
//   pnpm team:promote <N>   feature/team-N -> main
//   pnpm branches:sync      main -> each feature/team-N that is behind
//
// Pure: the commands run git and gh and pass the results in. The bodies are filled from the real
// templates, and only the checklist items a command verified itself are ticked; the rest are left
// for a person, so check:pr stays red until someone has looked.
import { checkPr } from "./check-pr.mjs";
import { fillTemplate } from "./pr-body.mjs";

/** @typedef {{ number: number, title: string, sha: string }} MergedPr */
/** @typedef {{ number: number, state: string, labels: string[] }} Issue */
/** @typedef {{ type: string, head: string, base: string, title: string, labels: string[], body: string }} PrDraft */

const TEAM = /^(?:team-)?([1-4])$/;

/**
 * Which team a command works for: the positional number, then --team, then git config kit.team.
 * @param {{ positional?: string | null, flag?: string | null, configured?: string | null }} input
 * @returns {{ team: string, error?: undefined } | { error: string, team?: undefined }}
 */
export function resolveTeam({ positional = null, flag = null, configured = null }) {
  const given = positional ?? flag;
  if (given) {
    const m = TEAM.exec(given.trim());
    return m ? { team: `team-${m[1]}` } : { error: `"${given}" is not a game team. Use a team from 1 to 4.` };
  }
  const m = configured ? TEAM.exec(configured.trim()) : null;
  if (m) return { team: `team-${m[1]}` };
  return {
    error: `Which team? Run pnpm team:promote <N> with a team from 1 to 4${configured ? ` (your saved team is ${configured}, which has no feature branch)` : ""}.`,
  };
}

/**
 * The PRs merged in a range, from GitHub's merge commits ("Merge pull request #N from owner/branch",
 * with the PR title as the body). Input: `git log --merges --format=%H%x1f%s%x1f%b%x1e <range>`.
 * Other merges (git merge of a branch) are not PRs and are skipped. Newest first, each PR once.
 * @param {string} out
 * @returns {MergedPr[]}
 */
export function parseMergedPrs(out) {
  /** @type {MergedPr[]} */
  const prs = [];
  for (const record of out.split("\x1e")) {
    const [sha, subject, body = ""] = record.replace(/^\s+/, "").split("\x1f");
    const m = subject && /^Merge pull request #(\d+) from (\S+)/.exec(subject);
    if (!m) continue;
    const number = Number(m[1]);
    if (prs.some((p) => p.number === number)) continue;
    const title =
      body
        .split(/\r?\n/)
        .find((l) => l.trim() !== "")
        ?.trim() ?? m[2].replace(/^[^/]+\//, "");
    prs.push({ number, title, sha: sha.trim() });
  }
  return prs;
}

/** @param {MergedPr[]} prs */
export function changesList(prs) {
  return prs.length === 0 ? "None" : prs.map((p) => `- #${p.number} ${p.title}`).join("\n");
}

/**
 * The issue a PR links: it must exist and carry the PR's team label; a PR that closes it needs it open.
 * @param {Issue | null} issue
 * @param {{ number: number, label: string, open?: boolean }} expect
 */
export function issueProblems(issue, { number, label, open = false }) {
  if (!issue) return [{ rule: "issue", message: `Issue #${number} doesn't exist.` }];
  /** @type {import("./report.mjs").Problem[]} */
  const problems = [];
  if (!issue.labels.includes(label)) {
    problems.push({
      rule: "issue",
      message: `Issue #${number} has the labels ${issue.labels.join(", ") || "(none)"}, not ${label}.`,
      fix: `Use an issue labelled ${label}, or add the label to #${number}.`,
    });
  }
  if (open && issue.state !== "OPEN") {
    problems.push({ rule: "issue", message: `Issue #${number} is closed; this PR would close it.` });
  }
  return problems;
}

const conflictText = (conflicts) =>
  conflicts.length === 0
    ? "Merging shows no conflicts."
    : `Merging conflicts in ${conflicts.map((f) => `\`${f}\``).join(", ")}; resolve them in this PR before merging.`;

/**
 * Whether a sync PR may merge by itself: only when it shows no conflicts. Its head is main, which
 * nobody may push to, so a conflict can't be resolved in the PR.
 * @param {string[] | null} conflicts null when this git can't tell
 */
export function syncAutoMerge(conflicts) {
  return conflicts !== null && conflicts.length === 0;
}

/**
 * @param {{
 *   templates: Record<string, string>,
 *   issue: Issue,
 *   team: string,
 *   behind: number,
 *   prs: MergedPr[],
 *   conflicts: string[],
 * }} input behind: commits on main that feature/team-N doesn't have
 * @returns {PrDraft}
 */
export function syncPr({ templates, issue, team, behind, prs, conflicts }) {
  const branch = `feature/${team}`;
  const body = fillTemplate(templates.sync, {
    sections: {
      "Linked issue": `Refs #${issue.number}`,
      Team: "platform",
      Summary: `\`${branch}\` is ${behind} commit(s) behind \`main\`, so ${team} builds without the platform fixes and other teams' work merged there since. ${conflicts.length === 0 ? "Merging shows no conflicts." : `Merging conflicts in ${conflicts.map((f) => `\`${f}\``).join(", ")}. This PR's head is \`main\`, so they can't be resolved here: bring \`main\` in through a team branch (CLAUDE.md, Branches, step 3), then merge or close this PR.`}`,
      "Included changes": changesList(prs),
      "How to test": [
        "1. CI is green on this PR.",
        `2. After merging: \`git log origin/${branch}..origin/main\` is empty.`,
      ].join("\n"),
      Screenshots: "None",
    },
    tick: {
      "The PR refers to an issue with `Refs #N`": "checked by pnpm branches:sync",
      "This PR has the same team label as the issue": true,
      "The title follows Conventional Commits": true,
      "The head branch is `main` and the base branch is `feature/team-N`": true,
      ...(conflicts.length === 0 ? { "The merge adds no new commits of its own": true } : {}),
    },
  });
  return {
    type: "sync",
    head: "main",
    base: branch,
    title: `chore(platform): bring ${branch} up to date with main`,
    labels: ["platform"],
    body,
  };
}

/**
 * The promotion of a team's integration branch into main. check:pr treats a PR from feature/team-N
 * like work (Closes #N, one of the five work templates); it is a chore, like sync PRs. Merging it deploys
 * to production.
 * @param {{
 *   templates: Record<string, string>,
 *   issue: Issue,
 *   team: string,
 *   ahead: number,
 *   behind: number,
 *   prs: MergedPr[],
 *   conflicts: string[],
 * }} input ahead: commits main doesn't have yet; behind: commits on main the feature branch lacks
 * @returns {PrDraft}
 */
export function promotePr({ templates, issue, team, ahead, behind, prs, conflicts }) {
  const branch = `feature/${team}`;
  const lines = [
    `Ships ${team}'s finished work to production, so players get it and the other teams can build on it: ${ahead} commit(s) from ${prs.length} merged pull request(s) on \`${branch}\`.`,
  ];
  if (behind > 0) {
    lines.push(
      `\`${branch}\` is ${behind} commit(s) behind main. Merge main into it first (\`pnpm branches:sync\`), or resolve it in this PR.`,
    );
  }
  lines.push(conflictText(conflicts), `Included pull requests:\n\n${changesList(prs)}`);
  const body = fillTemplate(templates.chore, {
    sections: {
      "Linked issue": `Refs #${issue.number}`,
      Team: team,
      Summary: lines.join("\n\n"),
      Impact: [
        `Once merged, ${team}'s changes deploy to production. Other teams get them when \`main\` is merged back into their feature branches (\`pnpm branches:sync\`).`,
        "",
        "Rollback: in Railway, redeploy the production deployment that ran before this merge. Then revert the merge commit on `main` through a PR (`git revert -m 1 <merge commit>`), fix on the feature branch and promote again.",
      ].join("\n"),
      "How to test": [
        "1. CI and the Workflow checks are green on this PR.",
        `2. After merging: \`git log origin/main..origin/${branch}\` is empty, the Production check run on the merge commit is green, and \`pnpm env:status\` shows production on the new \`main\`.`,
      ].join("\n"),
      Screenshots: "None",
    },
    tick: {
      "The PR closes an issue with `Closes #N`":
        "not applicable: a promotion carries many issues and refers to its team's tracking issue with `Refs #N`",
      "This PR has the same team label as the issue": true,
      "The title follows Conventional Commits": true,
      "The branch is named `<team-label>/<issue-number>-<short-description>`": `not applicable: ${branch} is ${team}'s integration branch`,
      "The base branch is correct": true,
      ...(behind === 0 ? { "The branch is up to date with its base branch": true } : {}),
    },
  });
  return {
    type: "chore",
    head: branch,
    base: "main",
    title: `chore(${team}): merge ${branch} into main`,
    labels: [team],
    body,
  };
}

/**
 * What check:pr would reject in a drafted PR, apart from the checklist items left for a person.
 * @param {PrDraft} pr
 * @param {{ config: any, templates: Record<string, string> }} ctx
 */
export function bodyProblems(pr, { config, templates }) {
  const { problems } = checkPr({ ...pr, config, templates });
  return problems.filter((p) => !(p.rule === "checklist" && /not ticked/.test(p.message)));
}
