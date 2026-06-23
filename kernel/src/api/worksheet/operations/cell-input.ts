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
 * `{ kind: 'clear' } | { kind: 'literal', text } | { kind: 'parse', text } |
 * { kind: 'value', value }`.
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
 * - string with significant leading zero numeric shape
 *                              → `{ kind: 'literal', text: value }` — account
 *   IDs such as `"000184"` must not be coerced to `184`.
 * - any other string           → `{ kind: 'parse', text: value }`
 * - finite number / boolean    → `{ kind: 'value', value }`
 * - non-finite number          → `{ kind: 'parse', text: String(value) }`
 * - `CellError`-shaped object  → `{ kind: 'value', value }`
 *
 * This replaces the legacy `\x00`-prefix sentinel that the SDK used to
 * smuggle "store empty text" through a plain `String` at the engine
 * boundary. The sentinel is gone; the rare "store empty text" intent now
 * has a typed form.
 */

import type { CellInput } from '../../../bridges/compute/compute-types.gen';
import type { CellValue, CellValuePrimitive } from './types';
import { isCellError } from '@mog/spreadsheet-utils/errors';

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

function hasSignificantLeadingZeroNumericShape(value: string): boolean {
  const trimmed = value.trim();
  const unsigned = trimmed.startsWith('-') ? trimmed.slice(1) : trimmed;
  return /^0\d+(?:\.\d+)?$/.test(unsigned);
}

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
      return { kind: 'value', value };
    }
    return { kind: 'parse', text: String(value) };
  }
  if (typeof value === 'number') {
    if (Number.isFinite(value)) {
      return { kind: 'value', value };
    }
    return { kind: 'parse', text: String(value) };
  }
  if (typeof value === 'boolean') {
    return { kind: 'value', value };
  }
  if (hasSignificantLeadingZeroNumericShape(value)) {
    return { kind: 'literal', text: value };
  }
  return { kind: 'parse', text: value };
}
