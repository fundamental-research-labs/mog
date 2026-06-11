import type { Worksheet } from '@mog-sdk/contracts/api';
import type { CellRange } from '@mog-sdk/contracts/core';

export interface DataCommandTarget {
  readonly range: CellRange;
  readonly hasHeaders: boolean;
  readonly wasExpanded: boolean;
}

interface ResolveDataTargetOptions {
  readonly allowEmptySingleCell: boolean;
  readonly inferHeadersForExplicitMultiRow: boolean;
}

const HEADER_BODY_SCAN_ROW_LIMIT = 100;
const MIN_HEADER_TEXT_DENSITY = 0.6;

export function normalizeCommandRange(range: CellRange): CellRange {
  return {
    startRow: range.startRow,
    startCol: range.startCol,
    endRow: range.endRow,
    endCol: range.endCol,
  };
}

export function getRelativeCommandColumn(
  activeCell: { row: number; col: number } | null | undefined,
  range: CellRange,
): number {
  if (
    !activeCell ||
    activeCell.row < range.startRow ||
    activeCell.row > range.endRow ||
    activeCell.col < range.startCol ||
    activeCell.col > range.endCol
  ) {
    return 0;
  }
  return activeCell.col - range.startCol;
}

function isNumericLikeString(value: string): boolean {
  const normalized = value.trim().replace(/[,\s]/g, '').replace(/%$/, '');
  return normalized !== '' && Number.isFinite(Number(normalized));
}

function isStructuredSingleColumnHeader(value: string): boolean {
  const normalized = value.trim();
  return /^(?:Q[1-4]|[1-4]Q|FY\s?\d{2,4}|(?:19|20)\d{2})$/i.test(normalized);
}

async function rangeLooksLikeHeaderTable(
  ws: Worksheet,
  range: CellRange,
  options: { conservativeSingleColumn?: boolean } = {},
): Promise<boolean> {
  if (range.startRow >= range.endRow) return false;

  const width = range.endCol - range.startCol + 1;
  const firstRow = await Promise.all(
    Array.from({ length: width }, (_, i) => ws.getCell(range.startRow, range.startCol + i)),
  );

  let firstRowTextCount = 0;
  for (const cell of firstRow) {
    const value = cell?.value;
    if (value == null) continue;
    if (typeof value !== 'string') return false;
    if (value.trim().length === 0) continue;
    firstRowTextCount += 1;
  }
  const minTextHeaders = Math.max(1, Math.ceil(width * MIN_HEADER_TEXT_DENSITY));
  if (firstRowTextCount < minTextHeaders) return false;

  const scanEndRow = Math.min(range.endRow, range.startRow + HEADER_BODY_SCAN_ROW_LIMIT);
  let firstNonEmptyBodyRow: number | null = null;
  let hasNumericBodySignal = false;
  let hasTextBodySignal = false;

  for (let row = range.startRow + 1; row <= scanEndRow; row++) {
    const bodyRow = await Promise.all(
      Array.from({ length: width }, (_, i) => ws.getCell(row, range.startCol + i)),
    );
    for (const cell of bodyRow) {
      const value = cell?.value;
      if (value == null || value === '') continue;
      if (firstNonEmptyBodyRow == null) {
        firstNonEmptyBodyRow = row;
      }
      if (typeof value !== 'string') {
        hasNumericBodySignal = true;
        continue;
      }
      const trimmed = value.trim();
      if (trimmed === '') continue;
      if (isNumericLikeString(trimmed)) {
        hasNumericBodySignal = true;
      } else {
        hasTextBodySignal = true;
      }
    }
  }

  if (!hasNumericBodySignal) return false;

  if (width === 1 && options.conservativeSingleColumn) {
    const firstValue = firstRow[0]?.value;
    const firstText = typeof firstValue === 'string' ? firstValue : '';
    const hasSpacerBeforeBody =
      firstNonEmptyBodyRow != null && firstNonEmptyBodyRow > range.startRow + 1;
    return !hasTextBodySignal && (hasSpacerBeforeBody || isStructuredSingleColumnHeader(firstText));
  }

  return true;
}

export async function resolveDataCommandTarget(
  ws: Worksheet,
  userRange: CellRange,
): Promise<DataCommandTarget | null> {
  return resolveDataTarget(ws, userRange, {
    allowEmptySingleCell: false,
    inferHeadersForExplicitMultiRow: true,
  });
}

async function resolveDataTarget(
  ws: Worksheet,
  userRange: CellRange,
  options: ResolveDataTargetOptions,
): Promise<DataCommandTarget | null> {
  const range = normalizeCommandRange(userRange);
  const isMultiRow = range.startRow !== range.endRow;

  if (isMultiRow) {
    return {
      range,
      hasHeaders: options.inferHeadersForExplicitMultiRow
        ? await rangeLooksLikeHeaderTable(ws, range, { conservativeSingleColumn: true })
        : false,
      wasExpanded: false,
    };
  }

  const expanded = normalizeCommandRange(await ws.getCurrentRegion(range.startRow, range.startCol));
  if (expanded.startRow === expanded.endRow && expanded.startCol === expanded.endCol) {
    const cell = await ws.getCell(expanded.startRow, expanded.startCol);
    const value = cell?.value;
    if (value == null || value === '') {
      if (!options.allowEmptySingleCell) {
        return null;
      }
      return {
        range,
        hasHeaders: false,
        wasExpanded: false,
      };
    }
  }

  return {
    range: expanded,
    hasHeaders: await rangeLooksLikeHeaderTable(ws, expanded),
    wasExpanded: true,
  };
}

/**
 * Resolve the target for dialogs that can still open on an empty selection.
 *
 * Mutating commands such as Sort Ascending and AutoFilter should use
 * `resolveDataCommandTarget()` directly so an empty single-cell selection stays
 * disabled. Dialog openers are different: the dialog is the range-editing
 * surface, so a blank current region should fall back to the user's selection
 * instead of preventing the dialog from opening.
 */
export async function resolveDataDialogTarget(
  ws: Worksheet,
  userRange: CellRange,
): Promise<DataCommandTarget> {
  const target = await resolveDataTarget(ws, userRange, {
    allowEmptySingleCell: true,
    inferHeadersForExplicitMultiRow: true,
  });
  return (
    target ?? {
      range: normalizeCommandRange(userRange),
      hasHeaders: false,
      wasExpanded: false,
    }
  );
}

/**
 * Text to Columns operates on the selected source cells, not the surrounding
 * current region. A single-cell selection therefore remains a single-cell
 * source, avoiding accidental horizontal expansion into adjacent data.
 */
export async function resolveTextToColumnsTarget(
  _ws: Worksheet,
  userRange: CellRange,
): Promise<DataCommandTarget> {
  return {
    range: normalizeCommandRange(userRange),
    hasHeaders: false,
    wasExpanded: false,
  };
}
