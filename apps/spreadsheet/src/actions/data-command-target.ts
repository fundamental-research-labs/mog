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
  readonly trimBlankLeadingCommandRow: boolean;
}

const HEADER_BODY_SCAN_ROW_LIMIT = 100;

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

function cellHasNonBlankValue(cell: { value?: unknown } | null | undefined): boolean {
  const value = cell?.value;
  if (value == null || value === '') return false;
  if (typeof value !== 'string') return true;
  return value.trim() !== '';
}

function rowHasDataSignal(row: Array<{ value?: unknown } | null | undefined>): boolean {
  return row.some((cell) => {
    const value = cell?.value;
    if (value == null || value === '') return false;
    if (typeof value !== 'string') return true;
    return value.trim() !== '' && Number.isFinite(Number(value));
  });
}

function rowHasNonBlankValue(row: Array<{ value?: unknown } | null | undefined>): boolean {
  return row.some(cellHasNonBlankValue);
}

async function readRangeRow(
  ws: Worksheet,
  row: number,
  startCol: number,
  width: number,
): Promise<Array<{ value?: unknown } | null | undefined>> {
  return Promise.all(Array.from({ length: width }, (_, i) => ws.getCell(row, startCol + i)));
}

async function rangeLooksLikeHeaderTable(ws: Worksheet, range: CellRange): Promise<boolean> {
  if (range.startRow >= range.endRow) return false;

  const width = range.endCol - range.startCol + 1;
  const firstRow = await readRangeRow(ws, range.startRow, range.startCol, width);

  const firstRowAllText = firstRow.every((cell) => {
    const value = cell?.value;
    return typeof value === 'string' && value.trim().length > 0;
  });
  if (!firstRowAllText) return false;

  const scanEndRow = Math.min(range.endRow, range.startRow + HEADER_BODY_SCAN_ROW_LIMIT);
  for (let row = range.startRow + 1; row <= scanEndRow; row++) {
    const bodyRow = await readRangeRow(ws, row, range.startCol, width);
    if (rowHasDataSignal(bodyRow)) return true;
  }

  return false;
}

async function trimBlankLeadingCommandRow(ws: Worksheet, range: CellRange): Promise<CellRange> {
  if (range.startRow >= range.endRow) return range;

  const width = range.endCol - range.startCol + 1;
  const firstRow = await readRangeRow(ws, range.startRow, range.startCol, width);
  if (rowHasNonBlankValue(firstRow)) return range;

  const scanEndRow = Math.min(range.endRow, range.startRow + HEADER_BODY_SCAN_ROW_LIMIT);
  for (let row = range.startRow + 1; row <= scanEndRow; row++) {
    const bodyRow = await readRangeRow(ws, row, range.startCol, width);
    if (rowHasNonBlankValue(bodyRow)) {
      return { ...range, startRow: range.startRow + 1 };
    }
  }

  return range;
}

export async function resolveDataCommandTarget(
  ws: Worksheet,
  userRange: CellRange,
): Promise<DataCommandTarget | null> {
  return resolveDataTarget(ws, userRange, {
    allowEmptySingleCell: false,
    inferHeadersForExplicitMultiRow: true,
    trimBlankLeadingCommandRow: true,
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
    const commandRange = options.trimBlankLeadingCommandRow
      ? await trimBlankLeadingCommandRow(ws, range)
      : range;
    return {
      range: commandRange,
      hasHeaders: options.inferHeadersForExplicitMultiRow
        ? await rangeLooksLikeHeaderTable(ws, commandRange)
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
    trimBlankLeadingCommandRow: false,
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
