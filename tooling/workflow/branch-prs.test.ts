// Tests for the commands that open PRs between the long-lived branches: `pnpm team:promote`
// (feature/team-N -> main) and `pnpm branches:sync` (main -> feature/team-N). The bodies are built from the real templates and checked with check:pr's rules.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  bodyProblems,
  changesList,
  issueProblems,
  parseMergedPrs,
  promotePr,
  resolveTeam,
  syncAutoMerge,
  syncPr,
} from "./lib/branch-prs.mjs";
import { fillTemplate } from "./lib/pr-body.mjs";
import { fieldsOf } from "./lib/template.mjs";

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
const section = (body: string, heading: string) => fieldsOf(body).find((s) => s.heading === heading)?.body;
const unticked = (body: string) => (section(body, "Checklist") ?? "").match(/- \[ \]/g)?.length ?? 0;

const SEP = "\x1f";
const END = "\x1e";
const log = (...commits: [string, string, string][]) =>
  commits.map(([sha, subject, body]) => `${sha}${SEP}${subject}${SEP}${body}${END}\n`).join("");

describe("resolveTeam", () => {
  it("takes the team number, team-N, --team or the saved kit.team, in that order", () => {
    expect(resolveTeam({ positional: "2" })).toEqual({ team: "team-2" });
    expect(resolveTeam({ positional: "team-3" })).toEqual({ team: "team-3" });
    expect(resolveTeam({ flag: "team-4", configured: "team-1" })).toEqual({ team: "team-4" });
    expect(resolveTeam({ configured: "team-1" })).toEqual({ team: "team-1" });
  });

  it("rejects anything that isn't team 1 to 4, and never guesses", () => {
    expect(resolveTeam({ positional: "5" }).error).toContain("1 to 4");
    expect(resolveTeam({ positional: "platform" }).error).toContain("1 to 4");
    expect(resolveTeam({ configured: "platform" }).error).toContain("pnpm team:promote <N>");
    expect(resolveTeam({}).error).toContain("pnpm team:promote <N>");
  });
});

describe("parseMergedPrs", () => {
  it("reads PR numbers and titles from GitHub's merge commits, newest first, once each", () => {
    const out = log(
      [
        "c9bc1c1",
        "Merge pull request #158 from student/platform/145-e2e-smoke",
        "test(platform): add e2e smoke\n",
      ],
      ["aaaaaaa", "Merge branch 'main' into platform/145-e2e-smoke", ""],
      ["bbbbbbb", "Merge pull request #121 from owner/platform/120-scenarios", ""],
      ["ccccccc", "Merge pull request #158 from student/platform/145-e2e-smoke", "again"],
    );
    expect(parseMergedPrs(out)).toEqual([
      { number: 158, title: "test(platform): add e2e smoke", sha: "c9bc1c1" },
      // No body: fall back to the branch the PR came from.
      { number: 121, title: "platform/120-scenarios", sha: "bbbbbbb" },
    ]);
    expect(parseMergedPrs("")).toEqual([]);
  });

  it("lists them as Markdown, or None", () => {
    expect(changesList([{ number: 158, title: "test(platform): add e2e smoke", sha: "c9bc1c1" }])).toBe(
      "- #158 test(platform): add e2e smoke",
    );
    expect(changesList([])).toBe("None");
  });
});

describe("issueProblems", () => {
  const issue = { number: 122, state: "OPEN", labels: ["platform", "enhancement"] };
  it("accepts an issue with the expected team label", () => {
    expect(issueProblems(issue, { number: 122, label: "platform" })).toEqual([]);
  });
  it("rejects a missing issue, the wrong label, and a closed issue when the PR closes it", () => {
    expect(issueProblems(null, { number: 9, label: "platform" })[0]?.message).toContain("#9 doesn't exist");
    expect(issueProblems(issue, { number: 122, label: "team-2" })[0]?.rule).toBe("issue");
    expect(issueProblems({ ...issue, state: "CLOSED" }, { number: 122, label: "platform" })).toEqual([]);
    expect(
      issueProblems({ ...issue, state: "CLOSED" }, { number: 122, label: "platform", open: true })[0]
        ?.message,
    ).toContain("closed");
  });
});

