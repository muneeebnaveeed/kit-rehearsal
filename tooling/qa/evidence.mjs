import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const TEST_FILE_PATTERN = /\.(test|spec)\.[cm]?[jt]sx?$/;
function runGit(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

export function resolveBase({ cwd = process.cwd(), git = runGit } = {}) {
  for (const ref of ["upstream/main", "origin/main", "main"]) {
    try {
      git(["rev-parse", "--verify", "--quiet", ref], cwd);
      return ref;
    } catch {
      // Try the next base ref.
    }
  }
  throw new Error(
    "Could not find a comparison base (upstream/main, origin/main, or main). Run git fetch or add an upstream remote, then try again.",
  );
}

export function changedTestFiles({ cwd = process.cwd(), git = runGit } = {}) {
  const base = resolveBase({ cwd, git });
  const mergeBase = git(["merge-base", "HEAD", base], cwd);
  const files = [
    git(["diff", "--name-only", mergeBase, "--"], cwd),
    git(["diff", "--name-only", "--cached", mergeBase, "--"], cwd),
    git(["diff", "--name-only"], cwd),
    git(["ls-files", "--others", "--exclude-standard"], cwd),
  ]
    .flatMap((output) => output.split("\n"))
    .filter((file) => file && TEST_FILE_PATTERN.test(file));
  return { base, files: [...new Set(files)].sort() };
}

async function findJsonFiles(root) {
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await findJsonFiles(path)));
    else if (entry.name.endsWith(".json")) files.push(path);
  }
  return files;
}

function collectValues(value, key, found = new Set()) {
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    for (const item of value) collectValues(item, key, found);
    return found;
  }
  for (const [name, child] of Object.entries(value)) {
    if (name === key && typeof child === "string" && child) found.add(child);
    collectValues(child, key, found);
  }
  return found;
}

export async function collectEvidence({ cwd = process.cwd(), git = runGit } = {}) {
  const { base, files: changedTests } = changedTestFiles({ cwd, git });
  const artifactPaths = [resolve(cwd, ".qa", "qa-runs.json")].filter(existsSync);
  const replayPaths = (await findJsonFiles(resolve(cwd, "replays"))).sort();
  const artifacts = [];
  for (const path of [...artifactPaths, ...replayPaths]) {
    const data = JSON.parse(await readFile(path, "utf8"));
    artifacts.push({ path: path.slice(cwd.length + 1), data, modifiedAt: (await stat(path)).mtimeMs });
  }
  const scenarios = new Set();
  const replayIds = new Set();
  for (const artifact of artifacts) {
    for (const value of collectValues(artifact.data, "scenario")) scenarios.add(value);
    for (const key of ["replayId", "roomId"]) {
      for (const value of collectValues(artifact.data, key)) replayIds.add(value);
    }
  }
  const testResultsPath = resolve(cwd, ".qa", "last-test.json");
  const testResults = existsSync(testResultsPath)
    ? JSON.parse(await readFile(testResultsPath, "utf8"))
    : null;
  const testSummary = testResults
    ? { passed: testResults.numPassedTests ?? 0, failed: testResults.numFailedTests ?? 0 }
    : null;
  return {
    base,
    assertedBy: changedTests,
    lastTestResults: testSummary,
    scenarios: [...scenarios].sort(),
    replayIds: [...replayIds].sort(),
  };
}

export function formatEvidence(evidence) {
  return [
    `Compared against ${evidence.base}`,
    "Asserted by:",
    ...(evidence.assertedBy.length ? evidence.assertedBy.map((file) => `- ${file}`) : ["- None"]),
    "",
    `Last test results: ${
      evidence.lastTestResults === null
        ? "None recorded. Create it with pnpm test --reporter=json --outputFile=.qa/last-test.json"
        : `${evidence.lastTestResults.passed} passed, ${evidence.lastTestResults.failed} failed`
    }`,
    `Scenarios run: ${evidence.scenarios.length ? evidence.scenarios.join(", ") : "None recorded"}`,
    `Replay ids: ${evidence.replayIds.length ? evidence.replayIds.join(", ") : "None recorded"}`,
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const evidence = await collectEvidence();
    if (process.argv.includes("--json")) console.log(JSON.stringify(evidence, null, 2));
    else console.log(formatEvidence(evidence));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
