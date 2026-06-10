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

import type { CellFormat, CellRange } from '@mog-sdk/contracts/core';

type CellFormatReadback = Partial<{ [K in keyof CellFormat]: CellFormat[K] | null }>;

type FormatReader = {
  get(row: number, col: number): Promise<CellFormatReadback | null>;
  getCellProperties(
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
  ): Promise<Array<Array<CellFormatReadback | null>>>;
};

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

const COLOR_PROPERTIES = new Set<keyof CellFormat>([
  'fontColor',
  'backgroundColor',
  'patternForegroundColor',
]);

function normalizeColor(value: string): string {
  const trimmed = value.trim();
  const shortHex = trimmed.match(/^#([0-9a-f]{3})$/i);
  if (shortHex) {
    return `#${shortHex[1]
      .split('')
      .map((part) => part + part)
      .join('')
      .toUpperCase()}`;
  }
  const longHex = trimmed.match(/^#([0-9a-f]{6})$/i);
  if (longHex) return `#${longHex[1].toUpperCase()}`;
  return trimmed.toLowerCase();
}

function normalizeComparableValue(value: unknown, key: keyof CellFormat): unknown {
  if (COLOR_PROPERTIES.has(key) && typeof value === 'string') {
    return normalizeColor(value);
  }
  return value;
}

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
    return normalizeComparableValue(FORMAT_DEFAULTS[key], key);
  }
  return normalizeComparableValue(value, key);
}

function normalizeWithDefault(
  value: unknown,
  key: keyof CellFormat,
  propertyDefault?: unknown,
): unknown {
  if (value === undefined || value === null) {
    return normalizeComparableValue(propertyDefault ?? FORMAT_DEFAULTS[key], key);
  }
  return normalizeComparableValue(value, key);
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
  base: CellFormatReadback,
  cells: ReadonlyArray<CellFormatReadback | null>,
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
  base: CellFormatReadback,
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

export interface ReadCommonFormatPropertyOptions<K extends keyof CellFormat> {
  formats: FormatReader;
  activeCell: { row: number; col: number };
  ranges: readonly CellRange[];
  property: K;
  /**
   * Optional UI-level default for properties that the worksheet cascade leaves
   * absent but a control should still display as a concrete value. For example,
   * automatic font color displays as black in the toolbar while still comparing
   * equal to an explicit black selection.
   */
  defaultValue?: NonNullable<CellFormat[K]>;
  maxCells?: number;
}

export interface CommonFormatPropertyResult<K extends keyof CellFormat> {
  value: NonNullable<CellFormat[K]> | undefined;
  mixed: boolean;
  limited: boolean;
}

function normalizeRange(range: CellRange): CellRange {
  return {
    ...range,
    startRow: Math.min(range.startRow, range.endRow),
    endRow: Math.max(range.startRow, range.endRow),
    startCol: Math.min(range.startCol, range.endCol),
    endCol: Math.max(range.startCol, range.endCol),
  };
}

function isSingleCellSelection(ranges: readonly CellRange[]): boolean {
  return (
    ranges.length === 1 &&
    ranges[0].startRow === ranges[0].endRow &&
    ranges[0].startCol === ranges[0].endCol
  );
}

function typedValue<K extends keyof CellFormat>(
  value: unknown,
): NonNullable<CellFormat[K]> | undefined {
  return value === undefined ? undefined : (value as NonNullable<CellFormat[K]>);
}

/**
 * Read the common resolved value for one format property across a selection.
 *
 * This is the property-level counterpart to Format Cells mixed-state detection:
 * it reads through worksheet format APIs, never viewport render caches, and
 * returns `undefined` when the selection is mixed or too large to scan safely.
 */
export async function readCommonFormatProperty<K extends keyof CellFormat>({
  formats,
  activeCell,
  ranges,
  property,
  defaultValue,
  maxCells = MAX_CELLS_FOR_MIXED_SCAN,
}: ReadCommonFormatPropertyOptions<K>): Promise<CommonFormatPropertyResult<K>> {
  let base: CellFormatReadback;
  try {
    base = (await formats.get(activeCell.row, activeCell.col)) ?? {};
  } catch {
    return { value: undefined, mixed: true, limited: false };
  }
  const baseValue = normalizeWithDefault(base[property], property, defaultValue);

  if (ranges.length === 0 || isSingleCellSelection(ranges)) {
    return { value: typedValue<K>(baseValue), mixed: false, limited: false };
  }

  if (totalCellCount(ranges) > maxCells) {
    return { value: undefined, mixed: true, limited: true };
  }

  for (const range of ranges.map(normalizeRange)) {
    let grid: Array<Array<CellFormatReadback | null>>;
    try {
      grid = await formats.getCellProperties(
        range.startRow,
        range.startCol,
        range.endRow,
        range.endCol,
      );
    } catch {
      return { value: undefined, mixed: true, limited: false };
    }
    for (const row of grid) {
      for (const cell of row) {
        const cellValue = normalizeWithDefault(cell?.[property], property, defaultValue);
        if (!deepEqual(cellValue, baseValue)) {
          return { value: undefined, mixed: true, limited: false };
        }
      }
    }
  }

  return { value: typedValue<K>(baseValue), mixed: false, limited: false };
}
