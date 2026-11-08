// `pnpm workflow:classify`: decides what sort of change this is, so issues, pull requests and commits
// all use the same type, template and label. Deterministic: the same change set always gives the same
// answer, and when the rules cannot decide it says so instead of guessing.
//
//   pnpm workflow:classify --kind issue|pr|commit [options]
//
//   --staged             classify what `git commit` would record
//   --base <ref>         classify everything on --head since it forked from <ref>
//   --head <ref>         with --base; defaults to HEAD
//   (no change source)   classify all uncommitted work
//   --title "<text>"     title or subject; a Conventional-Commit prefix ("fix: ...") decides the type
//   --type <type>        decide the type yourself (feature, bug, docs, chore, refactor)
//   --label <label>      decide the team label yourself
//   --branch <name>      branch name (defaults to the current branch)
//   --actor <login>      the GitHub account running this (default: `gh api user`); decides who may get team-instructor
//   --target <branch>    with --kind pr: the branch the PR targets (which feature branch a sync from main goes to)
//   --json               machine-readable output
//
// Exit codes: 0 classified, 1 undecided or invalid, 2 usage error, 3 environment problem (git).
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { EXIT, parseArgs } from "./lib/args.mjs";
import { guardLabel, loadInstructors } from "./lib/check-instructor.mjs";
import { branchSubjects, changedFiles, currentBranch } from "./lib/git.mjs";
import { loadOwnership } from "./lib/ownership.mjs";
import { classifyChange, strongestSubject } from "./lib/rules.mjs";
import { loadTypes } from "./lib/types.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const { flags } = parseArgs(process.argv.slice(2), { boolean: ["staged", "json"] });
const json = flags.json === true;

function finish(result, code) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(`type:      ${result.type}  (rule: ${result.rule})`);
    console.log(`label:     ${result.label ?? "-"}  (${result.labelSource ?? "none"})`);
    if (result.template) console.log(`template:  ${result.template}`);
    if (result.base) console.log(`base:      ${result.base}`);
    if (result.commitType)
      console.log(`commit:    ${result.commitType}${result.scope ? `(${result.scope})` : ""}: ...`);
    for (const w of result.warnings) console.log(`warning:   ${w}`);
  } else {
    for (const e of result.errors) console.error(`error: ${e}`);
  }
  process.exit(code);
}

const kind = flags.kind;
if (!["issue", "pr", "commit"].includes(kind)) {
  console.error(
    "usage: pnpm workflow:classify --kind issue|pr|commit [--staged | --base <ref> [--head <ref>]] [--title <text>] [--type <type>] [--label <label>] [--target <branch>] [--json]",
  );
  process.exit(EXIT.usage);
}

const config = loadTypes(root);
if (typeof flags.type === "string" && !config.types[flags.type]) {
  console.error(`error: unknown type "${flags.type}". Known types: ${Object.keys(config.types).join(", ")}.`);
  process.exit(EXIT.usage);
}
if (typeof flags.label === "string" && !config.teamLabels.includes(flags.label)) {
  console.error(`error: unknown label "${flags.label}". Known labels: ${config.teamLabels.join(", ")}.`);
  process.exit(EXIT.usage);
}

let files;
let branch;
let hint = typeof flags.title === "string" ? flags.title : null;
try {
  files = changedFiles(root, {
    staged: flags.staged === true,
    base: typeof flags.base === "string" ? flags.base : undefined,
    head: typeof flags.head === "string" ? flags.head : undefined,
  });
  branch = typeof flags.branch === "string" ? flags.branch : currentBranch(root);
  if (!hint && typeof flags.base === "string") {
    const head = typeof flags.head === "string" ? flags.head : "HEAD";
    hint = strongestSubject(branchSubjects(root, flags.base, head), config.prefixPrecedence);
  }
} catch (err) {
  console.error(`error: git failed: ${err.stderr?.toString().trim() || err.message}`);
  process.exit(EXIT.environment);
}

const result = classifyChange({
  files,
  config,
  ownership: loadOwnership(root),
  kind,
  hint,
  branch,
  type: typeof flags.type === "string" ? flags.type : null,
  label: typeof flags.label === "string" ? flags.label : null,
  target: typeof flags.target === "string" ? flags.target : null,
});

if (!result.undecided && result.ok) {
  const t = config.types[result.type];
  result.template = kind === "issue" ? t.issueTemplate : kind === "pr" ? t.prTemplate : null;
  result.commitTypes = t.commitTypes;
  result.githubLabels = [result.label].filter(Boolean);
  if (kind === "issue" && !result.template) {
    result.ok = false;
    result.errors.push(`Type "${result.type}" has no issue template.`);
  }
  if (kind !== "commit" && !result.label) {
    result.ok = false;
    result.errors.push("No team label could be derived. Pass --label.");
  }
}
// The team-instructor label is reserved for the instructors (.github/instructors.json).
if (result.ok && result.label === "team-instructor") {
  let actor = typeof flags.actor === "string" ? flags.actor : null;
  if (!actor) {
    try {
      actor = execFileSync("gh", ["api", "user", "--jq", ".login"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      actor = null;
    }
  }
  const guard = guardLabel({ label: result.label, actor: actor || null, instructors: loadInstructors(root) });
  if (guard && "error" in guard) {
    result.ok = false;
    result.errors.push(guard.error);
  } else if (guard) {
    result.warnings.push(guard.warning);
  }
}
result.kind = kind;
result.files = files.length;
finish(result, result.ok ? EXIT.ok : EXIT.failed);
