// Reading from and writing to GitHub with the GitHub CLI, shared by the course tooling scripts.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXIT } from "../../../tooling/workflow/lib/args.mjs";

/** Prints a clear message and exits with the "environment problem" code. */
function fail(message) {
  console.error(message);
  process.exit(EXIT.environment);
}

/**
 * Runs a GraphQL query with the GitHub CLI.
 * @param {string} root working directory (the repo root)
 * @param {string} query
 * @param {Record<string, string | number | null>} variables
 */
export function graphql(root, query, variables) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [k, v] of Object.entries(variables)) if (v !== null) args.push("-F", `${k}=${v}`);
  try {
    return JSON.parse(execFileSync("gh", args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 })).data;
  } catch (err) {
    return fail(
      `error: could not read from GitHub with the GitHub CLI (installed and logged in with "gh auth login"?): ${err.stderr?.toString().trim() || err.message}`,
    );
  }
}

/** Reads every page of a connection. `pick` returns the connection from a query result. */
export function paginate(root, query, variables, pick) {
  const nodes = [];
  let cursor = null;
  do {
    const conn = pick(graphql(root, query, { ...variables, cursor }));
    nodes.push(...conn.nodes);
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (cursor);
  return nodes;
}

/** The "owner/name" of the repository the working directory belongs to. */
export function currentRepo(root) {
  try {
    return execFileSync("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  } catch (err) {
    return fail(`error: could not find the repository (pass --repo owner/name): ${err.message}`);
  }
}

/**
 * Edits a pull request or issue: title, body, added labels and (PRs only) the base branch.
 * @param {string} root
 * @param {string} repo "owner/name"
 * @param {"pr" | "issue"} kind
 * @param {number} number
 * @param {{ title?: string, body?: string, addLabels?: string[], base?: string }} changes
 * @param {string} tmp a directory for the body file
 */
export function applyChanges(root, repo, kind, number, changes, tmp) {
  if (Object.keys(changes).length === 0) return;
  const args = [kind, "edit", String(number), "--repo", repo];
  if (changes.title) args.push("--title", changes.title);
  if (changes.body !== undefined) {
    const file = join(tmp, `${kind}-${number}.md`);
    writeFileSync(file, changes.body);
    args.push("--body-file", file);
  }
  for (const l of changes.addLabels ?? []) args.push("--add-label", l);
  if (changes.base && kind === "pr") args.push("--base", changes.base);
  execFileSync("gh", args, { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
}

/**
 * Posts a comment, or updates the one this tool left before so it is never repeated.
 * @param {string} root
 * @param {string} repo
 * @param {"pr" | "issue"} kind
 * @param {number} number
 * @param {{ databaseId: number } | null | undefined} existing the earlier comment, if any
 * @param {string} body
 * @param {string} tmp
 */
export function upsertComment(root, repo, kind, number, existing, body, tmp) {
  const file = join(tmp, `${kind}-${number}-comment.md`);
  writeFileSync(file, body);
  const args = existing
    ? ["api", "-X", "PATCH", `repos/${repo}/issues/comments/${existing.databaseId}`, "-F", `body=@${file}`]
    : [kind, "comment", String(number), "--repo", repo, "--body-file", file];
  execFileSync("gh", args, { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
}

/** A temporary directory for body files; call the returned function to remove it. */
export function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "course-fix-"));
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Hides a comment as outdated (GitHub's "minimize"): it stays, and anyone can expand it.
 * @param {string} root
 * @param {string} nodeId the comment's GraphQL node id
 */
export function hideAsOutdated(root, nodeId) {
  execFileSync(
    "gh",
    [
      "api",
      "graphql",
      "-f",
      "query=mutation($id: ID!) { minimizeComment(input: { subjectId: $id, classifier: OUTDATED }) { minimizedComment { isMinimized } } }",
      "-f",
      `id=${nodeId}`,
    ],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] },
  );
}
