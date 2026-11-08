// `pnpm check:pr`: checks that a pull request follows its template (title, team label, branch and
// base branch names, every field filled, linked issue).
//
//   pnpm check:pr --number 45                      reads the PR with the GitHub CLI
//   pnpm check:pr --event "$GITHUB_EVENT_PATH"     reads a pull_request event (used by CI)
//   pnpm check:pr --title "feat(platform): add x" --body-file body.md --head platform/1-x --base main [--labels platform]
//
//   --git-base <ref> [--git-head <ref>]   also classify the changed files; a different type than the
//                                         template used is reported as a warning
//   --type <type>                         check against this template instead of detecting it
//   --json                                machine-readable output
//
// Exit codes: 0 valid, 1 problems found, 2 usage error, 3 environment problem (gh missing or not logged in).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EXIT, parseArgs } from "./lib/args.mjs";
import { checkPr } from "./lib/check-pr.mjs";
import { branchSubjects, changedFiles } from "./lib/git.mjs";
import { loadOwnership } from "./lib/ownership.mjs";
import { classifyChange, strongestSubject } from "./lib/rules.mjs";
import { loadTypes } from "./lib/types.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const { flags } = parseArgs(process.argv.slice(2), { boolean: ["json"] });
const json = flags.json === true;
const str = (name) => (typeof flags[name] === "string" ? flags[name] : null);

const usage = () => {
  console.error(
    "usage: pnpm check:pr (--number <n> | --event <file> | --title <t> --body-file <f> --head <b> --base <b> [--labels a,b]) [--git-base <ref> [--git-head <ref>]] [--type <type>] [--json]",
  );
  process.exit(EXIT.usage);
};

let pr;
if (str("number")) {
  try {
    const out = execFileSync(
      "gh",
      ["pr", "view", str("number"), "--json", "title,body,headRefName,baseRefName,labels"],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
    const data = JSON.parse(out);
    pr = {
      title: data.title,
      body: data.body,
      head: data.headRefName,
      base: data.baseRefName,
      labels: data.labels.map((l) => l.name),
    };
  } catch (err) {
    console.error(
      `error: could not read PR #${str("number")} with the GitHub CLI (installed and logged in with "gh auth login"?): ${err.stderr?.toString().trim() || err.message}`,
    );
    process.exit(EXIT.environment);
  }
} else if (str("event")) {
  if (!existsSync(str("event"))) {
    console.error(`error: event file not found: ${str("event")}`);
    process.exit(EXIT.usage);
  }
  const data = JSON.parse(readFileSync(str("event"), "utf8")).pull_request;
  if (!data) {
    console.error("error: the event file has no pull_request. Run this on a pull_request event.");
    process.exit(EXIT.usage);
  }
  pr = {
    title: data.title,
    body: data.body,
    head: data.head.ref,
    base: data.base.ref,
    labels: data.labels.map((l) => l.name),
  };
} else if (str("title") && str("body-file") && str("head") && str("base")) {
  if (!existsSync(str("body-file"))) {
    console.error(`error: file not found: ${str("body-file")}`);
    process.exit(EXIT.usage);
  }
  pr = {
    title: str("title"),
    body: readFileSync(str("body-file"), "utf8"),
    head: str("head"),
    base: str("base"),
    labels: str("labels")
      ? str("labels")
          .split(",")
          .map((l) => l.trim())
          .filter(Boolean)
      : null,
  };
} else {
  usage();
}

const config = loadTypes(root);
if (str("type") && !config.types[str("type")]?.prTemplate) {
  console.error(`error: no PR template for type "${str("type")}".`);
  process.exit(EXIT.usage);
}
const templates = Object.fromEntries(
  Object.entries(config.types)
    .filter(([, t]) => t.prTemplate)
    .map(([name, t]) => [name, readFileSync(`${root}/${t.prTemplate}`, "utf8")]),
);

let classification = null;
let classifyNote = null;
if (str("git-base") && pr.head !== "main" && !/^feature\/team-[1-4]$/.test(pr.head)) {
  try {
    const head = str("git-head") ?? "HEAD";
    classification = classifyChange({
      files: changedFiles(root, { base: str("git-base"), head }),
      config,
      ownership: loadOwnership(root),
      kind: "pr",
      hint: strongestSubject(branchSubjects(root, str("git-base"), head), config.prefixPrecedence),
      branch: pr.head,
      target: pr.base,
    });
  } catch (err) {
    classifyNote = `Could not classify the changed files (${err.stderr?.toString().trim() || err.message}).`;
  }
}

const result = checkPr({ ...pr, type: str("type"), config, templates, classification });
if (classifyNote) result.warnings.push(classifyNote);

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  for (const w of result.warnings) console.error(`warning: ${w}`);
  if (result.ok) {
    console.log(`ok: PR follows the ${result.type} template`);
  } else {
    console.error(`PR does not follow the ${result.type} template:`);
    for (const p of result.problems) console.error(`  - [${p.rule}] ${p.message}`);
  }
}
process.exit(result.ok ? EXIT.ok : EXIT.failed);
