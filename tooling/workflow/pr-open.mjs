// `pnpm pr:open`: opens the current work branch's pull request the way CLAUDE.md says, into your
// team's branch (feature/team-N; main for platform and instructors).
//
//   1. refuses another team's branch or issue label, a closed issue, or a branch that already has a PR
//   2. runs `pnpm preflight` and refuses when it fails
//   3. classifies the change like `pnpm workflow:classify --kind pr` (type, template, labels)
//   4. drafts the title and body: every field it can fill from facts, and only the checklist
//      items it verified ticked
//   5. runs the check:pr rules on the draft, and refuses when they fail
//   6. pushes the branch and runs `gh pr create`
//
//   --team <team>             your team for this run only (the first run asks and saves it; see team:set)
//   --type <type>             when the classifier can't decide (feature, bug, docs, chore, refactor)
//   --title "<text>"          the title (default: from the issue title, else the commits)
//   --<field> "<text>"        fill a field, named after its label: --summary (required: why the change
//                             exists, in 2 or 3 sentences, never a list of what changed), --how-to-test,
//                             --screenshots (an image, or "None, <why there is nothing to show>"),
//                             --root-cause, --impact, --behaviour-unchanged, --pages-affected
//   --tested                  you ran the steps you wrote under --how-to-test (ticks that item)
//   --body-file <file>        use this body instead of drafting one (still checked)
//   --dry-run                 do everything except push and create the PR; print the draft
//   --json                    machine-readable output
//
// The draft is saved in the git directory (.git/kit/pr-body.md), so after a refusal you can finish it and pass --body-file.
// Exit codes: 0 opened (or drafted), 1 refused, 2 usage error (including no team and no terminal),
// 3 environment problem (git, gh).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { EXIT, parseArgs } from "./lib/args.mjs";
import { checkSubject } from "./lib/check-commit.mjs";
import { checkPr } from "./lib/check-pr.mjs";
import { root } from "./lib/context.mjs";
import { findOpenPr, getIssueDetails } from "./lib/gh.mjs";
import { branchSubjects, changedFiles, currentBranch, git } from "./lib/git.mjs";
import { loadOwnership } from "./lib/ownership.mjs";
import {
  buildPrBody,
  defaultSections,
  factOf,
  PREFLIGHT_TEST_TEXT,
  planPrOpen,
  preflightFacts,
  prTitle,
  sectionFlag,
} from "./lib/pr-open.mjs";
import { baseFor, classifyChange, strongestSubject, WORK_BRANCH } from "./lib/rules.mjs";
import { getTeam, stop } from "./lib/team-io.mjs";
import { fieldLabelsOf } from "./lib/template.mjs";
import { loadTypes } from "./lib/types.mjs";

const COMMAND = "pr:open";
const RESERVED = ["linked-issue", "team", "checklist"];
// Fields that say why: only a person knows, and a diff summary is not an answer.
const WHY_FIELDS = ["Summary", "Root cause"];
const { flags, positional } = parseArgs(process.argv.slice(2), { boolean: ["json", "dry-run", "tested"] });
const json = flags.json === true;
const dryRun = flags["dry-run"] === true;
const str = (name) => (typeof flags[name] === "string" ? flags[name] : null);

const config = loadTypes(root);
const templates = Object.fromEntries(
  Object.entries(config.types)
    .filter(([, t]) => t.prTemplate)
    .map(([name, t]) => [name, readFileSync(path.join(root, t.prTemplate), "utf8")]),
);
const sectionFlags = new Set(
  Object.values(templates)
    .flatMap(fieldLabelsOf)
    .map(sectionFlag)
    .filter((f) => !RESERVED.includes(f)),
);
const known = new Set(["json", "dry-run", "tested", "team", "type", "title", "body-file", ...sectionFlags]);
const unknown = Object.keys(flags).filter((f) => !known.has(f));
if (positional.length > 0 || unknown.length > 0) {
  stop(
    COMMAND,
    EXIT.usage,
    `${unknown.length ? `unknown option --${unknown[0]}. ` : ""}usage: pnpm pr:open [--team <team>] [--type <type>] [--title <text>] [--${[...sectionFlags].join(" <text>] [--")} <text>] [--tested] [--body-file <file>] [--dry-run] [--json]`,
    json,
  );
}
if (str("type") && !["feature", "bug", "docs", "chore", "refactor"].includes(str("type"))) {
  stop(
    COMMAND,
    EXIT.usage,
    `--type must be feature, bug, docs, chore or refactor, not "${str("type")}".`,
    json,
  );
}
if (str("body-file") && !existsSync(str("body-file"))) {
  stop(COMMAND, EXIT.usage, `file not found: ${str("body-file")}`, json);
}

/** @param {string[]} args */
const run = (args) => {
  try {
    return git(root, args);
  } catch (err) {
    stop(
      COMMAND,
      EXIT.environment,
      `git ${args[0]} failed: ${err.stderr?.toString().trim() || err.message}`,
      json,
    );
  }
};
const say = (line) => {
  if (!json) console.error(line);
};

