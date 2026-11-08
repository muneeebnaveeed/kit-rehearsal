// Changes to the shared contract (server/core/src/shared/) affect every game. Never a failure, always a
// warning, so the PR says which games are affected and how they migrate.

const CONTRACT = /^server\/core\/src\/shared\/(?!.*\.test\.ts$)/;

/** @param {string[]} files */
export function contractWarnings(files) {
  return files
    .filter((f) => CONTRACT.test(f))
    .map(
      (f) =>
        `${f} is part of the shared contract: say in the PR which games are affected and how they migrate.`,
    );
}
