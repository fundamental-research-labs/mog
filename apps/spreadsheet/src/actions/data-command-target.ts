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

async function rangeLooksLikeHeaderTable(ws: Worksheet, range: CellRange): Promise<boolean> {
  if (range.startRow >= range.endRow) return false;

  const width = range.endCol - range.startCol + 1;
  const firstRow = await Promise.all(
    Array.from({ length: width }, (_, i) => ws.getCell(range.startRow, range.startCol + i)),
  );
  const secondRow = await Promise.all(
    Array.from({ length: width }, (_, i) => ws.getCell(range.startRow + 1, range.startCol + i)),
  );

  const firstRowAllText = firstRow.every((cell) => {
    const value = cell?.value;
    return typeof value === 'string' && value.trim().length > 0;
  });
  const secondRowHasDataSignal = secondRow.some((cell) => {
    const value = cell?.value;
    if (value == null || value === '') return false;
    if (typeof value !== 'string') return true;
    return value.trim() !== '' && Number.isFinite(Number(value));
  });

  return firstRowAllText && secondRowHasDataSignal;
}

export async function resolveDataCommandTarget(
  ws: Worksheet,
  userRange: CellRange,
): Promise<DataCommandTarget | null> {
  return resolveDataTarget(ws, userRange, {
    allowEmptySingleCell: false,
    inferHeadersForExplicitMultiRow: false,
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
        ? await rangeLooksLikeHeaderTable(ws, range)
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
