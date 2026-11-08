// Simulation code must be deterministic so replays reproduce exactly (see server/CLAUDE.md): no
// Math.random() and no wall-clock reads. Simulation code is each game's room/ and shared/ folders and
// the server core. A line can opt out with a trailing "// determinism-ok: <reason>".

const SIMULATION_PATHS = [
  /^server\/core\/src\/(server|shared)\//,
  /^server\/template\/(room|shared)\//,
  /^games\/team-\d+\/(room|shared)\//,
];

/** @type {[RegExp, string][]} */
const FORBIDDEN = [
  [/\bMath\.random\s*\(/, "Math.random(): use the room's SeededRandom."],
  [/\bDate\.now\s*\(/, "Date.now(): advance by fixed ticks instead of reading the clock."],
  [/\bperformance\.now\s*\(/, "performance.now(): advance by fixed ticks instead of reading the clock."],
  [/\bnew Date\s*\(\s*\)/, "new Date(): pass the time in from outside the simulation."],
];

/** @param {string} file */
export const isSimulationFile = (file) =>
  /\.(ts|js|mjs)$/.test(file) && !/\.test\.[tj]s$/.test(file) && SIMULATION_PATHS.some((re) => re.test(file));

/**
 * @param {string} file
 * @param {string} source
 */
export function scanSource(file, source) {
  /** @type {import("./report.mjs").Problem[]} */
  const problems = [];
  source.split("\n").forEach((line, i) => {
    if (/\/\/\s*determinism-ok\b/.test(line)) return;
    const code = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
    if (/^\s*\*/.test(code)) return; // a line inside a block comment
    for (const [re, why] of FORBIDDEN) {
      if (re.test(code)) {
        problems.push({
          rule: "determinism",
          file: `${file}:${i + 1}`,
          message: why,
          fix: 'Remove it, or add "// determinism-ok: <reason>" if it never affects the simulation.',
        });
      }
    }
  });
  return problems;
}
