import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMMENT_MARKER, fixTitle, planFix, rawSections } from "./lib/pr-fix.mjs";

const root = new URL("../../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, root), "utf8");
const config = JSON.parse(read("tooling/workflow/types.json"));
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

/** A feature PR body that follows the template, every box ticked. */
function goodBody(linked = "Closes #12") {
  return template("feature")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\*\*Linked issue\*\*:.*$/m, `**Linked issue**: ${linked}`)
    .replace(/^\*\*Team\*\*:.*$/m, "**Team**: team-2")
    .replace(/- \[ \]/g, "- [x]")
    .replace(/^\*\*How to test\*\*:[ \t]*$/m, "**How to test**: pnpm test")
    .replace(/^(\*\*(?!Checklist\*)[^*]+\*\*):[ \t]*$/gm, "$1: None");
}

const base = {
  number: 40,
  title: "feat(team-2): add login",
  body: goodBody(),
  head: "team-2/12-add-login",
  base: "feature/team-2",
  labels: ["team-2"],
  state: "OPEN",
  author: "someone",
};
const commits = [{ message: "feat(team-2): add login\n\nRefs #12" }];
const issues = new Map([
  [12, { number: 12, labels: ["team-2"] }],
  [13, { number: 13, labels: ["platform"] }],
]);
const plan = (over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  planFix({ pr: { ...base, ...over }, commits, issues, config, templates, ...extra });

/** Applies a plan's changes to the PR, the way GitHub would. */
function applied(pr: typeof base, p: ReturnType<typeof plan>) {
  const c = p.changes as { title?: string; body?: string; addLabels?: string[]; base?: string };
  return {
    ...pr,
    title: c.title ?? pr.title,
    body: c.body ?? pr.body,
    base: c.base ?? pr.base,
    labels: [...pr.labels, ...(c.addLabels ?? [])],
  };
}

describe("rawSections", () => {
  it("keeps comments and ignores headings in code fences and comments", () => {
    const { preamble, sections } = rawSections(
      "intro\n## A\n<!--\n## not\n-->\ntext\n```\n## code\n```\n## B\nb",
    );
    expect(preamble).toBe("intro");
    expect(sections.map((s) => s.heading)).toEqual(["A", "B"]);
    expect(sections[0]?.text).toContain("## not");
  });
});

describe("fixTitle", () => {
  const t = (title: string) => fixTitle({ pr: { title }, team: "team-2", commits });

  it("leaves a correct conventional title alone", () => {
    expect(t("feat(team-2): add login")).toBeNull();
  });
  it("puts the team label in the scope of a conventional title", () => {
    expect(t("feat: add login")).toBe("feat(team-2): add login");
    expect(t("fix(game)!: drop x")).toBe("fix(team-2)!: drop x");
  });
  it("makes any other title conventional with the type its commits agree on", () => {
    expect(t("[team-2] Add login.")).toBe("feat(team-2): add login");
    expect(t("Add login")).toBe("feat(team-2): add login");
    expect(
      fixTitle({
        pr: { title: "Add login" },
        team: "team-2",
        commits: [{ message: "feat(team-2): a" }, { message: "fix(team-2): b" }],
      }),
    ).toBeNull();
  });
  it("does nothing without a team", () => {
    expect(fixTitle({ pr: { title: "Add login" }, team: null, commits })).toBeNull();
  });
});

describe("planFix on open PRs", () => {
  it("changes nothing and comments nothing on a PR that follows the rules", () => {
    const p = plan();
    expect(p.changes).toEqual({});
    expect(p.comment).toBeNull();
  });

  it("adds the team label from the title", () => {
    const p = plan({ labels: [] });
    expect(p.changes).toEqual({ addLabels: ["team-2"] });
    expect(p.remaining).toEqual([]);
    expect(p.comment).toContain(COMMENT_MARKER);
  });

  it("restructures a free-form description without losing text, and links the issue from the branch", () => {
    const body =
      "## Summary\n- add the login form\n\n## Test plan\n- [x] pnpm test passes\n\nClosing notes here.";
    const p = plan({ body });
    const out = (p.changes as { body: string }).body;
    for (const h of ["Linked issue", "Team", "Summary", "How to test", "Screenshots", "Checklist"])
      expect(out).toMatch(new RegExp(`^\\*\\*${h}\\*\\*:`, "m"));
    expect(out).not.toMatch(/^## /m);
    expect(out).toContain("**Linked issue**: Closes #12");
    expect(out).toContain("**Team**: team-2");
    expect(out).toContain("add the login form");
    expect(out).toMatch(/\*\*How to test\*\*:\n- \[x\] pnpm test passes/);
    expect(out).toContain("Closing notes here.");
    // Checklist items are added, never ticked; screenshots are left to the author.
    expect(out).not.toMatch(/\*\*Checklist\*\*:[\s\S]*- \[x\] The PR closes/);
    expect(p.remaining.map((r) => r.rule)).toEqual(expect.arrayContaining(["empty", "checklist"]));
  });

  it("keeps the Generated-with footer at the end", () => {
    const p = plan({
      body: "## Summary\nx\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)",
    });
    expect((p.changes as { body: string }).body.trimEnd()).toMatch(/Generated with \[Claude Code\].*\)$/);
  });

  it("retargets an open PR to the right base branch, but not a stacked one", () => {
    expect(plan({ base: "main" }).changes).toEqual({ base: "feature/team-2" });
    const stacked = plan({ base: "team-2/11-other" });
    expect(stacked.changes).toEqual({});
    expect(stacked.comment).toContain("stacked on `team-2/11-other`");
  });

  it("changes nothing on a second run", () => {
    const pr = { ...base, labels: [], body: "## Summary\nx", title: "feat: add login", base: "main" };
    const first = planFix({ pr, commits, issues, config, templates });
    expect(Object.keys(first.changes).sort()).toEqual(["addLabels", "base", "body", "title"]);
    const second = planFix({ pr: applied(pr, first), commits, issues, config, templates });
    expect(second.changes).toEqual({});
    expect(second.comment).toBe(first.comment?.replace(/Fixed automatically:[\s\S]*?\n\n/, ""));
  });

  it("treats CRLF line endings as no change", () => {
    const pr = { ...base, labels: [], body: "## Summary\nx", title: "feat: add login", base: "main" };
    const first = planFix({ pr, commits, issues, config, templates });
    const crlf = applied(pr, first);
    crlf.body = crlf.body.replace(/\n/g, "\r\n");
    expect(planFix({ pr: crlf, commits, issues, config, templates }).changes).toEqual({});
  });
});

describe("planFix on merged and closed PRs", () => {
  it("only adds the linked issue and the team, and keeps the rest of the description", () => {
    const body = "## Summary\nbuilt the thing\n\n## Checklist\n- [x] old item";
    const p = plan({
      state: "MERGED",
      body,
      head: "platform/13-client-core",
      base: "main",
      labels: ["platform"],
      title: "feat(platform): add core",
    });
    const out = (p.changes as { body: string }).body;
    expect(out.indexOf("**Linked issue**")).toBeLessThan(out.indexOf("**Team**"));
    expect(out).toContain("**Linked issue**: Closes #13");
    expect(out).toContain("**Team**: platform");
    expect(out).toContain("## Summary\nbuilt the thing\n\n## Checklist\n- [x] old item");
  });

  it("adds no checklist items or empty fields", () => {
    const body = goodBody().replace(/- \[x\] The branch is up to date[^\n]*\n/, "");
    const p = plan({ state: "MERGED", body });
    expect(p.changes).toEqual({});
  });

  it("inserts a missing Team field right after an existing Linked issue field", () => {
    const body = "**Linked issue**: Closes #12\n\n**Summary**: x";
    const out = (plan({ state: "MERGED", body }).changes as { body: string }).body;
    expect(out).toBe("**Linked issue**: Closes #12\n\n**Team**: team-2\n\n**Summary**: x");
  });

  it("reads a body written with headings, and adds the Team after its Linked issue", () => {
    const body = "## Linked issue\n\nCloses #12\n\n## Summary\nx";
    const out = (plan({ state: "MERGED", body }).changes as { body: string }).body;
    expect(out).toMatch(/## Linked issue\n\nCloses #12\n\n\*\*Team\*\*: team-2\n\n## Summary/);
  });

  it("never comments, even when something was changed", () => {
    const changed = plan({ state: "MERGED", body: "## Summary\nx", labels: ["team-2"] });
    expect(changed.changes).not.toEqual({});
    expect(changed.comment).toBeNull();
    const closed = plan({ state: "CLOSED", body: "## Summary\nx" });
    expect(closed.comment).toBeNull();
    const untouched = plan({
      state: "MERGED",
      body: goodBody().replace("**Screenshots**: None", "**Screenshots**:"),
    });
    expect(untouched.changes).toEqual({});
    expect(untouched.comment).toBeNull();
  });
});

describe("planFix comment", () => {
  it("lists the remaining problems in the comment on an open PR", () => {
    const body = goodBody().replace("- [x] I tested", "- [ ] I tested");
    const p = plan({ body });
    expect(p.remaining.map((r) => r.rule)).toEqual(["checklist"]);
    expect(p.comment).toContain("checklist");
  });
});

describe("planFix with an earlier comment", () => {
  it("updates the comment of an open PR that now passes to say nothing is left", () => {
    const p = planFix({ pr: base, commits, issues, config, templates, hadComment: true });
    expect(p.changes).toEqual({});
    expect(p.comment).toContain("Nothing left to do");
  });

  it("leaves an earlier comment on a merged PR alone", () => {
    const p = planFix({
      pr: { ...base, state: "MERGED" },
      commits,
      issues,
      config,
      templates,
      hadComment: true,
    });
    expect(p.comment).toBeNull();
  });
});
