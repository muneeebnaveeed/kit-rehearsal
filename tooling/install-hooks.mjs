// Runs on every `pnpm install` (the "prepare" script): points git at the repository's hooks in .githooks/,
// so commits and pushes are checked for everyone, people and coding agents alike, without anyone having
// to remember to install anything. Never fails the install: outside a git checkout (a Railway build), in
// CI, or when you already use your own hooks path, it only says what it did.
// Plain JavaScript with no dependencies, like check-node.mjs.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { HOOKS_PATH, hooksPathAction } from "./workflow/lib/hooks.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

try {
  let isGitCheckout = false;
  try {
    isGitCheckout = git("rev-parse", "--is-inside-work-tree") === "true";
  } catch {}
  let current = null;
  if (isGitCheckout) {
    try {
      current = git("config", "--get", "core.hooksPath") || null;
    } catch {
      // Exit code 1: not set.
    }
  }

  switch (hooksPathAction({ isGitCheckout, current, ci: Boolean(process.env.CI) })) {
    case "set":
      git("config", "core.hooksPath", HOOKS_PATH);
      console.log(
        "git hooks: on. Commits get their issue reference and are checked; pushes run the quick checks.",
      );
      break;
    case "foreign":
      console.warn(
        `git hooks: not switched on, because core.hooksPath is already "${current}". To use the repo's hooks: git config core.hooksPath ${HOOKS_PATH}`,
      );
      break;
    default:
      break;
  }
} catch (err) {
  console.warn(
    `git hooks: could not switch them on (${err.message}). Run: git config core.hooksPath ${HOOKS_PATH}`,
  );
}
