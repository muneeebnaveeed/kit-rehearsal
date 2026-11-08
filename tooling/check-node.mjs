// Checks that the developer's own `node` matches the version pinned in .nvmrc.
// Runs before `pnpm install` (root "preinstall" script) and as part of `pnpm check:setup`.
// Plain JavaScript with no dependencies, so it works before anything is installed, on every OS.
// (pnpm's engine-strict is not enough: a standalone pnpm checks its own bundled Node instead.)
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

/** @returns {{ ok: boolean, current: string, wanted: string, fix: string }} */
export function checkNode() {
  const nvmrc = fileURLToPath(new URL("../.nvmrc", import.meta.url));
  const wanted = readFileSync(nvmrc, "utf8").trim().replace(/^v/, "");
  const current = process.versions.node;

  const parse = (v) => v.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const [wMajor, wMinor, wPatch] = parse(wanted);
  const [cMajor, cMinor, cPatch] = parse(current);
  const ok = cMajor === wMajor && (cMinor > wMinor || (cMinor === wMinor && cPatch >= wPatch));

  const fix = `install Node ${wanted} (any ${wMajor}.x from ${wanted} up): nvm/fnm users run "nvm install" or "fnm use --install-if-missing"; otherwise download it from https://nodejs.org/en/download`;
  return { ok, current, wanted, fix };
}

// Run directly (preinstall): print a clear error and stop the install.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = checkNode();
  if (!result.ok) {
    console.error(`
  ✖ Wrong Node.js version: you have ${result.current}, this repo needs ${result.wanted}.

  Fix: ${result.fix}.
  Then run pnpm install again.
`);
    process.exit(1);
  }
}
