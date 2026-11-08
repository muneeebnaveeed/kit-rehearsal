const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

const PAGE = (title: string, body: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 34rem; margin: 3rem auto; padding: 0 1rem; color: #1b1b1f; background: #fafafa; }
  @media (prefers-color-scheme: dark) { body { color: #ececf1; background: #17171a; } a { color: #8ab4ff; } }
  h1 { font-size: 1.4rem; } li { margin: .35rem 0; } .soon { opacity: .6; }
</style>
</head>
<body>
${body}
</body>
</html>
`;

/** The landing page: one link per released game, and the planned ones marked as not released yet. */
export function indexPage(games: readonly string[], planned: readonly string[]): string {
  const released = games.map((g) => `<li><a href="/${escapeHtml(g)}/">${escapeHtml(g)}</a></li>`).join("\n");
  const soon = planned.map((g) => `<li class="soon">${escapeHtml(g)}: not released yet</li>`).join("\n");
  return PAGE("Games", `<h1>Games</h1>\n<ul>\n${released}\n${soon}\n</ul>`);
}

export function notFoundPage(game: string | undefined, games: readonly string[]): string {
  const what = game
    ? `There is no game called <code>${escapeHtml(game)}</code>.`
    : "There is nothing at this address.";
  return PAGE(
    "Not found",
    `<h1>Not found</h1>\n<p>${what}</p>\n<p><a href="/">See the games</a> (${games.length} released).</p>`,
  );
}

export function unavailablePage(game: string): string {
  return PAGE(
    "Game unavailable",
    `<h1>${escapeHtml(game)} is not reachable</h1>\n<p>The game is starting, restarting or has stopped. Try again in a minute.</p>\n<p><a href="/">See the games</a></p>`,
  );
}
