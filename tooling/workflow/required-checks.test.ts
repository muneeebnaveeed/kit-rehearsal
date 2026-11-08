// REQUIRED_CHECKS, the CI job names and the rulesets must name the same checks, or a ruleset waits
// for a check that never runs.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REQUIRED_CHECKS } from "./lib/required-checks.mjs";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("REQUIRED_CHECKS", () => {
  it("are exactly the ci.yml job names", () => {
    const jobNames = [...read(".github/workflows/ci.yml").matchAll(/^ {4}name: "?(.+?)"?$/gm)].map(
      (m) => m[1],
    );
    expect(jobNames).toEqual(REQUIRED_CHECKS);
  });

  it.each([".github/rulesets/main.json", ".github/rulesets/feature.json"])(
    "%s requires them, the instructor gate and the template check",
    (ruleset) => {
      const rules = JSON.parse(read(ruleset)).rules as {
        type: string;
        parameters?: { required_status_checks?: { context: string }[] };
      }[];
      const contexts =
        rules
          .find((r) => r.type === "required_status_checks")
          ?.parameters?.required_status_checks?.map((c) => c.context) ?? [];
      const own = ["instructor gate", "pull request follows the template"];
      expect(contexts.filter((c) => !own.includes(c))).toEqual(REQUIRED_CHECKS);
      expect(contexts).toEqual(expect.arrayContaining(own));
    },
  );

  it("only names checks a workflow job really has", () => {
    expect(read(".github/workflows/instructor-gate.yml")).toMatch(/^ {4}name: instructor gate$/m);
    expect(read(".github/workflows/workflow-checks.yml")).toMatch(
      /^ {4}name: pull request follows the template$/m,
    );
  });
});
