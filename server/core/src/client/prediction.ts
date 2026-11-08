/**
 * Client-side prediction with reconciliation for the local player.
 * Each input is applied right away so the player feels no lag, and kept until the server says it
 * applied it (the player's `lastSeq`). When a server state arrives, the remaining inputs are replayed
 * on top of it, so the server stays in charge but the player never waits.
 * `apply` must be the same rule the server room uses (share it from the game's shared/ folder).
 */

export interface PredictorOptions<S, I> {
  readonly initial: S;
  /** Pure: returns the state after one input, without changing `state`. */
  readonly apply: (state: S, input: I) => S;
}

export interface Prediction<S> {
  /** Send this with the input, as `InputEnvelope.seq`. */
  readonly seq: number;
  readonly state: S;
}

export interface Predictor<S, I> {
  readonly state: S;
  readonly pendingCount: number;
  /** Applies an input locally and returns its sequence number and the predicted state. */
  predict(input: I): Prediction<S>;
  /** Takes the server's state and the last seq it applied; returns the corrected local state. */
  reconcile(serverState: S, lastSeq: number): S;
}

interface PendingInput<I> {
  readonly seq: number;
  readonly input: I;
}

export function createPredictor<S, I>(options: PredictorOptions<S, I>): Predictor<S, I> {
  let state = options.initial;
  let pending: readonly PendingInput<I>[] = [];
  let lastSeq = 0; // the server's lastSeq starts at 0, so the first input is seq 1
  let lastAcknowledged = 0;

  return {
    get state() {
      return state;
    },
    get pendingCount() {
      return pending.length;
    },
    predict(input) {
      lastSeq += 1;
      pending = [...pending, { seq: lastSeq, input }];
      state = options.apply(state, input);
      return { seq: lastSeq, state };
    },
    reconcile(serverState, acknowledgedSeq) {
      // Patches can repeat an old lastSeq; going backwards would replay inputs twice.
      if (acknowledgedSeq < lastAcknowledged) return state;
      lastAcknowledged = acknowledgedSeq;
      pending = pending.filter((item) => item.seq > acknowledgedSeq);
      state = pending.reduce((current, item) => options.apply(current, item.input), serverState);
      return state;
    },
  };
}
