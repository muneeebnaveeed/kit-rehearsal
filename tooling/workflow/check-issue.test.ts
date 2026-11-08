import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkIssue } from "./lib/check-issue.mjs";
import { explainsCrossTeam } from "./lib/check-ownership.mjs";
import { fieldLabelsOf, fieldsOf } from "./lib/template.mjs";

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
  feature: `**Goal**: Players can log in.\n**What changes**:\n- Add a login page\n**Done when**:\n- [ ] Login works\n`,
  bug: `**Goal**: The player crashes.\n**Steps to reproduce**:\n1. Start the game\n**Expected behaviour**: It runs.\n**Actual behaviour**: It crashes.\n**What changes**: Unknown yet\n**Done when**:\n- [ ] No crash\n`,
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
  it.each(Object.keys(templates))("%s has the common fields", (type) => {
    const labels = fieldLabelsOf(template(type));
    expect(labels).toContain("Goal");
    expect(labels).toContain("What changes");
    expect(labels).toContain("Done when");
  });

  it.each(Object.keys(templates))("%s uses fields, one per line, and no headings", (type) => {
    const md = template(type);
    expect(md).not.toMatch(/^##\s/m);
    const fieldLines = md.split("\n").filter((l) => /^\*\*.+?\*\*:/.test(l));
    expect(fieldLines).toHaveLength(fieldLabelsOf(md).length);
    expect(md.slice(md.indexOf("**"))).not.toMatch(/\n\s*\n/);
  });

  it.each(Object.keys(templates))("%s keeps a guidance comment on every field", (type) => {
    for (const line of template(type)
      .split("\n")
      .filter((l) => /^\*\*.+?\*\*:/.test(l)))
      expect(line).toMatch(/^\*\*.+?\*\*: <!-- .+ -->$/);
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

  it("detects the bug template from its own fields and accepts it", () => {
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

  it("reports a missing field", () => {
    const r = check({ body: valid.feature.replace("**What changes**:\n- Add a login page\n", "") });
    expect(r.problems).toContainEqual({ rule: "heading", message: 'Missing field "**What changes**".' });
  });

  it("reports an empty field", () => {
    const r = check({ body: valid.feature.replace("Players can log in.", "<!-- later -->") });
    expect(r.problems.map((p: { rule: string }) => p.rule)).toContain("empty");
  });

  it("reports a field left as its bare list marker", () => {
    const body = valid.bug.replace("1. Start the game", "1.");
    expect(check({ body, labels: ["team-2"] }).problems).toContainEqual({
      rule: "empty",
      message: 'Field "**Steps to reproduce**" is empty. Fill it in, or write "None" if it does not apply.',
    });
  });

  it("accepts None as the content of a field", () => {
    expect(check({ body: valid.bug.replace("Unknown yet", "None"), labels: ["team-2"] }).ok).toBe(true);
  });

  it('needs a real "Done when" checkbox', () => {
    const r = check({ body: valid.feature.replace("- [ ] Login works", "- [ ]") });
    expect(r.problems.map((p: { rule: string }) => p.rule)).toContain("done-when");
  });

  it("reports fields in the wrong order", () => {
    const body = "**Done when**:\n- [ ] Login works\n**Goal**: x\n**What changes**: y\n";
    expect(check({ body }).problems.map((p: { rule: string }) => p.rule)).toContain("order");
  });

  it("rejects a body that mixes the fields of two templates", () => {
    const body = `${valid.bug}**Pages affected**:\n- README.md\n`;
    expect(check({ body, labels: ["team-2"] }).problems.map((p: { rule: string }) => p.rule)).toContain(
      "template",
    );
  });

  it("an explicit type is checked against that template", () => {
    const r = check({ type: "bug" });
    expect(r.ok).toBe(false);
    expect(r.problems.filter((p: { rule: string }) => p.rule === "heading").length).toBeGreaterThan(0);
  });

  it("ignores fields inside code fences and HTML comments", () => {
    const body = `${valid.feature}<!-- **Fake**: x -->\n\`\`\`\n**Also fake**: y\n\`\`\`\n`;
    expect(fieldsOf(body).map((s) => s.heading)).toEqual(["Goal", "What changes", "Done when"]);
  });

  it("no longer reads an issue written with ## headings", () => {
    const body = "## Goal\n\nPlayers can log in.\n\n## What changes\n\n- x\n\n## Done when\n\n- [ ] y\n";
    expect(check({ body }).problems.map((p: { rule: string }) => p.rule)).toContain("heading");
  });

  it("still finds a Cross-team line, as plain text in a field or as a field of its own", () => {
    const inField = valid.feature.replace(
      "- Add a login page",
      "- Add a login page\nCross-team: needs the shared fixture",
    );
    expect(explainsCrossTeam(inField)).toBe(true);
    expect(check({ body: inField }).ok).toBe(true);
    const ownField = valid.feature.replace(
      "**Done when**",
      "**Cross-team**: needs the shared fixture\n**Done when**",
    );
    expect(explainsCrossTeam(ownField)).toBe(true);
    expect(check({ body: ownField }).ok).toBe(true);
  });
});
