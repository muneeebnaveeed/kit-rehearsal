// `pnpm labels:sync`: makes the repo's GitHub labels match tooling/workflow/labels.json.
// Renames keep every issue and PR that has the old label.
//
//   pnpm labels:sync            dry run: print what would change
//   pnpm labels:sync --apply    make the changes
//   --json                      machine-readable plan
//
// Exit codes: 0 in sync (or applied), 1 dry run found changes, 2 usage error, 3 environment problem (gh).
import { execFileSync } from "node:child_process";
import { EXIT, parseArgs } from "./lib/args.mjs";
import { environmentError, root } from "./lib/context.mjs";
import { loadLabels, planLabelSync } from "./lib/labels.mjs";

const { flags } = parseArgs(process.argv.slice(2), { boolean: ["apply", "json"] });

/** @param {string[]} args */
function gh(args) {
  try {
    return execFileSync("gh", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    if (err.code === "ENOENT")
      environmentError("the GitHub CLI (gh) isn't installed: https://cli.github.com");
    environmentError(
      `gh ${args.slice(0, 3).join(" ")} failed: ${err.stderr?.toString().trim() || err.message}`,
    );
  }
}

const current = JSON.parse(gh(["label", "list", "--limit", "500", "--json", "name,color,description"]));
const changes = planLabelSync(loadLabels(root), current);

if (flags.json === true) {
  console.log(JSON.stringify({ applied: flags.apply === true, changes }, null, 2));
} else if (changes.length === 0) {
  console.log("ok: labels match labels.json");
} else {
  for (const c of changes) {
    const detail = c.action === "rename" ? `${c.from} -> ${c.name}` : c.name;
    console.log(`${flags.apply === true ? "" : "would "}${c.action}: ${detail}`);
  }
}

if (flags.apply === true) {
  for (const c of changes) {
    if (c.action === "create")
      gh(["label", "create", c.name, "--color", c.color, "--description", c.description]);
    if (c.action === "update")
      gh(["label", "edit", c.name, "--color", c.color, "--description", c.description]);
    if (c.action === "rename")
      gh(["label", "edit", c.from, "--name", c.name, "--color", c.color, "--description", c.description]);
    if (c.action === "delete") gh(["label", "delete", c.name, "--yes"]);
  }
  if (changes.length > 0 && flags.json !== true) console.log(`\napplied ${changes.length} change(s)`);
  process.exit(EXIT.ok);
}
process.exit(changes.length === 0 ? EXIT.ok : EXIT.failed);
