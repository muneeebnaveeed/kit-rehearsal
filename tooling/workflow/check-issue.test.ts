import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkIssue } from "./lib/check-issue.mjs";
import { headingsOf, sectionsOf } from "./lib/template.mjs";

const root = new URL("../../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, root), "utf8");
const config = JSON.parse(read("tooling/workflow/types.json"));

// The real templates, so a template change is covered by these tests.
const templates = Object.fromEntries(
  Object.entries(config.types as Record<string, { issueTemplate: string | null }>)
    .filter(([, t]) => t.issueTemplate)
    .map(([name, t]) => [name, read(t.issueTemplate as string)]),
);

const template = (type: string) => {
  const md = templates[type];
  if (md === undefined) throw new Error(`no ${type} template`);
  return md;
};

const valid = {
  feature: `## Goal\n\nPlayers can log in.\n\n## What changes\n\n- Add a login page\n\n## Done when\n\n- [ ] Login works\n`,
  bug: `## Goal\n\nThe player crashes.\n\n## Steps to reproduce\n\n1. Start the game\n\n## Expected behaviour\n\nIt runs.\n\n## Actual behaviour\n\nIt crashes.\n\n## What changes\n\nUnknown yet\n\n## Done when\n\n- [ ] No crash\n`,
};

const check = (over: Record<string, unknown>) =>
  checkIssue({
    title: "Add login",
    body: valid.feature,
    labels: ["team-2"],
    config,
    templates,
    ...over,
  });

describe("every issue template", () => {
  it.each(Object.keys(templates))("%s has the common sections", (type) => {
    const headings = headingsOf(templates[type]);
    expect(headings).toContain("Goal");
    expect(headings).toContain("What changes");
    expect(headings).toContain("Done when");
  });

  it.each(Object.keys(templates))("%s is rejected while unfilled", (type) => {
    const r = checkIssue({ title: "x", body: template(type), type, config, templates });
    expect(r.ok).toBe(false);
  });
});

describe("checkIssue", () => {
  it("accepts a filled feature issue", () => {
    expect(check({})).toMatchObject({ ok: true, type: "feature" });
  });

  it("detects the bug template from its own headings and accepts it", () => {
    expect(check({ body: valid.bug, labels: ["team-2"] })).toMatchObject({ ok: true, type: "bug" });
  });

  it("rejects a title with a [label] prefix", () => {
    const r = check({ title: "[team-2] Add login" });
    expect(r.problems).toEqual([
      { rule: "title", message: 'Drop "[team-2]" from the title: the team label already names the team.' },
    ]);
  });

  it("rejects any leading prefix, not only a team label", () => {
    expect(check({ title: "[frontend] Add login" }).problems[0]?.message).toContain('Drop "[frontend]"');
  });

  it("rejects an empty title", () => {
    expect(check({ title: "  " }).problems).toContainEqual({ rule: "title", message: "The title is empty." });
  });

  it("needs exactly one team label", () => {
    expect(check({ labels: ["stackpile"] }).ok).toBe(false);
    expect(check({ labels: ["team-1", "team-2"] }).ok).toBe(false);
  });

  it("accepts any single team label, since the title no longer names one", () => {
    expect(check({ labels: ["team-1"] }).ok).toBe(true);
  });

  it("reports a missing section", () => {
    const r = check({ body: valid.feature.replace("## What changes\n\n- Add a login page\n\n", "") });
    expect(r.problems).toContainEqual({ rule: "heading", message: 'Missing section "## What changes".' });
  });

  it("reports an empty section", () => {
    const r = check({ body: valid.feature.replace("Players can log in.", "<!-- later -->") });
    expect(r.problems.map((p: { rule: string }) => p.rule)).toContain("empty");
  });

  it("accepts None as the content of a section", () => {
    expect(check({ body: valid.bug.replace("Unknown yet", "None"), labels: ["team-2"] }).ok).toBe(true);
  });

  it('needs a real "Done when" checkbox', () => {
    const r = check({ body: valid.feature.replace("- [ ] Login works", "- [ ]") });
    expect(r.problems.map((p: { rule: string }) => p.rule)).toContain("done-when");
  });

  it("reports sections in the wrong order", () => {
    const body = "## Done when\n\n- [ ] Login works\n\n## Goal\n\nx\n\n## What changes\n\ny\n";
    expect(check({ body }).problems.map((p: { rule: string }) => p.rule)).toContain("order");
  });

  it("rejects a body that mixes the headings of two templates", () => {
    const body = `${valid.bug}\n## Pages affected\n\n- README.md\n`;
    expect(check({ body, labels: ["team-2"] }).problems.map((p: { rule: string }) => p.rule)).toContain(
      "template",
    );
  });

  it("an explicit type is checked against that template", () => {
    const r = check({ type: "bug" });
    expect(r.ok).toBe(false);
    expect(r.problems.filter((p: { rule: string }) => p.rule === "heading").length).toBeGreaterThan(0);
  });

  it("ignores headings inside code fences and HTML comments", () => {
    const body = `${valid.feature}\n<!-- ## Fake -->\n\n\`\`\`\n## Also fake\n\`\`\`\n`;
    expect(sectionsOf(body).map((s) => s.heading)).toEqual(["Goal", "What changes", "Done when"]);
  });
});
