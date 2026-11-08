/**
 * Interpolation buffer for remote entities (other players, enemies).
 * The server sends snapshots a few times a second; drawing them as they arrive looks jumpy. Instead
 * we draw the world `delayMs` in the past, blending between the two snapshots around that moment.
 * Push each snapshot with the time it arrived, and sample with the current time, on the same clock.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Straight-line blend between two points; `t` is 0 at `a` and 1 at `b`. */
export function lerpPoint(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export interface InterpolationOptions<T> {
  /** How far in the past to draw. About two server ticks is a good start (e.g. 100 ms at 20 Hz). */
  readonly delayMs: number;
  readonly lerp: (a: T, b: T, t: number) => T;
  /** How many snapshots to keep. */
  readonly maxSnapshots?: number;
}

export interface InterpolationBuffer<T> {
  readonly size: number;
  /** Adds a snapshot: entity id → value. Snapshots older than the newest one are ignored. */
  push(time: number, entities: ReadonlyMap<string, T>): void;
  /** The blended value of every entity at `now - delayMs`. */
  sample(now: number): Map<string, T>;
}

interface Snapshot<T> {
  readonly time: number;
  readonly entities: ReadonlyMap<string, T>;
}

const DEFAULT_MAX_SNAPSHOTS = 32;

export function createInterpolationBuffer<T>(options: InterpolationOptions<T>): InterpolationBuffer<T> {
  const maxSnapshots = options.maxSnapshots ?? DEFAULT_MAX_SNAPSHOTS;
  let snapshots: readonly Snapshot<T>[] = [];

  return {
    get size() {
      return snapshots.length;
    },
    push(time, entities) {
      const newest = snapshots.at(-1);
      if (newest && time < newest.time) return;
      snapshots = [...snapshots, { time, entities }].slice(-maxSnapshots);
    },
    sample(now) {
      const first = snapshots[0];
      const last = snapshots.at(-1);
      if (!first || !last) return new Map();

      const renderTime = now - options.delayMs;
      if (renderTime <= first.time) return new Map(first.entities);
      if (renderTime >= last.time) return new Map(last.entities);

      const nextIndex = snapshots.findIndex((snapshot) => snapshot.time > renderTime);
      const before = snapshots[nextIndex - 1] ?? first;
      const after = snapshots[nextIndex] ?? last;
      return blend(before, after, renderTime, options.lerp);
    },
  };
}

/** Entities in `after` are shown; ones that only exist in `before` have left and are dropped. */
function blend<T>(
  before: Snapshot<T>,
  after: Snapshot<T>,
  renderTime: number,
  lerp: (a: T, b: T, t: number) => T,
): Map<string, T> {
  const span = after.time - before.time;
  const t = span > 0 ? (renderTime - before.time) / span : 1;
  const result = new Map<string, T>();
  for (const [id, next] of after.entities) {
    const previous = before.entities.get(id);
    result.set(id, previous === undefined ? next : lerp(previous, next, t));
  }
  return result;
}
