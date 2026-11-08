import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { git } from "./lib/git.mjs";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "kit-git-"));
  const run = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  run("init", "-q", "-b", "main");
  run("config", "user.email", "t@example.com");
  run("config", "user.name", "Test");
  // 2 MB of text: more than Node's default 1 MB maxBuffer for execFileSync.
  writeFileSync(path.join(dir, "big.txt"), `${"x".repeat(1023)}\n`.repeat(2048));
  run("add", "-A");
  run("commit", "-q", "--no-verify", "-m", "big");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("git()", () => {
  it("returns output larger than 1 MB, as the diff of a big sync PR is", () => {
    const out = git(dir, ["show", "HEAD:big.txt"]);
    expect(out.length).toBe(2048 * 1024);
  });
});
