// `pnpm check:setup`: checks that this machine is set up like everyone else's, and says how to fix
// anything that isn't. Plain JavaScript with no dependencies, so it runs on macOS, Windows and Linux.
//
//   pnpm check:setup           all checks
//   pnpm check:setup --ci      skip checks that only make sense on a developer machine (ports)
//   pnpm check:setup --json    machine-readable output for scripts and agents
//
// Exit codes: 0 all checks passed, 1 a check failed.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkNode } from "./check-node.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = new Set(process.argv.slice(2));
const ci = args.has("--ci");
const json = args.has("--json");

/** @type {{ name: string, ok: boolean, detail: string, fix?: string }[]} */
const results = [];
const record = (name, ok, detail, fix) => results.push({ name, ok, detail, ...(ok ? {} : { fix }) });

function trackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" });
  return out.split("\0").filter(Boolean);
}

// 1. Node version
{
  const r = checkNode();
  record("node", r.ok, `node ${r.current} (pinned ${r.wanted})`, r.fix);
}

// 2. pnpm version (pnpm sets npm_config_user_agent to "pnpm/<version> ...")
{
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const wanted = String(pkg.packageManager ?? "").replace(/^pnpm@/, "");
  const agent = process.env.npm_config_user_agent ?? "";
  const current = /pnpm\/(\S+)/.exec(agent)?.[1] ?? "unknown";
  record(
    "pnpm",
    current === wanted,
    `pnpm ${current} (pinned ${wanted})`,
    current === "unknown"
      ? "run this through pnpm: pnpm check:setup"
      : `use pnpm ${wanted}: run "corepack enable" or "npm install -g pnpm@${wanted}"`,
  );
}

// 3. Dependencies installed from the current lockfile
{
  const lock = path.join(root, "pnpm-lock.yaml");
  const installed = path.join(root, "node_modules", ".pnpm", "lock.yaml");
  const ok = existsSync(installed) && readFileSync(installed, "utf8") === readFileSync(lock, "utf8");
  record(
    "dependencies",
    ok,
    ok ? "installed from the current lockfile" : "not installed, or out of date with pnpm-lock.yaml",
    "run pnpm install",
  );
}

// 4. Line endings: tracked text files must use LF
{
  const textExt = /\.(ts|tsx|js|mjs|cjs|json|jsonc|ya?ml|md|html|css)$/i;
  const crlf = trackedFiles().filter(
    (f) =>
      textExt.test(f) &&
      existsSync(path.join(root, f)) &&
      readFileSync(path.join(root, f), "utf8").includes("\r\n"),
  );
  record(
    "line endings",
    crlf.length === 0,
    crlf.length === 0
      ? "all text files use LF"
      : `${crlf.length} file(s) use CRLF, e.g. ${crlf.slice(0, 3).join(", ")}`,
    "run pnpm format (Biome rewrites code and JSON with LF); re-save any other listed file with LF line endings in your editor",
  );
}

// 5. Paths that differ only by case break on Linux (CI, Railway) but not on macOS or Windows
{
  const seen = new Map();
  const clashes = [];
  for (const f of trackedFiles()) {
    const key = f.toLowerCase();
    if (seen.has(key) && seen.get(key) !== f) clashes.push(`${seen.get(key)} / ${f}`);
    else seen.set(key, f);
  }
  record(
    "file name case",
    clashes.length === 0,
    clashes.length === 0 ? "no paths differ only by case" : `clashing paths: ${clashes.join("; ")}`,
    "rename one of each pair (git mv) so no two paths differ only by upper/lower case",
  );
}

// 6. Dev ports free (developer machines only)
async function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}
if (!ci) {
  for (const [port, what] of [
    [2567, "game server"],
    [5173, "Vite client"],
  ]) {
    const ok = await portFree(port);
    record(
      `port ${port}`,
      ok,
      ok ? `free for the ${what}` : `in use (needed by the ${what})`,
      `stop whatever is using port ${port} (often an old pnpm dev), then retry`,
    );
  }
}

const failed = results.filter((r) => !r.ok);
if (json) {
  console.log(JSON.stringify({ ok: failed.length === 0, checks: results }, null, 2));
} else {
  for (const r of results) {
    console.log(`${r.ok ? "✔" : "✖"} ${r.name}: ${r.detail}${r.ok ? "" : `\n    fix: ${r.fix}`}`);
  }
  console.log(failed.length === 0 ? "\nSetup OK." : `\n${failed.length} check(s) failed.`);
}
process.exit(failed.length === 0 ? 0 : 1);