/**
 * @param {string} summary
 * @param {{ rule: string, message: string, fix?: string }[]} problems
 * @param {Record<string, unknown>} [extra]
 */
const finish = (summary, problems, extra = {}) => {
  const ok = problems.length === 0;
  if (json) {
    console.log(
      JSON.stringify(
        { command: COMMAND, ok, summary, dryRun, team, teamSource, problems, warnings, ...extra },
        null,
        2,
      ),
    );
  } else {
    for (const w of warnings) console.error(`warning: ${w}`);
    if (ok) console.log(`ok: ${COMMAND}: ${summary}`);
    else {
      console.error(`${COMMAND}: ${summary}`);
      for (const p of problems) {
        console.error(`  - [${p.rule}] ${p.message}`);
        if (p.fix) console.error(`    fix: ${p.fix}`);
      }
    }
  }
  process.exit(ok ? EXIT.ok : EXIT.failed);
};

/** @type {string[]} */
const warnings = [];
const branch = (() => {
  try {
    return currentBranch(root);
  } catch (err) {
    stop(COMMAND, EXIT.environment, `git failed: ${err.stderr?.toString().trim() || err.message}`, json);
  }
})();
const { team, source: teamSource } = await getTeam({
  root,
  command: COMMAND,
  flag: str("team"),
  teamLabels: config.teamLabels,
  json,
});
if (teamSource === "flag")
  warnings.push(`--team ${team} applies to this run only; your saved team is unchanged.`);

// 1. Branch, team, issue and an existing PR: cheap, so before the slow preflight.
const work = WORK_BRANCH.exec(branch);
const issue = work ? getIssueDetails(Number(work[2])) : undefined;
const existingPr = work ? findOpenPr(branch) : null;
const plan = planPrOpen({ branch, team, teamLabels: config.teamLabels, issue, existingPr });
if (!plan.ok || !issue) finish(`won't open a PR for ${branch}`, plan.problems, { branch, base: plan.base });
const { base, label, number } = plan;

// 2. Preflight, against an up-to-date base.
run(["fetch", "origin", base]);
say(
  `Running pnpm preflight for ${branch} -> ${base} (lint, typecheck, test, build and the branch checks)...`,
);
const pre = spawnSync(
  process.execPath,
  [path.join(root, "tooling/workflow/preflight.mjs"), "--json", "--base", base],
  {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  },
);
/** @type {{ ok: boolean, steps: { name: string, ok: boolean, exitCode: number, warnings: string[], output: string }[] }} */
let preflight;
try {
  preflight = JSON.parse(pre.stdout);
} catch {
  stop(
    COMMAND,
    EXIT.environment,
    `pnpm preflight did not report a result: ${(pre.stderr || pre.stdout).trim().slice(-500)}`,
    json,
  );
}
if (!preflight.ok) {
  const failed = preflight.steps.filter((s) => !s.ok);
  if (!json)
    for (const s of failed)
      console.error(
        `FAIL ${s.name}\n${s.output
          .split("\n")
          .slice(-15)
          .map((l) => `     ${l}`)
          .join("\n")}`,
      );
  if (failed.some((s) => s.exitCode === EXIT.environment)) {
    stop(
      COMMAND,
      EXIT.environment,
      `pnpm preflight hit an environment problem in: ${failed.map((s) => s.name).join(", ")}.`,
      json,
    );
  }
  finish(
    "pnpm preflight failed; no PR opened",
    failed.map((s) => ({
      rule: "preflight",
      message: `${s.name} failed.`,
      fix: `Run "pnpm preflight" and fix it.`,
    })),
    { branch, base, preflight: failed.map((s) => s.name) },
  );
}
for (const s of preflight.steps)
  for (const w of s.warnings) warnings.push(`${s.name}: ${w.replace(/^warning:\s*/, "")}`);

// 3. Classify, like `pnpm workflow:classify --kind pr --base origin/<base>`.
const baseRef = `origin/${base}`;
const files = (() => {
  try {
    return changedFiles(root, { base: baseRef });
  } catch (err) {
    stop(COMMAND, EXIT.environment, `git diff failed: ${err.stderr?.toString().trim() || err.message}`, json);
  }
})();
const subjects = branchSubjects(root, baseRef);
const classification = classifyChange({
  files,
  config,
  ownership: loadOwnership(root),
  kind: "pr",
  hint: strongestSubject(subjects, config.prefixPrecedence),
  branch,
  type: str("type"),
  label,
  target: base,
});
if (!classification.ok) {
  finish(
    classification.undecided ? "the classifier can't decide the PR type" : "the change can't be classified",
    classification.errors.map((message) => ({
      rule: "classify",
      message,
      ...(classification.undecided
        ? { fix: `Ask which it is, then pass --type <${classification.candidates.join("|")}>.` }
        : {}),
    })),
    { branch, base },
  );
}
const type = classification.type;
const typeConfig = config.types[type];
const labels = [label]; // only the team label: see "Labels" in CLAUDE.md
for (const w of classification.warnings) warnings.push(w);

