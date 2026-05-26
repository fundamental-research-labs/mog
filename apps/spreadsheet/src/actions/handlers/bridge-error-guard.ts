import { isBridgeErrorKind } from '@mog/transport';

/**
 * Standard "cannot change part of an array" error message (Excel parity).
 *
 * Surfaced when Rust `compute-core` rejects a mutation
 * (`set_cell`, `clear_range_by_position`, `set_range`, etc.) with
 * `ComputeError::PartialArrayWrite`. The discriminated `BridgeError`
 * union (mirroring the Rust variant) lets callers branch via
 * `isBridgeErrorKind(err, 'PartialArrayWrite')` rather than substring
 * matching the formatted message.
 */
export const ARRAY_PART_ERROR = 'You cannot change part of an array formula.';

/**
 * Wraps an async bridge mutation and converts the `PartialArrayWrite`
 * rejection into a no-op (returns `false`). Any other rejection is
 * rethrown unchanged so the editor machine's `onError` transition and
 * the global error pathway still fire.
 *
 * Returns `true` when the mutation succeeded.
 *
 * The mutation's resolved value is discarded — callers that need it
 * should capture it inside the closure. The generic return type lets
 * us guard mutations whose result type is `void`, `ClearResult`,
 * `SetCellsResult`, etc. without per-call cast gymnastics.
 *
 * Used by direct mutation handlers that bypass the editor commit
 * pipeline (Backspace clear, fill operations, paste, flash-fill, etc.) —
 * these have no editor machine to absorb the rejection, so they must
 * guard inline.
 */
export async function guardBridgeMutation<T>(fn: () => Promise<T>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (err) {
    if (isBridgeErrorKind(err, 'PartialArrayWrite')) {
      console.error(`[array] ${ARRAY_PART_ERROR}`);
      return false;
    }
    throw err;
  }
}
