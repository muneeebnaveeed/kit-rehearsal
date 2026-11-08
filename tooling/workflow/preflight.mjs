// `pnpm preflight`: everything a branch must pass before it becomes a PR, in one command.
// `pnpm preflight:quick`: the fast subset agents run after every change.
//
//   full:  setup, lint, typecheck, test, build, then check:branch, check:ownership, check:commit
//          (the branch's commits), check:files, check:secrets, check:docs, check:config,
//          check:determinism and check:contract
//   quick: lint, typecheck, check:ownership
//
//   --quick                 the fast subset
//   --base <branch>         compare against this base (default: the base the branch model expects)
//   --offline               skip GitHub lookups (the linked issue)
//   --json                  machine-readable summary
//
// Exit codes: 0 everything passed, 1 a step failed, 2 usage error, 3 environment problem.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { EXIT, parseArgs } from "./lib/args.mjs";
import { resolveContext, root } from "./lib/context.mjs";

const { flags } = parseArgs(process.argv.slice(2), { boolean: ["json", "quick", "offline"] });
const json = flags.json === true;
const quick = flags.quick === true;
const { branch, base, baseRef } = resolveContext(flags);

const shared = [...(base ? ["--base", base] : []), ...(flags.offline === true ? ["--offline"] : [])];
const node = (script, ...args) => ({
  cmd: process.execPath,
  args: [path.join("tooling/workflow", script), ...args],
});
// shell only on Windows, so pnpm.cmd resolves there; every argument is a fixed string.
// No flags before the script name: newer pnpm releases reject the old short ones (see .githooks/pre-push).
const pnpm = (...args) => ({ cmd: "pnpm", args: ["run", ...args], shell: process.platform === "win32" });

/** @type {{ name: string, cmd: string, args: string[], shell?: boolean }[]} */
const steps = quick
  ? [
      { name: "lint", ...pnpm("lint") },
      { name: "typecheck", ...pnpm("typecheck") },
      { name: "ownership", ...node("check-ownership.mjs", ...shared) },
    ]
  : [
      { name: "setup", ...pnpm("check:setup", "--ci") },
      { name: "lint", ...pnpm("lint") },
      { name: "typecheck", ...pnpm("typecheck") },
      { name: "test", ...pnpm("test") },
      { name: "build", ...pnpm("build") },
      { name: "branch", ...node("check-branch.mjs", ...shared) },
      { name: "ownership", ...node("check-ownership.mjs", ...shared) },
      ...(baseRef
        ? [
            {
              name: "commits",
              ...node("check-commit.mjs", "--range", `${baseRef}..HEAD`, "--exclude", "origin/main"),
            },
          ]
        : []),
      { name: "files", ...node("check-files.mjs", ...shared) },
      { name: "secrets", ...node("check-files.mjs", "secrets", ...shared) },
      { name: "docs", ...node("check-docs.mjs") },
      { name: "config", ...node("check-config.mjs") },
      { name: "determinism", ...node("check-determinism.mjs") },
      { name: "contract", ...node("check-contract.mjs", ...shared) },
    ];

const results = [];
for (const step of steps) {
  const started = Date.now();
  const run = spawnSync(step.cmd, step.args, { cwd: root, encoding: "utf8", shell: step.shell ?? false });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim();
  const res = {
    name: step.name,
    ok: run.status === 0,
    exitCode: run.status,
    seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    warnings: output.split("\n").filter((l) => l.startsWith("warning:")),
    output,
  };
  results.push(res);
  if (!json) {
    console.log(`${res.ok ? "ok  " : "FAIL"} ${res.name} (${res.seconds}s)`);
    if (!res.ok) console.log(indent(output.split("\n").slice(-30).join("\n")));
    else for (const w of res.warnings) console.log(indent(w));
  }
}

const failed = results.filter((r) => !r.ok);
const environment = failed.some((r) => r.exitCode === EXIT.environment);
if (json) {
  console.log(JSON.stringify({ ok: failed.length === 0, branch, base, steps: results }, null, 2));
} else if (failed.length === 0) {
  console.log(
    `\n${quick ? "Quick preflight" : "Preflight"} passed for ${branch}${base ? ` -> ${base}` : ""}.`,
  );
} else {
  console.log(`\n${failed.length} step(s) failed: ${failed.map((r) => r.name).join(", ")}.`);
}
process.exit(failed.length === 0 ? EXIT.ok : environment ? EXIT.environment : EXIT.failed);

/** @param {string} text */
function indent(text) {
  return text
    .split("\n")
    .map((l) => `     ${l}`)
    .join("\n");
}