describe("fillTemplate", () => {
  it("keeps every field in order, drops the comments and fills the given fields", () => {
    const body = fillTemplate(template("sync"), { sections: { Summary: "Hello." } });
    expect(body).not.toContain("<!--");
    expect(fieldsOf(body).map((s) => s.heading)).toEqual(fieldsOf(template("sync")).map((s) => s.heading));
    expect(section(body, "Summary")).toBe("Hello.");
    expect(section(body, "Team")).toBe("platform");
  });

  it("ticks only the checklist items it is told to, with an optional note", () => {
    const body = fillTemplate(template("sync"), {
      sections: {},
      tick: { "The PR refers to an issue with `Refs #N`": "checked by pnpm branches:sync" },
    });
    expect(body).toMatch(
      /^- \[x\] The PR refers to an issue with `Refs #N`.*\(checked by pnpm branches:sync\)$/m,
    );
    expect(unticked(body)).toBe(7);
  });

  it("fails loudly when a section or checklist item no longer exists in the template", () => {
    expect(() => fillTemplate(template("sync"), { sections: { Rollback: "x" } })).toThrow(/Rollback/);
    expect(() => fillTemplate(template("sync"), { sections: {}, tick: { "No such item": true } })).toThrow(
      /No such item/,
    );
  });
});

const prs = [{ number: 158, title: "test(platform): add e2e smoke", sha: "c9bc1c1" }];
const platformIssue = { number: 122, state: "OPEN", labels: ["platform"] };

describe("syncPr", () => {
  it("opens main -> feature/team-N with the sync template and says whether it conflicts", () => {
    const pr = syncPr({ templates, issue: platformIssue, team: "team-2", behind: 4, prs, conflicts: [] });
    expect(pr).toMatchObject({
      type: "sync",
      head: "main",
      base: "feature/team-2",
      title: "chore(platform): bring feature/team-2 up to date with main",
      labels: ["platform"],
    });
    expect(section(pr.body, "Summary")).toContain("4 commit(s) behind");
    expect(section(pr.body, "Summary")).toContain("no conflicts");
    expect(bodyProblems(pr, { config, templates })).toEqual([]);

    const conflicted = syncPr({
      templates,
      issue: platformIssue,
      team: "team-2",
      behind: 4,
      prs,
      conflicts: ["games/team-2/a.ts"],
    });
    expect(section(conflicted.body, "Summary")).toContain("`games/team-2/a.ts`");
    // Its head is main, which nobody may push to.
    expect(section(conflicted.body, "Summary")).toContain("through a team branch");
    expect(bodyProblems(conflicted, { config, templates })).toEqual([]);
  });
});

describe("syncAutoMerge", () => {
  it("auto-merges only a sync known to merge cleanly", () => {
    expect(syncAutoMerge([])).toBe(true);
    expect(syncAutoMerge(["games/team-2/a.ts"])).toBe(false);
    expect(syncAutoMerge(null)).toBe(false);
  });
});

describe("promotePr", () => {
  const issue = { number: 40, state: "OPEN", labels: ["team-2"] };

  it("opens feature/team-N -> main as a chore PR that check:pr accepts, referring to the team's tracking issue", () => {
    const pr = promotePr({ templates, issue, team: "team-2", ahead: 7, behind: 0, prs, conflicts: [] });
    expect(pr).toMatchObject({
      type: "chore",
      head: "feature/team-2",
      base: "main",
      title: "chore(team-2): merge feature/team-2 into main",
      labels: ["team-2"],
    });
    expect(section(pr.body, "Linked issue")).toBe("Refs #40");
    expect(section(pr.body, "Team")).toBe("team-2");
    expect(section(pr.body, "Summary")).toContain("7 commit(s)");
    expect(section(pr.body, "Summary")).toContain("Ships team-2's finished work to production");
    expect(section(pr.body, "Impact")).toContain("deploy to production");
    expect(section(pr.body, "Impact")).toContain("git revert -m 1");
    expect(bodyProblems(pr, { config, templates })).toEqual([]);
  });

  it("says when the feature branch is behind main or would conflict", () => {
    const pr = promotePr({ templates, issue, team: "team-2", ahead: 7, behind: 3, prs, conflicts: ["x.ts"] });
    const summary = section(pr.body, "Summary") ?? "";
    expect(summary).toContain("3 commit(s) behind main");
    expect(summary).toContain("`x.ts`");
  });
});

describe("bodyProblems", () => {
  it("reports what check:pr would reject, other than unticked items", () => {
    const pr = syncPr({ templates, issue: platformIssue, team: "team-2", behind: 1, prs: [], conflicts: [] });
    expect(bodyProblems({ ...pr, base: "main" }, { config, templates }).map((p) => p.rule)).toContain("base");
  });
});
