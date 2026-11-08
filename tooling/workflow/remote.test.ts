// Tests for the git plumbing in lib/remote.mjs that has to work in a CI checkout as well as a clone.
// actions/checkout clones one commit deep, so comparisons like origin/feature/team-N..origin/main are
// wrong there until the history is fetched.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchArgs } from "./lib/remote.mjs";

describe("fetchArgs", () => {
  it("fetches each branch into its origin/ ref", () => {
    expect(fetchArgs(["main", "feature/team-2"], { shallow: false })).toEqual([
      "fetch",
      "--quiet",
      "origin",
      "+refs/heads/main:refs/remotes/origin/main",
      "+refs/heads/feature/team-2:refs/remotes/origin/feature/team-2",
    ]);
  });

  it("fetches the full history in a shallow clone, so commit counts and merge bases are right", () => {
    expect(fetchArgs(["main"], { shallow: true })).toEqual([
      "fetch",
      "--quiet",
      "--unshallow",
      "origin",
      "+refs/heads/main:refs/remotes/origin/main",
    ]);
  });
});

describe("fetchArgs in a shallow clone like actions/checkout makes", () => {
  let dir = "";
  const git = (cwd: string, args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "kit-shallow-"));
    const origin = path.join(dir, "origin");
    git(dir, ["init", "--quiet", "--initial-branch=main", origin]);
    const commit = (name: string) => {
      writeFileSync(path.join(origin, name), name);
      git(origin, ["add", name]);
      git(origin, ["commit", "--quiet", "-m", name]);
    };
    commit("a");
    git(origin, ["branch", "feature/team-1"]);
    commit("b");
    commit("c");
    // file:// so --depth is honoured; a plain path makes a local clone with the whole history.
    git(dir, ["clone", "--quiet", "--depth", "1", "--branch", "main", `file://${origin}`, "ci"]);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("counts the commits a feature branch is behind once fetched", () => {
    const ci = path.join(dir, "ci");
    expect(git(ci, ["rev-parse", "--is-shallow-repository"])).toBe("true");
    git(ci, fetchArgs(["main", "feature/team-1"], { shallow: true }));
    expect(git(ci, ["rev-parse", "--is-shallow-repository"])).toBe("false");
    expect(git(ci, ["rev-list", "--count", "origin/feature/team-1..origin/main"])).toBe("2");
    expect(git(ci, ["merge-base", "origin/feature/team-1", "origin/main"])).toBe(
      git(ci, ["rev-parse", "origin/feature/team-1"]),
    );
  });

  it("sees no changes of a feature branch's own after a sync, so team:promote skips it", () => {
    const origin = path.join(dir, "origin");
    git(origin, ["checkout", "--quiet", "feature/team-1"]);
    git(origin, ["merge", "--quiet", "--no-ff", "-m", "sync", "main"]);
    git(origin, ["checkout", "--quiet", "main"]);
    writeFileSync(path.join(origin, "d"), "d");
    git(origin, ["add", "d"]);
    git(origin, ["commit", "--quiet", "-m", "d"]);
    expect(git(origin, ["rev-list", "--count", "main..feature/team-1"])).toBe("1");
    expect(git(origin, ["diff", "--name-only", "main...feature/team-1"])).toBe("");
  });
});
