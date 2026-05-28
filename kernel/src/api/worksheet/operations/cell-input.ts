/**
 * Ergonomic coercion from a raw SDK value to the engine's typed `CellInput`.
 *
 * # Audience
 *
 * This helper exists for **ergonomic / LLM-agent callers** who pass
 * primitives (`string`, `number`, `boolean`, `null`) and expect the SDK to
 * do something sensible. Programmatic / app callers that want full intent
 * fidelity (e.g. "store empty text verbatim") should skip this helper and
 * build `CellInput` directly — the shape at the boundary is
 * `{ kind: 'clear' } | { kind: 'literal', text } | { kind: 'parse', text }`.
 *
 * # Semantics
 *
 * Defaults follow Excel / Google Sheets convention so the behaviour is
 * predictable to both users and agents:
 *
 * - `null` / `undefined`       → `{ kind: 'clear' }` — unambiguously nothing.
 * - `''` (empty string)        → `{ kind: 'clear' }` — Excel convention: an
 *   empty textbox clears the cell. Callers who want the rare "store empty
 *   text" intent must pass `{ kind: 'literal', text: '' }` explicitly.
 * - any other string / number / boolean → `{ kind: 'parse', text: String(value) }`
 * - `CellError`-shaped object  → `{ kind: 'parse', text: error display string }`
 *
 * This replaces the legacy `\x00`-prefix sentinel that the SDK used to
 * smuggle "store empty text" through a plain `String` at the engine
 * boundary. The sentinel is gone; the rare "store empty text" intent now
 * has a typed form.
 */

import type { CellInput } from '../../../bridges/compute/compute-types.gen';
import type { CellValue, CellValuePrimitive } from './types';
import { errorDisplayString, isCellError } from '@mog/spreadsheet-utils/errors';

export type { CellInput } from '../../../bridges/compute/compute-types.gen';

/**
 * Anything we accept at the ergonomic SDK boundary for writing into a cell.
 *
 * Accepts the full `CellValue` union so callers that already hold a
 * read-back value (including `CellError` from a prior computation) can
 * re-use it without awkward casts. Unknown non-primitive values are
 * stringified the same way the legacy `String(val)` path did.
 */
export type ToCellInputValue = CellValue | CellValuePrimitive | undefined;

/**
 * Normalise a user-supplied cell value into a `CellInput`. See module
 * docstring for semantics.
 */
export function toCellInput(value: ToCellInputValue): CellInput {
  if (value === null || value === undefined || value === '') {
    return { kind: 'clear' };
  }
  if (typeof value === 'object') {
    if (isCellError(value)) {
      return { kind: 'parse', text: errorDisplayString(value.value) };
    }
    return { kind: 'parse', text: String(value) };
  }
  const text = String(value);
  return { kind: 'parse', text };
}
