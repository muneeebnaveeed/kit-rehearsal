// `pnpm check:issue`: checks that an issue follows its template (title prefix, one team label,
// every heading present and filled, a "Done when" checklist).
//
//   pnpm check:issue --file body.md --title "[platform] Add X" [--labels platform] [--type feature]
//   pnpm check:issue --number 41            reads the issue with the GitHub CLI
//   pnpm check:issue ... --json             machine-readable output
//
// Exit codes: 0 valid, 1 problems found, 2 usage error, 3 environment problem (gh missing or not logged in).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EXIT, parseArgs } from "./lib/args.mjs";
import { checkIssue } from "./lib/check-issue.mjs";
import { loadTypes } from "./lib/types.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const { flags } = parseArgs(process.argv.slice(2), { boolean: ["json"] });
const json = flags.json === true;

const usage = () => {
  console.error(
    'usage: pnpm check:issue (--file <body.md> --title "<title>" [--labels a,b] | --number <n>) [--type <type>] [--json]',
  );
  process.exit(EXIT.usage);
};

let title;
let body;
let labels =
  typeof flags.labels === "string"
    ? flags.labels
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean)
    : null;

if (typeof flags.number === "string") {
  try {
    const out = execFileSync("gh", ["issue", "view", flags.number, "--json", "title,body,labels"], {
      cwd: root,
      encoding: "utf8",
    });
    const issue = JSON.parse(out);
    title = issue.title;
    body = issue.body ?? "";
    labels = issue.labels.map((l) => l.name);
  } catch (err) {
    console.error(
      `error: could not read issue #${flags.number} with the GitHub CLI (installed and logged in with "gh auth login"?): ${err.stderr?.toString().trim() || err.message}`,
    );
    process.exit(EXIT.environment);
  }
} else if (typeof flags.file === "string" && typeof flags.title === "string") {
  if (!existsSync(flags.file)) {
    console.error(`error: file not found: ${flags.file}`);
    process.exit(EXIT.usage);
  }
  title = flags.title;
  body = readFileSync(flags.file, "utf8");
} else {
  usage();
}

const config = loadTypes(root);
if (typeof flags.type === "string" && !config.types[flags.type]?.issueTemplate) {
  console.error(`error: no issue template for type "${flags.type}".`);
  process.exit(EXIT.usage);
}
const templates = Object.fromEntries(
  Object.entries(config.types)
    .filter(([, t]) => t.issueTemplate)
    .map(([name, t]) => [name, readFileSync(`${root}/${t.issueTemplate}`, "utf8")]),
);

const result = checkIssue({
  title,
  body,
  labels,
  type: typeof flags.type === "string" ? flags.type : null,
  config,
  templates,
});

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.ok) {
  console.log(`ok: issue follows the ${result.type} template`);
} else {
  console.error(`issue does not follow the ${result.type} template:`);
  for (const p of result.problems) console.error(`  - [${p.rule}] ${p.message}`);
}
process.exit(result.ok ? EXIT.ok : EXIT.failed);
