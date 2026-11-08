import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkPr, detectPrType } from "./lib/check-pr.mjs";
import { fieldLabelsOf } from "./lib/template.mjs";

const root = new URL("../../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, root), "utf8");
const config = JSON.parse(read("tooling/workflow/types.json"));

// The real templates, so a template change is covered by these tests.
const templates = Object.fromEntries(
  Object.entries(config.types as Record<string, { prTemplate: string | null }>)
    .filter(([, t]) => t.prTemplate)
    .map(([name, t]) => [name, read(t.prTemplate as string)]),
);

const template = (type: string) => {
  const md = templates[type];
  if (md === undefined) throw new Error(`no ${type} template`);
  return md;
};

/** Fills a template: replaces placeholders, ticks every box and gives every empty field content. */
function fill(type: string, over: { linked?: string; team?: string } = {}) {
  let md = template(type).replace(/<!--[\s\S]*?-->/g, "");
  md = md.replace(
    /^\*\*Linked issue\*\*:.*$/m,
    `**Linked issue**: ${over.linked ?? (type === "sync" ? "Refs #33" : "Closes #12")}`,
  );
  md = md.replace(/^\*\*Team\*\*:.*$/m, `**Team**: ${over.team ?? "team-2"}`);
  md = md.replace(/- \[ \]/g, "- [x]");
  return md
    .replace(/^\*\*How to test\*\*:[ \t]*$/m, "**How to test**: pnpm test")
    .replace(/^\*\*Pages affected\*\*:[ \t]*$/m, "**Pages affected**: README.md")
    .replace(/^(\*\*(?!Checklist\*)[^*]+\*\*):[ \t]*$/gm, "$1: None");
}

// The Conventional-Commit type each template's title starts with.
const TITLE_TYPE: Record<string, string> = {
  feature: "feat",
  bug: "fix",
  docs: "docs",
  chore: "chore",
  refactor: "refactor",
};

const work = {
  title: "feat(team-2): add login",
  head: "team-2/12-add-login",
  base: "feature/team-2",
  labels: ["team-2"],
};
const check = (over: Record<string, unknown> = {}, body = fill("feature")) =>
  checkPr({ ...work, body, config, templates, ...over });
const rules = (r: { problems: { rule: string }[] }) => r.problems.map((p) => p.rule);

describe("every PR template", () => {
  it.each(Object.keys(templates))("%s keeps the six required fields", (type) => {
    const headings = fieldLabelsOf(templates[type]);
    for (const h of ["Linked issue", "Team", "Summary", "How to test", "Screenshots", "Checklist"]) {
      expect(headings).toContain(h);
    }
  });

  it.each(["feature", "bug", "docs", "chore", "refactor"])("a filled %s template passes", (type) => {
    const r = check({ title: `${TITLE_TYPE[type]}(team-2): add login` }, fill(type));
    expect(r.problems).toEqual([]);
    expect(r.type).toBe(type);
  });

  it.each(["feature", "bug", "docs", "chore", "refactor", "sync"])(
    "%s is rejected while unfilled",
    (type) => {
      const base = type === "sync" ? "feature/team-2" : work.base;
      const head = type === "sync" ? "main" : work.head;
      expect(checkPr({ ...work, head, base, body: template(type), config, templates }).ok).toBe(false);
    },
  );
});

describe("work PRs", () => {
  it("accepts a correct PR", () => {
    expect(check()).toMatchObject({ ok: true, type: "feature" });
  });

  it("detects the bug template from its own field", () => {
    expect(check({ title: "fix(team-2): stop the login loop" }, fill("bug"))).toMatchObject({
      ok: true,
      type: "bug",
    });
  });

  it("uses Conventional Commits for the title, with the team label as the scope", () => {
    expect(check({ title: "feat(team-2): add login" }).problems).toEqual([]);
    expect(check({ title: "feat(team-2)!: drop the old login" }).problems).toEqual([]);
  });

  it("rejects an issue-style [label] title and titles without a valid scope", () => {
    expect(check({ title: "[team-2] Add login" }).problems[0]?.message).toContain("type(scope): description");
    expect(rules(check({ title: "add login" }))).toContain("title");
    expect(check({ title: "feat: add login" }).problems[0]?.message).toContain("team label as its scope");
    expect(check({ title: "feat(frontend): add login" }).problems[0]?.message).toContain("not a team label");
  });

  it("applies the commit subject rules to the title", () => {
    const message = (title: string) =>
      check({ title })
        .problems.map((p) => p.message)
        .join(" ");
    expect(message("feat(team-2): Add login")).toContain("lowercase");
    expect(message("feat(team-2): added login")).toContain("imperative");
    expect(message("feat(team-2): add login.")).toContain("period");
    expect(message(`feat(team-2): add ${"x".repeat(70)}`)).toContain("72 or fewer");
    expect(message("wip(team-2): add login")).toContain('Unknown type "wip"');
  });

  it("needs a title type that matches the template", () => {
    expect(check({ title: "fix(team-2): add login" }).problems[0]?.message).toContain(
      "feature PR's title starts with feat",
    );
    expect(rules(check({ title: "feat(team-2): stop the loop" }, fill("bug")))).toEqual(["title"]);
    expect(check({ title: "chore(team-2): bump deps" }, fill("chore")).problems).toEqual([]);
    expect(check({ title: "ci(team-2): cache pnpm" }, fill("chore")).problems).toEqual([]);
  });

  it("needs exactly one team label, matching the title", () => {
    expect(rules(check({ labels: [] }))).toContain("labels");
    expect(rules(check({ labels: ["team-1", "team-2"] }))).toContain("labels");
    expect(check({ labels: ["team-1"] }).problems[0]?.message).toContain("team label is team-1");
  });

  it("rejects a badly named branch and a branch label that differs from the title", () => {
    expect(rules(check({ head: "my-fix" }))).toContain("branch");
    expect(check({ head: "team-1/12-add-login" }).problems[0]?.message).toContain(
      "differs from the title's scope",
    );
  });

  it("rejects the wrong base branch", () => {
    const r = check({ base: "main" });
    expect(r.problems[0]).toMatchObject({ rule: "base" });
    expect(r.problems[0]?.message).toContain("feature/team-2");
  });

  it("platform work targets main", () => {
    const r = check(
      { title: "feat(platform): add ci checks", head: "platform/8-ci", base: "main", labels: ["platform"] },
      fill("feature", { team: "platform" }),
    );
    expect(r.problems).toEqual([]);
  });

  it("a feature branch targets main", () => {
    expect(check({ head: "feature/team-2", base: "main" }).problems).toEqual([]);
  });

  it("lets a promotion refer to its team's tracking issue with Refs #N, unlike a work PR", () => {
    expect(
      rules(check({ head: "feature/team-2", base: "main" }, fill("feature", { linked: "Refs #12" }))),
    ).not.toContain("linked-issue");
  });

  it('needs "Closes #N", not a bare placeholder or Refs', () => {
    expect(rules(check({}, fill("feature", { linked: "Closes #" })))).toContain("linked-issue");
    expect(rules(check({}, fill("feature", { linked: "Refs #12" })))).toContain("linked-issue");
  });

  it("rejects a Team field that is a placeholder or differs from the title", () => {
    expect(rules(check({}, fill("feature", { team: "team-" })))).toContain("team");
    expect(check({}, fill("feature", { team: "team-1" })).problems[0]?.message).toContain(
      "the title's scope is team-2",
    );
  });

  it("reports an unticked checklist item", () => {
    const body = fill("feature").replace("- [x] I tested", "- [ ] I tested");
    expect(rules(check({}, body))).toEqual(["checklist"]);
  });

  it("accepts notes after a checklist item", () => {
    const body = fill("feature").replace(
      '- [x] I tested the change as described under "How to test"',
      '- [x] I tested the change as described under "How to test" (CI is green)',
    );
    expect(check({}, body).ok).toBe(true);
  });

  it("reports a missing and an empty field", () => {
    const body = fill("feature")
      .replace(/^\*\*Screenshots\*\*:.*\n/m, "")
      .replace("pnpm test", "");
    expect(rules(check({}, body))).toEqual(expect.arrayContaining(["heading", "empty"]));
  });

  it("rejects a work PR that uses the sync template", () => {
    expect(rules(check({}, fill("sync")))).toContain("template");
  });

  it("rejects a body that mixes two templates", () => {
    const body = `${fill("bug")}\n**Pages affected**: README.md\n`;
    expect(rules(check({}, body))).toContain("template");
  });

  it("warns, but does not fail, when the classifier disagrees with the template", () => {
    const r = check({ classification: { undecided: false, type: "chore", rule: "commit-prefix" } });
    expect(r.ok).toBe(true);
    expect(r.warnings[0]).toContain('classify this as "chore"');
  });
});

describe("PRs from main", () => {
  const sync = {
    title: "chore(platform): bring feature/team-1 up to date with main",
    head: "main",
    base: "feature/team-1",
    labels: ["platform"],
  };
  const run = (pr: typeof sync, type: string, body = fill(type, { team: "platform" })) =>
    checkPr({ ...pr, body, config, templates });

  it("accepts a filled sync, with Refs #N", () => {
    expect(run(sync, "sync")).toMatchObject({ ok: true, type: "sync", problems: [] });
  });

  it("main into any other branch is rejected, prod included: main deploys to production itself", () => {
    for (const base of ["main", "prod"]) {
      expect(
        rules(checkPr({ ...sync, base, body: fill("sync", { team: "platform" }), config, templates })),
      ).toContain("base");
    }
  });
});

describe("detectPrType", () => {
  it("finds the sync template from its own field", () => {
    expect(detectPrType(fill("sync"), templates).candidates).toEqual(["sync"]);
  });

  it("finds nothing in a plain feature body", () => {
    expect(detectPrType(fill("feature"), templates).candidates).toEqual([]);
  });
});
