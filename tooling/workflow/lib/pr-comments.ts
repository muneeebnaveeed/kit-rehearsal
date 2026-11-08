// The rules behind `pnpm pr:comments`: a PR's review threads, reviews and discussion, reduced to what
// still needs the author's attention. No I/O here, so it is tested without GitHub.

export interface Comment {
  author: string;
  body: string;
  url: string;
  createdAt: string;
}

export interface Thread {
  path: string;
  line: number | null;
  resolved: boolean;
  outdated: boolean;
  comments: Comment[];
  /** The last comment is not the PR author's, so the reviewer is waiting for an answer. */
  waitingOnAuthor: boolean;
}

export interface Review {
  author: string;
  state: string;
  body: string;
  url: string;
  submittedAt: string;
}

export interface PrComments {
  number: number;
  title: string;
  url: string;
  author: string;
  threads: Thread[];
  reviews: Review[];
  discussion: Comment[];
  /** GitHub returned only the first page of something: the PR has more than the query reads. */
  truncated: boolean;
}

/** The GraphQL query `pr:comments` sends; `normalize` reads its answer. */
export const QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number title url author { login }
      reviewThreads(first: 100) {
        pageInfo { hasNextPage }
        nodes {
          isResolved isOutdated path line originalLine
          comments(first: 50) { pageInfo { hasNextPage } nodes { author { login } body url createdAt } }
        }
      }
      reviews(first: 100) { pageInfo { hasNextPage } nodes { author { login } state body url submittedAt } }
      comments(first: 100) { pageInfo { hasNextPage } nodes { author { login } body url createdAt } }
    }
  }
}`;

interface RawComment {
  author: { login: string } | null;
  body: string;
  url: string;
  createdAt: string;
}
interface Page<T> {
  pageInfo: { hasNextPage: boolean };
  nodes: T[];
}
export interface RawPullRequest {
  number: number;
  title: string;
  url: string;
  author: { login: string } | null;
  reviewThreads: Page<{
    isResolved: boolean;
    isOutdated: boolean;
    path: string;
    line: number | null;
    originalLine: number | null;
    comments: Page<RawComment>;
  }>;
  reviews: Page<{
    author: { login: string } | null;
    state: string;
    body: string;
    url: string;
    submittedAt: string;
  }>;
  comments: Page<RawComment>;
}

// GitHub shows a deleted account as "ghost".
const login = (a: { login: string } | null) => a?.login ?? "ghost";
const comment = (c: RawComment): Comment => ({
  author: login(c.author),
  body: c.body.trim(),
  url: c.url,
  createdAt: c.createdAt,
});

/** The PR from the GraphQL answer, in plain shapes. Reviews without words or verdict are dropped. */
export function normalize(pr: RawPullRequest): PrComments {
  const author = login(pr.author);
  const threads = pr.reviewThreads.nodes.map((t) => {
    const comments = t.comments.nodes.map(comment);
    return {
      path: t.path,
      line: t.line ?? t.originalLine,
      resolved: t.isResolved,
      outdated: t.isOutdated,
      comments,
      waitingOnAuthor:
        !t.isResolved && comments.length > 0 && comments[comments.length - 1]?.author !== author,
    };
  });
  const reviews = pr.reviews.nodes
    .map((r) => ({
      author: login(r.author),
      state: r.state,
      body: r.body.trim(),
      url: r.url,
      submittedAt: r.submittedAt,
    }))
    // A COMMENTED review with no body is only the wrapper around inline comments, which the threads show.
    .filter((r) => r.body !== "" || r.state === "APPROVED" || r.state === "CHANGES_REQUESTED");
  const truncated =
    pr.reviewThreads.pageInfo.hasNextPage ||
    pr.reviews.pageInfo.hasNextPage ||
    pr.comments.pageInfo.hasNextPage ||
    pr.reviewThreads.nodes.some((t) => t.comments.pageInfo.hasNextPage);
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    author,
    threads,
    reviews,
    discussion: pr.comments.nodes.map(comment),
    truncated,
  };
}

/** The latest review verdict of each reviewer other than the author: who approved, who wants changes. */
export function verdicts(pr: PrComments): Record<string, string> {
  const latest: Record<string, Review> = {};
  for (const r of pr.reviews) {
    if (r.author === pr.author || (r.state !== "APPROVED" && r.state !== "CHANGES_REQUESTED")) continue;
    const seen = latest[r.author];
    if (!seen || r.submittedAt > seen.submittedAt) latest[r.author] = r;
  }
  return Object.fromEntries(Object.entries(latest).map(([who, r]) => [who, r.state]));
}

const quote = (text: string) =>
  text
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
const day = (iso: string) => iso.slice(0, 10);

/**
 * The report: open threads by file (the ones waiting on the author first), then reviews and the
 * discussion. Resolved threads are only counted unless `all` is set.
 */
export function commentsMarkdown(pr: PrComments, { all = false } = {}): string {
  const open = pr.threads.filter((t) => !t.resolved);
  const shown = [...(all ? pr.threads : open)].sort(
    (a, b) =>
      Number(b.waitingOnAuthor) - Number(a.waitingOnAuthor) ||
      a.path.localeCompare(b.path) ||
      (a.line ?? 0) - (b.line ?? 0),
  );
  const waiting = open.filter((t) => t.waitingOnAuthor).length;
  const resolved = pr.threads.length - open.length;
  const v = verdicts(pr);

  const out = [`# Comments on PR #${pr.number}: ${pr.title}`, "", pr.url, ""];
  out.push(
    `${open.length} open review thread(s), ${waiting} waiting on @${pr.author}; ${resolved} resolved${resolved > 0 && !all ? " (not shown; --all shows them)" : ""}.`,
  );
  const verdictList = Object.entries(v).map(
    ([who, state]) => `@${who} ${state === "APPROVED" ? "approved" : "requested changes"}`,
  );
  if (verdictList.length > 0) out.push(`Reviews: ${verdictList.join(", ")}.`);
  if (pr.truncated) out.push("This PR has more comments than one page; open it on GitHub to see the rest.");
  out.push("");

  if (shown.length > 0) {
    out.push("## Review threads", "");
    for (const t of shown) {
      const flags = [
        t.waitingOnAuthor ? "waiting on author" : null,
        t.resolved ? "resolved" : null,
        t.outdated ? "outdated" : null,
      ].filter(Boolean);
      out.push(
        `### ${t.path}${t.line ? `:${t.line}` : ""}${flags.length > 0 ? ` (${flags.join(", ")})` : ""}`,
        "",
      );
      for (const c of t.comments) out.push(`**@${c.author}**, ${day(c.createdAt)}:`, "", quote(c.body), "");
      const last = t.comments[t.comments.length - 1];
      if (last) out.push(`Reply: ${last.url}`, "");
    }
  }

  const reviews = pr.reviews.filter((r) => r.body !== "");
  if (reviews.length > 0) {
    out.push("## Reviews", "");
    for (const r of reviews)
      out.push(
        `**@${r.author}** ${r.state.toLowerCase().replace("_", " ")}, ${day(r.submittedAt)}:`,
        "",
        quote(r.body),
        "",
      );
  }

  if (pr.discussion.length > 0) {
    out.push("## Discussion", "");
    for (const c of pr.discussion) out.push(`**@${c.author}**, ${day(c.createdAt)}:`, "", quote(c.body), "");
  }

  if (shown.length === 0 && reviews.length === 0 && pr.discussion.length === 0)
    out.push("Nothing to answer.");
  return `${out.join("\n").trimEnd()}\n`;
}