// 4. Title and body.
const title =
  str("title") ??
  prTitle({
    commitType: classification.commitType ?? typeConfig.commitTypes[0],
    team,
    issueTitle: issue.title,
    subjects,
    precedence: config.prefixPrecedence,
  });
if (!title) {
  finish(
    "no valid title could be made from the issue or the commits",
    [
      {
        rule: "title",
        message: "Neither the issue title nor a commit subject makes a valid PR title.",
        fix: `Pass --title "${typeConfig.commitTypes[0]}(${team}): <imperative summary>".`,
      },
    ],
    { branch, base, type },
  );
}
const titleCheck = checkSubject(title);
const upToDate = (() => {
  try {
    git(root, ["merge-base", "--is-ancestor", baseRef, "HEAD"]);
    return true;
  } catch {
    return false;
  }
})();
const howToTest = str("how-to-test");
const facts = {
  issueLinked: true, // planPrOpen: the issue exists, is open and has the branch's team label
  sameLabel: labels.includes(label),
  title: titleCheck.problems.length === 0 && titleCheck.scope === team,
  branchName: true, // planPrOpen: a work branch of your team
  ...preflightFacts(preflight.steps),
  base: baseFor(branch, config.teamLabels) === base,
  upToDate,
  tested: howToTest === null || flags.tested === true, // the default text is the preflight that just passed
};

const template = templates[type];
const headings = fieldLabelsOf(template);
for (const f of sectionFlags) {
  if (str(f) !== null && !headings.some((h) => sectionFlag(h) === f))
    warnings.push(`The ${type} template has no field for --${f}; it was ignored.`);
}
let body;
let unticked = [];
let missing = [];
if (str("body-file")) {
  body = readFileSync(str("body-file"), "utf8");
} else {
  const sections = {
    ...defaultSections({ files: files.map((f) => f.path) }),
    "How to test": howToTest ?? PREFLIGHT_TEST_TEXT,
    "Linked issue": `Closes #${number}`,
    Team: team,
  };
  for (const h of headings)
    if (str(sectionFlag(h)) !== null && !RESERVED.includes(sectionFlag(h))) sections[h] = str(sectionFlag(h));
  ({ body, unticked, missing } = buildPrBody({ template, sections, facts }));
}
const gitPath = run(["rev-parse", "--git-path", "kit/pr-body.md"]).trim();
const draft = path.resolve(root, gitPath);
mkdirSync(path.dirname(draft), { recursive: true });
writeFileSync(draft, body);

// 5. The check:pr rules on the draft.
const checked = checkPr({ title, body, head: branch, base, labels, type, config, templates, classification });
const FIX = {
  upToDate: `Merge ${baseRef} into your branch, then run pr:open again.`,
  tested: "Run the steps you wrote under --how-to-test, then pass --tested.",
  ownership:
    "The branch changes another team's files. Check the issue explains why, then tick it in the draft and pass --body-file.",
};
const problems = checked.problems.map((p) => ({ ...p }));
for (const m of missing) {
  problems.push({
    rule: "section",
    message: `pr:open can't fill "**${m}**" from facts.`,
    fix: WHY_FIELDS.includes(m)
      ? `Pass --${sectionFlag(m)} "<why, in 2 or 3 sentences: the problem or goal and its impact, not what changed>".`
      : m === "Screenshots"
        ? 'Pass --screenshots "<image link>", or --screenshots "None, <why there is nothing to show>".'
        : `Pass --${sectionFlag(m)} "<text>".`,
  });
}
for (const item of unticked) {
  const fix = FIX[factOf(item) ?? ""];
  problems.push({
    rule: "unverified",
    message: `Not verified, so not ticked: "${item}"`,
    ...(fix ? { fix } : {}),
  });
}
warnings.push(...checked.warnings);
const extra = {
  branch,
  base,
  type,
  template: typeConfig.prTemplate,
  title,
  labels,
  issue: number,
  draft,
  body,
};
if (problems.length > 0) {
  warnings.push(
    `The draft is in ${path.relative(root, draft)}. Finish it and pass --body-file, or fix the cause and run pr:open again.`,
  );
  finish("the draft doesn't pass check:pr; no PR opened", problems, extra);
}

const createArgs = [
  "pr",
  "create",
  "--base",
  base,
  "--head",
  branch,
  "--title",
  title,
  "--body-file",
  draft,
  ...labels.flatMap((l) => ["--label", l]),
];
if (dryRun) {
  if (!json) {
    console.log(`Title:  ${title}\nBase:   ${base}\nLabels: ${labels.join(", ")}\n\n${body}`);
    console.log(
      `Would run:\n  git push -u origin ${branch}\n  gh ${createArgs.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`,
    );
  }
  finish(`dry run: the draft passes check:pr; would open ${branch} -> ${base}`, [], extra);
}

// 6. Push and open.
run(["push", "-u", "origin", branch]);
let url;
try {
  url = execFileSync("gh", createArgs, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
} catch (err) {
  stop(
    COMMAND,
    EXIT.environment,
    `gh pr create failed: ${err.stderr?.toString().trim() || err.message}`,
    json,
  );
}
finish(`opened ${url}`, [], { ...extra, url });
