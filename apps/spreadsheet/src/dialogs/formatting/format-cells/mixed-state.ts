/**
 * Mixed-state detection for the Format Cells dialog.
 *
 * The dialog opens against a multi-cell selection. Each tab needs to know which
 * properties agree across the selection (show the active cell's value) and
 * which disagree (show indeterminate / placeholder / empty). We compute that
 * once at dialog open via `detectMixedProperties` and pass tabs a merged
 * `Partial<CellFormat>` where mixed properties are stripped to undefined and
 * agreed default-backed properties are materialized to their normalized value.
 *
 * Both `base` (active cell, returned by `ws.formats.get`) and the per-cell
 * entries (returned by `ws.formats.getCellProperties`) are 5-layer-cascade
 * resolved by Rust. Cells with no overrides anywhere come back as null
 * (entry-wide null), and individual properties may be null/undefined when not
 * present in the cascade. We normalize both sides through the same defaults
 * table — matching Rust's `default_format()` — so e.g. cell-level `indent: 0`
 * vs cascade-absent (null) both resolve to 0 and do NOT show as mixed.
 */

import type { CellFormat } from '@mog-sdk/contracts/core';

/**
 * Properties tracked for mixed-state detection. Borders and number format are
 * intentionally excluded — borders have per-edge semantics and number formats
 * are category-based strings; both need separate plans.
 */
export const TRACKED_PROPERTIES: readonly (keyof CellFormat)[] = [
  // Booleans
  'wrapText',
  'shrinkToFit',
  'strikethrough',
  'superscript',
  'subscript',
  'locked',
  'hidden',
  'bold',
  'italic',
  // Non-booleans
  'horizontalAlign',
  'verticalAlign',
  'indent',
  'textRotation',
  'readingOrder',
  'fontFamily',
  'fontSize',
  'underlineType',
  'fontColor',
  'backgroundColor',
  'patternType',
  'patternForegroundColor',
  'gradientFill',
] as const;

/**
 * Defaults applied during normalization. Mirrors Rust's `default_format()`
 * (compute/core/src/storage/properties.rs). Properties absent here normalize
 * to `undefined` on both sides of the comparison.
 */
const FORMAT_DEFAULTS: Partial<Record<keyof CellFormat, unknown>> = {
  // Booleans not in Rust default_format() but with conventional defaults.
  wrapText: false,
  shrinkToFit: false,
  strikethrough: false,
  superscript: false,
  subscript: false,
  bold: false,
  italic: false,
  locked: true,
  hidden: false,
  // Alignment / layout
  horizontalAlign: 'general',
  verticalAlign: 'bottom',
  indent: 0,
  textRotation: 0,
  readingOrder: 'context',
  // Font
  fontFamily: 'Calibri',
  fontSize: 11,
  underlineType: 'none',
  patternType: 'none',
  // fontColor / backgroundColor / patternForegroundColor / gradientFill all
  // default to undefined — leaving them out of the table is correct.
};

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  // gradientFill is the only object-valued property; Rust serializes JSON
  // with deterministic key ordering, so a structural compare via stringify
  // is safe. If we add other object-valued properties this should be revisited.
  return JSON.stringify(a) === JSON.stringify(b);
}

function normalize(value: unknown, key: keyof CellFormat): unknown {
  if (value === undefined || value === null) {
    return FORMAT_DEFAULTS[key];
  }
  return value;
}

/**
 * Compare each cell's resolved format against the active cell base; return the
 * set of properties that disagree somewhere in the selection.
 *
 * @param base Active cell's resolved format (every key present, null for absent).
 * @param cells Flat list of resolved per-cell formats from `getCellProperties`.
 * `null` means the cell had no overrides anywhere (cascade equals defaults).
 */
export function detectMixedProperties(
  base: Partial<CellFormat>,
  cells: ReadonlyArray<CellFormat | null>,
): Set<keyof CellFormat> {
  const mixed = new Set<keyof CellFormat>();

  for (const cell of cells) {
    for (const key of TRACKED_PROPERTIES) {
      if (mixed.has(key)) continue;
      const cellValue = normalize(cell?.[key], key);
      const baseValue = normalize((base as Record<string, unknown>)[key], key);
      if (!deepEqual(cellValue, baseValue)) {
        mixed.add(key);
      }
    }
    if (mixed.size === TRACKED_PROPERTIES.length) break;
  }

  return mixed;
}

/**
 * Build the merged format passed to tabs as `initialFormat`. Mixed properties
 * are stripped (left undefined); agreed properties keep the base's value, or
 * the normalized default when the resolved format represents "absent" as
 * null/undefined.
 */
export function buildMergedFormat(
  base: Partial<CellFormat>,
  mixed: ReadonlySet<keyof CellFormat>,
): Partial<CellFormat> {
  const merged: Partial<CellFormat> = {};

  // Preserve non-null base values for every non-mixed property, including
  // properties not tracked by mixed-state detection (for example borders and
  // numberFormat).
  for (const key of Object.keys(base) as (keyof CellFormat)[]) {
    if (mixed.has(key)) continue;
    const value = (base as Record<string, unknown>)[key];
    if (value !== null && value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }

  // Materialize normalized defaults for tracked properties that are not mixed.
  // Without this, a resolved `null`/absent shrinkToFit becomes `undefined`,
  // which tabs correctly interpret as mixed/indeterminate.
  for (const key of TRACKED_PROPERTIES) {
    if (mixed.has(key)) continue;
    if ((merged as Record<string, unknown>)[key] !== undefined) continue;
    if (Object.prototype.hasOwnProperty.call(FORMAT_DEFAULTS, key)) {
      (merged as Record<string, unknown>)[key] = FORMAT_DEFAULTS[key];
    }
  }
  return merged;
}

/**
 * Total cell count across a list of ranges, used to fall back to "everything
 * mixed" when the selection exceeds the kernel's 10K cell guard.
 */
export function totalCellCount(
  ranges: ReadonlyArray<{ startRow: number; startCol: number; endRow: number; endCol: number }>,
): number {
  let total = 0;
  for (const r of ranges) {
    const rows = Math.abs(r.endRow - r.startRow) + 1;
    const cols = Math.abs(r.endCol - r.startCol) + 1;
    total += rows * cols;
  }
  return total;
}

export const MAX_CELLS_FOR_MIXED_SCAN = 10_000;
