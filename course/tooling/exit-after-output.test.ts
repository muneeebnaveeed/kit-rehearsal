import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// On macOS and Linux, Node writes stdout to a pipe asynchronously, so process.exit() right after a report
// cuts it off. student-report.mjs reads `pr-report.mjs --json` (tens of KB) through a pipe and crashed on the
// truncated JSON. After output, scripts set process.exitCode; process.exit() is only for the usage and
// environment errors that happen before anything is written to stdout.
const dir = fileURLToPath(new URL("./", import.meta.url));
const scripts = [
  ...readdirSync(dir).filter((f) => f.endsWith(".mjs")),
  ...readdirSync(`${dir}lib`)
    .filter((f) => f.endsWith(".mjs"))
    .map((f) => `lib/${f}`),
];

describe("course scripts exit without cutting off stdout", () => {
  it("finds the scripts", () => {
    expect(scripts).toContain("student-report.mjs");
    expect(scripts).toContain("pr-report.mjs");
  });

  for (const file of scripts) {
    it(`${file} calls process.exit() only for usage and environment errors`, () => {
      const code = readFileSync(`${dir}${file}`, "utf8")
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
      const exits = [...code.matchAll(/process\.exit\(([^)]*)\)/g)].map((m) => m[1]?.trim());
      for (const arg of exits) expect(arg).toMatch(/^EXIT\.(usage|environment)$/);
    });
  }
});
