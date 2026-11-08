// Tests for `pnpm pr:open` (lib/pr-open.mjs). The bodies it builds are run through checkPr with the
// real templates, so pr:open and check:pr can't drift apart.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkPr } from "./lib/check-pr.mjs";
import {
  buildPrBody,
  CHECKLIST_FACTS,
  defaultSections,
  planPrOpen,
  preflightFacts,
  prTitle,
  sectionFlag,
  tickChecklist,
} from "./lib/pr-open.mjs";

const root = new URL("../../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, root), "utf8");
const config = JSON.parse(read("tooling/workflow/types.json"));
const templates: Record<string, string> = Object.fromEntries(
  Object.entries(config.types as Record<string, { prTemplate: string | null }>)
    .filter(([, t]) => t.prTemplate)
    .map(([name, t]) => [name, read(t.prTemplate as string)]),
);

const template = (type: string) => {
  const md = templates[type];
  if (md === undefined) throw new Error(`no ${type} template`);
  return md;
};
const teamLabels: string[] = config.teamLabels;
const rules = (r: { problems: { rule: string }[] }) => r.problems.map((p) => p.rule);
const allFacts = Object.fromEntries(Object.values(CHECKLIST_FACTS).map(([, fact]) => [fact, true]));

const issue = {
  number: 14,
  title: "Add login page",
  state: "OPEN",
  labels: ["team-2"],
  assignees: [],
};

describe("planPrOpen", () => {
  const plan = (over: Record<string, unknown> = {}) =>
    planPrOpen({
      branch: "team-2/14-add-login-page",
      team: "team-2",
      teamLabels,
      issue,
      existingPr: null,
      ...over,
    });

  it("targets the team's branch", () => {
    expect(plan()).toMatchObject({ ok: true, base: "feature/team-2", number: 14, label: "team-2" });
    expect(
      plan({
        branch: "platform/9-ci",
        team: "platform",
        issue: { ...issue, number: 9, labels: ["platform"] },
      }),
    ).toMatchObject({ ok: true, base: "main" });
    expect(
      plan({
        branch: "team-instructor/3-rules",
        team: "team-instructor",
        issue: { ...issue, number: 3, labels: ["team-instructor"] },
      }),
    ).toMatchObject({ ok: true, base: "main" });
  });

  it("refuses a branch that isn't a work branch", () => {
    expect(rules(plan({ branch: "main" }))).toEqual(["branch"]);
    expect(rules(plan({ branch: "feature/team-2" }))).toEqual(["branch"]);
    expect(rules(plan({ branch: "login-page" }))).toEqual(["branch"]);
  });

  it("refuses another team's branch and says --team overrides it", () => {
    const r = plan({ team: "team-3" });
    expect(rules(r)).toContain("team");
    expect(r.problems.find((p) => p.rule === "team")?.fix).toMatch(/--team team-2/);
  });

  it("refuses another team's issue label, even on your own branch", () => {
    expect(rules(plan({ issue: { ...issue, labels: ["team-3"] } }))).toEqual(["label"]);
    expect(rules(plan({ issue: { ...issue, labels: [] } }))).toEqual(["label"]);
  });

  it("refuses a missing or closed issue and an existing PR", () => {
    expect(rules(plan({ issue: null }))).toEqual(["issue"]);
    expect(rules(plan({ issue: { ...issue, state: "CLOSED" } }))).toEqual(["issue"]);
    expect(rules(plan({ existingPr: "https://github.com/o/r/pull/3" }))).toEqual(["exists"]);
  });
});

describe("prTitle", () => {
  const precedence: string[] = config.prefixPrecedence;

  it("uses the issue title, with the commit type and the team as scope", () => {
    expect(
      prTitle({
        commitType: "feat",
        team: "team-2",
        issueTitle: "[team-2] Add login page.",
        subjects: [],
        precedence,
      }),
    ).toBe("feat(team-2): add login page");
  });

  it("falls back to the strongest commit subject when the issue title doesn't fit", () => {
    expect(
      prTitle({
        commitType: "feat",
        team: "platform",
        issueTitle: "[platform] Add workflow commands: issue:start, pr:open, sync, release and more",
        subjects: ["docs(platform): document it", "feat(platform): add issue:start"],
        precedence,
      }),
    ).toBe("feat(platform): add issue:start");
  });

  it("returns null when nothing makes a valid title", () => {
    expect(
      prTitle({
        commitType: "fix",
        team: "team-1",
        issueTitle: "[team-1] Fixed it",
        subjects: ["Fixed it"],
        precedence,
      }),
    ).toBeNull();
  });
});

describe("tickChecklist", () => {
  const lines = (type: string) =>
    template(type)
      .replace(/<!--[\s\S]*?-->/g, "")
      .split("\n")
      .filter((l) => l.startsWith("- [ ]"));

  it("knows every item in every work template", () => {
    for (const type of ["feature", "bug", "docs", "chore", "refactor"]) {
      expect(tickChecklist(lines(type), allFacts).unticked).toEqual([]);
    }
  });

  it("leaves an item open when its fact wasn't verified", () => {
    const r = tickChecklist(lines("feature"), { ...allFacts, upToDate: false, tested: false });
    expect(r.unticked).toHaveLength(2);
    expect(r.lines.filter((l) => l.startsWith("- [ ]"))).toHaveLength(2);
    expect(r.unticked.join("\n")).toMatch(/up to date/);
  });

  it("never ticks an item it doesn't recognise", () => {
    const r = tickChecklist(["- [ ] The game is fun"], allFacts);
    expect(r.lines).toEqual(["- [ ] The game is fun"]);
    expect(r.unticked).toEqual(["The game is fun"]);
  });
});

describe("preflightFacts", () => {
  const step = (name: string, ok = true, warnings: string[] = []) => ({ name, ok, warnings });
  const steps = [step("ownership"), step("commits"), step("files"), step("secrets")];

  it("turns passing preflight steps into checklist facts", () => {
    expect(preflightFacts(steps)).toEqual({ ownership: true, commits: true, files: true });
  });

  it("does not vouch for cross-team changes, a missing step or a failed one", () => {
    expect(preflightFacts([step("ownership", true, ["warning: x"]), ...steps.slice(1)]).ownership).toBe(
      false,
    );
    expect(preflightFacts(steps.filter((s) => s.name !== "commits")).commits).toBe(false);
    expect(preflightFacts([...steps.slice(0, 3), step("secrets", false)]).files).toBe(false);
  });
});

describe("sectionFlag", () => {
  it("turns a heading into its option name", () => {
    expect(sectionFlag("Root cause")).toBe("root-cause");
    expect(sectionFlag("Behaviour unchanged")).toBe("behaviour-unchanged");
    expect(sectionFlag("How to test")).toBe("how-to-test");
  });
});

describe("defaultSections", () => {
  const input = { files: ["games/team-2/shared/login.ts"] };

  it("fills how to test and screenshots, but never the summary: only a person knows why", () => {
    const s = defaultSections(input);
    expect(s.Summary).toBeUndefined();
    expect(s["Root cause"]).toBeUndefined();
    expect(s["How to test"]).toMatch(/pnpm preflight/);
    expect(s.Screenshots).toBe("None, no client files changed.");
  });

  it("leaves screenshots to you when client files changed", () => {
    expect(defaultSections({ ...input, files: ["games/team-2/client/main.ts"] }).Screenshots).toBeUndefined();
    expect(defaultSections({ ...input, files: ["games/team-2/index.html"] }).Screenshots).toBeUndefined();
  });

  it("lists the pages a docs PR changes", () => {
    expect(defaultSections({ ...input, files: ["README.md", "games/team-2/x.ts"] })["Pages affected"]).toBe(
      "- `README.md`",
    );
  });
});

describe("buildPrBody", () => {
  const sections = (type: string) => ({
    ...defaultSections({ files: ["docs/x.md"] }),
    "Linked issue": "Closes #14",
    Summary: "Players could not keep their progress between sessions; logging in fixes that.",
    Team: "team-2",
    "Root cause": "The form had no submit handler.",
    Impact: "None",
    "Behaviour unchanged": "The login flow.",
    _type: type,
  });
  const titleType: Record<string, string> = {
    feature: "feat",
    bug: "fix",
    docs: "docs",
    chore: "chore",
    refactor: "refactor",
  };

  it.each(["feature", "bug", "docs", "chore", "refactor"])(
    "a fully verified %s body passes check:pr",
    (type) => {
      const { body, missing, unticked } = buildPrBody({
        template: template(type),
        sections: sections(type),
        facts: allFacts,
      });
      expect(missing).toEqual([]);
      expect(unticked).toEqual([]);
      const r = checkPr({
        title: `${titleType[type]}(team-2): add login`,
        body,
        head: "team-2/14-add-login-page",
        base: "feature/team-2",
        labels: ["team-2"],
        config,
        templates,
      });
      expect(r.problems).toEqual([]);
      expect(r.type).toBe(type);
    },
  );

  it("leaves sections it can't fill empty, so check:pr refuses the draft", () => {
    const { body, missing } = buildPrBody({
      template: template("bug"),
      sections: {
        "Linked issue": "Closes #14",
        Team: "team-2",
        Summary: "x",
        "How to test": "y",
        Screenshots: "None, nothing visible changed",
      },
      facts: allFacts,
    });
    expect(missing).toEqual(["Root cause"]);
    const r = checkPr({
      title: "fix(team-2): fix login",
      body,
      head: "team-2/14-x",
      base: "feature/team-2",
      config,
      templates,
    });
    expect(rules(r)).toEqual(["empty"]);
  });

  it("an unverified fact leaves its box open, so check:pr refuses the draft", () => {
    const { body } = buildPrBody({
      template: template("feature"),
      sections: sections("feature"),
      facts: { ...allFacts, tested: false },
    });
    const r = checkPr({
      title: "feat(team-2): add login",
      body,
      head: "team-2/14-x",
      base: "feature/team-2",
      config,
      templates,
    });
    expect(rules(r)).toEqual(["checklist"]);
  });

  it("drops the template's comments and keeps every field in order", () => {
    const { body } = buildPrBody({
      template: template("feature"),
      sections: sections("feature"),
      facts: allFacts,
    });
    expect(body).not.toMatch(/<!--/);
    expect(body).not.toMatch(/\n\s*\n/);
    expect([...body.matchAll(/^\*\*(.+?)\*\*:/gm)].map((m) => m[1])).toEqual([
      "Linked issue",
      "Team",
      "Summary",
      "How to test",
      "Screenshots",
      "Checklist",
    ]);
  });
});
