// Every relative link and heading anchor in the repo's Markdown files points somewhere real.
// Pure apart from the `fs` functions the caller passes, so tests can use a temporary folder.

/** GitHub's heading anchor: lower case, formatting and punctuation dropped, spaces to hyphens. @param {string} heading */
export function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{L}\p{N}\- ]/gu, "")
    .replace(/ /g, "-");
}

const withoutFences = (md) => md.replace(/```[\s\S]*?```/g, "");

/** @param {string} markdown */
export function headingSlugs(markdown) {
  return new Set(
    [...withoutFences(markdown).matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)].map((m) => slugify(m[1])),
  );
}

/** Link targets outside code blocks and inline code: [text](target). @param {string} markdown */
export function extractLinks(markdown) {
  const text = withoutFences(markdown).replace(/`[^`\n]*`/g, "");
  return [...text.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((m) => m[1]);
}

/**
 * @param {string[]} files repo-relative Markdown paths
 * @param {{ read: (rel: string) => string, exists: (rel: string) => boolean, isFile: (rel: string) => boolean }} fs
 */
export function checkDocs(files, fs) {
  /** @type {import("./report.mjs").Problem[]} */
  const problems = [];
  for (const file of files) {
    const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
    for (const target of extractLinks(fs.read(file))) {
      if (/^(https?:|mailto:|tel:)/.test(target)) continue;
      const [rawPath, anchor] = target.split("#");
      const resolved =
        rawPath === "" ? file : normalize(dir ? `${dir}/${decodeURI(rawPath)}` : decodeURI(rawPath));
      if (!fs.exists(resolved)) {
        problems.push({
          rule: "link",
          file,
          message: `Broken link: ${target}`,
          fix: "Fix the path or remove the link.",
        });
        continue;
      }
      if (
        anchor &&
        resolved.endsWith(".md") &&
        fs.isFile(resolved) &&
        !headingSlugs(fs.read(resolved)).has(anchor)
      ) {
        problems.push({
          rule: "anchor",
          file,
          message: `Broken anchor: ${target}`,
          fix: "Point it at an existing heading.",
        });
      }
    }
  }
  return problems;
}

/** Resolves "." and ".." in a forward-slash path. @param {string} p */
function normalize(p) {
  const out = [];
  for (const part of p.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}
