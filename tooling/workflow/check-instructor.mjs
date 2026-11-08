// `pnpm check:instructor`: checks that the team-instructor identity (the label, the title form, the Team
// section) is only used by the instructors listed in .github/instructors.json.
//
//   node tooling/workflow/check-instructor.mjs --event "$GITHUB_EVENT_PATH"   a pull_request or issues event (CI)
//   pnpm check:instructor --kind pr --number 99                                       a PR or issue read with the GitHub CLI
//   pnpm check:instructor --kind issue --number 102
//   --json                                                                            machine-readable output
//
// Exit codes: 0 allowed, 1 blocked, 2 usage error, 3 environment problem (gh missing or not logged in).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EXIT, parseArgs } from "./lib/args.mjs";
import { checkInstructor, itemFromEvent, loadInstructors } from "./lib/check-instructor.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const { flags } = parseArgs(process.argv.slice(2), { boolean: ["json"] });
const str = (name) => (typeof flags[name] === "string" ? flags[name] : null);

const usage = () => {
  console.error("usage: pnpm check:instructor (--event <file> | --kind pr|issue --number <n>) [--json]");
  process.exit(EXIT.usage);
};

let item;
if (str("event")) {
  if (!existsSync(str("event"))) {
    console.error(`error: event file not found: ${str("event")}`);
    process.exit(EXIT.usage);
  }
  item = itemFromEvent(JSON.parse(readFileSync(str("event"), "utf8")));
  if (!item) {
    console.error("error: the event has neither a pull_request nor an issue.");
    process.exit(EXIT.usage);
  }
} else if (str("number") && ["pr", "issue"].includes(str("kind"))) {
  const kind = str("kind");
  try {
    const out = execFileSync("gh", [kind, "view", str("number"), "--json", "author,labels,title,body"], {
      cwd: root,
      encoding: "utf8",
    });
    const data = JSON.parse(out);
    item = {
      kind,
      author: data.author?.login ?? null,
      labels: data.labels.map((l) => l.name),
      title: data.title,
      body: data.body ?? "",
    };
  } catch (err) {
    console.error(
      `error: could not read ${kind} #${str("number")} with the GitHub CLI (installed and logged in with "gh auth login"?): ${err.stderr?.toString().trim() || err.message}`,
    );
    process.exit(EXIT.environment);
  }
} else {
  usage();
}

const result = checkInstructor({ ...item, instructors: loadInstructors(root) });

if (flags.json === true) {
  console.log(JSON.stringify({ kind: item.kind, author: item.author, ...result }, null, 2));
} else if (result.ok) {
  console.log(
    result.claims.length === 0
      ? `ok: this ${item.kind === "pr" ? "pull request" : "issue"} does not use the team-instructor identity`
      : `ok: ${item.author} is an instructor and may use the team-instructor identity`,
  );
} else {
  console.error(`instructor gate: BLOCKED`);
  for (const p of result.problems) console.error(`  - [${p.rule}] ${p.message}`);
}
process.exit(result.ok ? EXIT.ok : EXIT.failed);
