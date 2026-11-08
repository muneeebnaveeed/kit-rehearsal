import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { globToRegExp } from "./lib/glob.mjs";
import { baseFor, branchLabel, classifyChange, parsePrefix, strongestSubject } from "./lib/rules.mjs";

const config = {
  teamLabels: ["team-1", "team-2", "team-3", "team-4", "platform", "team-instructor"],
  types: {
    feature: { commitTypes: ["feat"] },
    bug: { commitTypes: ["fix"] },
    docs: { commitTypes: ["docs"] },
    chore: { commitTypes: ["chore", "ci", "build", "test", "perf"] },
    refactor: { commitTypes: ["refactor"] },
  },
  commitPrefixToType: {
    feat: "feature",
    fix: "bug",
    docs: "docs",
    refactor: "refactor",
    chore: "chore",
    ci: "chore",
    build: "chore",
    test: "chore",
    perf: "chore",
  },
  prefixPrecedence: ["feat", "fix", "refactor", "perf", "docs", "test", "build", "ci", "chore"],
  docsPaths: ["course/**", "**/*.md", "docs/**"],
  choreRules: [
    { commitType: "ci", paths: [".github/**"] },
    { commitType: "build", paths: ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"] },
    { commitType: "chore", paths: [".claude/**", ".vscode/**", "biome.json", "tooling/**"] },
  ],
  testPaths: ["**/*.test.ts", "e2e/**"],
  codePaths: ["**/*.ts", "**/*.tsx", "**/*.mjs", "**/*.css", "**/*.html"],
};

const ownership = [
  { path: "games/team-1/**", owner: "team-1" },
  { path: "games/team-2/**", owner: "team-2" },
  { path: "course/**", owner: "team-instructor" },
  { path: "server/**", owner: "platform" },
  { path: ".github/**", owner: "platform" },
  { path: "package.json", owner: "platform" },
  { path: "pnpm-lock.yaml", owner: "shared" },
  { path: "**", owner: "shared" },
];

const files = (...specs: string[]) =>
  specs.map((s) => {
    const [status, path] = s.includes(":") ? s.split(":") : ["M", s];
    return { status, path };
  });

const classify = (over: Record<string, unknown>) =>
  classifyChange({ files: [], config, ownership, kind: "issue", branch: null, ...over } as never) as Record<
    string,
    unknown
  >;

describe("classifyChange: type rules", () => {
  it("docs-only: every file is documentation", () => {
    const r = classify({ files: files("README.md", "course/README.md", "games/team-1/README.md") });
    expect(r).toMatchObject({ type: "docs", commitType: "docs", rule: "docs-only" });
  });

  it("tooling-only: scripts, CI and config", () => {
    const r = classify({ files: files("tooling/workflow/x.mjs", "biome.json") });
    expect(r).toMatchObject({ type: "chore", commitType: "chore", rule: "tooling-only" });
  });

  it("tooling-only: a CI workflow change is commit type ci", () => {
    const r = classify({ files: files(".github/workflows/ci.yml", ".github/README.md") });
    expect(r).toMatchObject({ type: "chore", commitType: "ci" });
  });

  it("tooling-only: dependency files are commit type build", () => {
    const r = classify({ files: files("package.json", "pnpm-lock.yaml") });
    expect(r).toMatchObject({ type: "chore", commitType: "build" });
  });

  it("tooling plus docs is still a chore", () => {
    const r = classify({ files: files("tooling/a.mjs", "CLAUDE.md") });
    expect(r).toMatchObject({ type: "chore", rule: "tooling-only" });
  });

  it("tests-only: commit type test", () => {
    const r = classify({ files: files("games/team-1/src/a.test.ts", "games/team-1/README.md") });
    expect(r).toMatchObject({ type: "chore", commitType: "test", rule: "tests-only" });
  });

  it("new-code: an added source file is a feature", () => {
    const r = classify({ files: files("A:games/team-2/src/room.ts", "M:games/team-2/src/main.ts") });
    expect(r).toMatchObject({ type: "feature", commitType: "feat", rule: "new-code", label: "team-2" });
  });

  it("an added file outside the code paths does not make a feature", () => {
    const r = classify({ files: files("A:games/team-2/data/levels.json", "M:games/team-2/src/main.ts") });
    expect(r).toMatchObject({ undecided: true });
  });

  it("undecided: only modified code files never guess bug vs refactor", () => {
    const r = classify({ files: files("games/team-1/src/a.ts") });
    expect(r).toMatchObject({ ok: false, undecided: true, candidates: ["feature", "bug", "refactor"] });
    expect((r.errors as string[])[0]).toContain("--type");
  });

  it("undecided: no files and no hint", () => {
    const r = classify({ files: [] });
    expect(r).toMatchObject({ ok: false, undecided: true });
  });
});

describe("classifyChange: explicit decisions", () => {
  it("--type wins over the files", () => {
    const r = classify({ files: files("games/team-1/src/a.ts"), type: "bug" });
    expect(r).toMatchObject({ type: "bug", commitType: "fix", rule: "explicit-type" });
  });

  it("a Conventional-Commit prefix in the title decides", () => {
    const r = classify({ files: files("games/team-1/src/a.ts"), hint: "fix(team-1): stop the crash" });
    expect(r).toMatchObject({ type: "bug", commitType: "fix", rule: "commit-prefix" });
  });

  it("the prefix is found behind a [label] title prefix", () => {
    const r = classify({ files: files("games/team-1/src/a.ts"), hint: "[team-1] refactor: split room" });
    expect(r).toMatchObject({ type: "refactor", commitType: "refactor" });
  });

  it("ci/build/test prefixes are chores and keep their commit type", () => {
    const r = classify({ files: files("games/team-1/src/a.ts"), hint: "test: cover room" });
    expect(r).toMatchObject({ type: "chore", commitType: "test" });
  });

  const mainPr = { files: files("games/team-1/src/a.ts"), kind: "pr", branch: "main", label: "platform" };

  it("a PR from main into feature/team-N is a sync", () => {
    const r = classify({ ...mainPr, target: "feature/team-1" });
    expect(r).toMatchObject({ type: "sync", base: "feature/team-1" });
  });

  it("a PR from main is always a sync; check:pr rejects any base but a feature branch", () => {
    expect(classify(mainPr)).toMatchObject({ type: "sync", rule: "main-branch" });
  });
});

describe("classifyChange: team label", () => {
  it("comes from the branch prefix first", () => {
    const r = classify({ files: files("A:tooling/x.mjs"), branch: "platform/41-workflow" });
    expect(r).toMatchObject({ label: "platform", labelSource: "branch" });
  });

  it("comes from the single owner of the files when the branch has no label", () => {
    const r = classify({ files: files("A:games/team-2/src/a.ts"), branch: "my-branch" });
    expect(r).toMatchObject({ label: "team-2", labelSource: "files" });
  });

  it("fails when the files belong to several owners and nothing names one", () => {
    const r = classify({
      files: files("A:games/team-1/src/a.ts", "A:games/team-2/src/a.ts"),
      branch: "my-branch",
    });
    expect(r).toMatchObject({ ok: false });
    expect((r.errors as string[])[0]).toContain("team-1, team-2");
  });

  it("warns when the branch label differs from the owner of some files", () => {
    const r = classify({
      files: files("A:games/team-1/src/a.ts", "M:games/team-2/src/b.ts"),
      branch: "team-1/9-x",
    });
    expect(r.ok).toBe(true);
    expect((r.warnings as string[])[0]).toContain("team-2");
  });

  it("explicit label wins", () => {
    const r = classify({ files: files("A:games/team-1/src/a.ts"), branch: "team-1/9-x", label: "platform" });
    expect(r).toMatchObject({ label: "platform", labelSource: "explicit" });
  });

  it("is the commit scope", () => {
    const r = classify({ files: files("A:games/team-3/src/a.ts"), branch: "team-3/9-x" });
    expect(r.scope).toBe("team-3");
  });
});

describe("branches", () => {
  const labels = config.teamLabels;
  it.each([
    ["team-2/14-login", "feature/team-2"],
    ["platform/8-ci", "main"],
    ["team-instructor/20-rules", "main"],
    ["feature/team-3", "main"],
    ["random-branch", null],
  ])("a PR from %s targets %s", (branch, base) => {
    expect(baseFor(branch, labels)).toBe(base);
  });

  it("a PR from main targets whatever --target says", () => {
    expect(baseFor("main", labels, "feature/team-2")).toBe("feature/team-2");
    expect(baseFor("main", labels)).toBeNull();
  });

  it("reads the team label from a branch name", () => {
    expect(branchLabel("team-4/3-x", labels)).toBe("team-4");
    expect(branchLabel("feature/team-4", labels)).toBeNull();
  });
});

describe("parsePrefix", () => {
  it.each([
    ["feat: add x", { prefix: "feat", scope: null }],
    ["fix(team-2): stop it", { prefix: "fix", scope: "team-2" }],
    ["[platform] chore!: drop node 20", { prefix: "chore", scope: null }],
    ["Add login page", null],
    ["Fix: capitalised is not a prefix", null],
  ])("%s", (text, expected) => {
    expect(parsePrefix(text)).toEqual(expected);
  });
});

describe("strongestSubject", () => {
  const { prefixPrecedence } = config;

  it("types.json ranks every commit type, with feat first", () => {
    const real = JSON.parse(readFileSync(new URL("./types.json", import.meta.url), "utf8"));
    expect([...real.prefixPrecedence].sort()).toEqual(Object.keys(real.commitPrefixToType).sort());
    expect(real.prefixPrecedence[0]).toBe("feat");
  });

  it("picks the most significant prefix on the branch, whatever the commit order", () => {
    const feature = ["docs(platform): document checks", "feat(platform): add checks", "fix(platform): typo"];
    expect(strongestSubject(feature, prefixPrecedence)).toBe("feat(platform): add checks");
    expect(strongestSubject([...feature].reverse(), prefixPrecedence)).toBe("feat(platform): add checks");
    expect(strongestSubject(["docs: a", "fix: b", "refactor: c"], prefixPrecedence)).toBe("fix: b");
  });

  it("keeps a docs-only branch as docs", () => {
    expect(strongestSubject(["docs: a", "docs(team-2): b"], prefixPrecedence)).toBe("docs: a");
  });

  it("ignores subjects without a known prefix, and returns null when none has one", () => {
    expect(strongestSubject(["Add game", "wip: try", "chore: bump"], prefixPrecedence)).toBe("chore: bump");
    expect(strongestSubject(["Add game", "Update readme"], prefixPrecedence)).toBeNull();
    expect(strongestSubject([], prefixPrecedence)).toBeNull();
  });

  it("feeds classifyChange, so a feature branch ending in a docs commit is a feature", () => {
    const hint = strongestSubject(["feat(platform): add x", "docs(platform): document x"], prefixPrecedence);
    const result = classifyChange({
      files: [
        { status: "A", path: "tooling/workflow/x.mjs" },
        { status: "M", path: "server/CLAUDE.md" },
      ],
      config,
      ownership,
      kind: "pr",
      hint,
      branch: "platform/72-x",
    });
    expect(result).toMatchObject({ type: "feature", rule: "commit-prefix" });
  });
});

describe("globToRegExp", () => {
  it.each([
    ["games/team-1/**", "games/team-1/src/a.ts", true],
    ["games/team-1/**", "games/team-2/src/a.ts", false],
    ["**/*.md", "README.md", true],
    ["**/*.md", "a/b/c.md", true],
    ["**/*.test.ts", "a/b/c.test.ts", true],
    ["*.json", "a/b.json", false],
    ["package.json", "package.json", true],
    ["package.json", "apackage.json", false],
  ])("%s matches %s: %s", (pattern, file, expected) => {
    expect(globToRegExp(pattern).test(file)).toBe(expected);
  });
});
