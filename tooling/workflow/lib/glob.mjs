// Minimal glob matching for repo-relative paths: "**" matches any number of folders, "*" matches
// within one path segment. Enough for ownership.json and types.json, with no dependencies.

const cache = new Map();

/** @param {string} pattern */
export function globToRegExp(pattern) {
  let re = cache.get(pattern);
  if (re) return re;
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        // "**/" matches zero or more folders; a trailing "**" matches everything below.
        if (pattern[i + 2] === "/") {
          source += "(?:.*/)?";
          i += 2;
        } else {
          source += ".*";
          i += 1;
        }
      } else {
        source += "[^/]*";
      }
    } else if (/[.+^${}()|[\]\\?]/.test(c)) {
      source += `\\${c}`;
    } else {
      source += c;
    }
  }
  re = new RegExp(`^${source}$`);
  cache.set(pattern, re);
  return re;
}

/**
 * @param {string} file repo-relative path with forward slashes
 * @param {string[]} patterns
 */
export function matchesAny(file, patterns) {
  return patterns.some((p) => globToRegExp(p).test(file));
}
