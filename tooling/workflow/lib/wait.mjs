// Polling with a timeout, for `pnpm env:wait` (waits for a deploy).
// The clock is injectable so the tests don't wait.

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Calls `attempt` until `done(value)` holds, `stop(value)` says waiting is pointless, or the timeout
 * passes. The last attempt happens at or before the timeout.
 * @template T
 * @param {{
 *   attempt: () => Promise<T>,
 *   done: (value: T) => boolean,
 *   stop?: (value: T) => boolean,
 *   timeoutMs: number,
 *   intervalMs: number,
 *   onWait?: (value: T, elapsedMs: number) => void,
 *   now?: () => number,
 *   sleep?: (ms: number) => Promise<void>,
 * }} opts
 * @returns {Promise<{ done: boolean, stopped?: boolean, last: T, attempts: number }>}
 */
export async function poll({
  attempt,
  done,
  stop = () => false,
  timeoutMs,
  intervalMs,
  onWait,
  now = Date.now,
  sleep = realSleep,
}) {
  const start = now();
  let attempts = 0;
  for (;;) {
    const last = await attempt();
    attempts++;
    if (done(last)) return { done: true, last, attempts };
    if (stop(last)) return { done: false, stopped: true, last, attempts };
    const elapsed = now() - start;
    const left = timeoutMs - elapsed;
    if (left <= 0) return { done: false, last, attempts };
    onWait?.(last, elapsed);
    await sleep(Math.min(intervalMs, left));
  }
}
