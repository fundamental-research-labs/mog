/**
 * Data extractor primitives for ranges, chart cell values, and direct range access.
 */
import type { ChartDataPoint, ChartDataPointValueState } from '../types';

// Import canonical types from contracts - SINGLE SOURCE OF TRUTH
import type { CellAddress, CellRange } from '@mog-sdk/contracts/core';
import { colToLetter, parseCellRange } from '@mog/spreadsheet-utils/a1';

// Re-export for backwards compatibility through data-extractor.ts.
export type { CellAddress, CellRange };

/**
 * Generic cell value type that can come from any data source.
 *
 * Intentionally different from the canonical `CellValue` in `@mog-sdk/contracts/core`
 * which is `string | number | boolean | null | CellError`. This chart variant includes `undefined`
 * for missing data points and excludes `CellError`.
 *
 * @see `@mog-sdk/contracts/core` for the canonical `CellValue` type.
 */
export const HIDDEN_CHART_CELL = Symbol.for('mog.chart.hiddenCell');
export type HiddenChartCellValue = typeof HIDDEN_CHART_CELL;
export type ChartCellValue = string | number | boolean | null | undefined | HiddenChartCellValue;

/**
 * Generic cell data accessor interface
 * Implementations can be backed by Yjs, plain objects, etc.
 */
export interface CellDataAccessor {
  getValue(row: number, col: number, sheetId?: string): ChartCellValue;
}

export function getRangeValue(
  accessor: CellDataAccessor,
  range: CellRange,
  row: number,
  col: number,
): ChartCellValue {
  return accessor.getValue(row, col, range.sheetId);
}

/**
 * Parse a range string (e.g., "A1:D10" or "B5") to CellRange
 * Returns canonical CellRange format from contracts: { startRow, startCol, endRow, endCol }
 */
export function parseRange(range: string): CellRange {
  const parsed = parseCellRange(range);
  if (!parsed) {
    throw new Error(`Invalid cell range: ${range}`);
  }
  return {
    startRow: Math.min(parsed.startRow, parsed.endRow),
    startCol: Math.min(parsed.startCol, parsed.endCol),
    endRow: Math.max(parsed.startRow, parsed.endRow),
    endCol: Math.max(parsed.startCol, parsed.endCol),
    ...(parsed.sheetName ? { sheetId: parsed.sheetName } : {}),
  };
}

export function tryParseRange(range: string | undefined): CellRange | null {
  if (!range) return null;
  const parsed = parseCellRange(range);
  if (!parsed) return null;
  return {
    startRow: Math.min(parsed.startRow, parsed.endRow),
    startCol: Math.min(parsed.startCol, parsed.endCol),
    endRow: Math.max(parsed.startRow, parsed.endRow),
    endCol: Math.max(parsed.startCol, parsed.endCol),
    ...(parsed.sheetName ? { sheetId: parsed.sheetName } : {}),
  };
}

/**
 * Convert a value to a number, returning NaN for non-numeric values
 */
export function toNumber(value: ChartCellValue): number {
  if (isHiddenChartCellValue(value) || value === null || value === undefined || value === '') {
    return NaN;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  const num = parseFloat(String(value));
  return num;
}

export function isHiddenChartCellValue(value: ChartCellValue): value is HiddenChartCellValue {
  return value === HIDDEN_CHART_CELL;
}

export function isBlankChartCellValue(value: ChartCellValue): boolean {
  return value === null || value === undefined || value === '';
}

export function isNumericLike(value: ChartCellValue): boolean {
  return !Number.isNaN(toNumber(value));
}

function getValueState(
  rawValue: ChartCellValue,
  numericValue: number,
): ChartDataPointValueState | undefined {
  if (isHiddenChartCellValue(rawValue)) {
    return 'hidden';
  }

  if (isBlankChartCellValue(rawValue)) {
    return 'blank';
  }

  if (Number.isFinite(numericValue)) {
    return undefined;
  }

  if (
    typeof rawValue === 'number' ||
    (typeof rawValue === 'string' && rawValue.trim() !== '' && !Number.isNaN(numericValue))
  ) {
    return 'nonFinite';
  }

  return 'nonNumeric';
}

export function createDataPoint(
  x: string | number,
  rawValue: ChartCellValue,
  name: string,
  options?: {
    rawSize?: ChartCellValue;
    hidden?: boolean;
  },
): ChartDataPoint {
  const pointHidden = options?.hidden || isHiddenChartCellValue(rawValue);
  const numericValue = pointHidden ? NaN : toNumber(rawValue);
  const valueState: ChartDataPointValueState | undefined = pointHidden
    ? 'hidden'
    : getValueState(rawValue, numericValue);
  const point: ChartDataPoint = {
    x,
    y: Number.isFinite(numericValue) ? numericValue : 0,
    name,
  };
  if (valueState) {
    point.valueState = valueState;
  }
  const rawSize = options?.rawSize;
  const numericSize = pointHidden || isHiddenChartCellValue(rawSize) ? NaN : toNumber(rawSize);
  if (Number.isFinite(numericSize)) {
    point.size = numericSize;
  }
  return point;
}

export function xyValue(value: ChartCellValue): string | number {
  if (isHiddenChartCellValue(value) || isBlankChartCellValue(value)) {
    return '';
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  const text = String(value);
  const numeric = Number(text);
  return text.trim() !== '' && Number.isFinite(numeric) ? numeric : text;
}

export function hasCellValue(value: ChartCellValue): boolean {
  return !isHiddenChartCellValue(value) && !isBlankChartCellValue(value);
}

export function labelValue(value: ChartCellValue, fallback: string | number): string | number {
  if (isHiddenChartCellValue(value) || isBlankChartCellValue(value)) {
    return fallback;
  }
  return typeof value === 'number' ? value : String(value);
}

/**
 * Extract labels from a range (for categories or series names)
 */
export function extractLabels(accessor: CellDataAccessor, range: CellRange): (string | number)[] {
  const labels: (string | number)[] = [];

  // Determine if it's a row or column range
  const isRowRange = range.startRow === range.endRow;
  const isColRange = range.startCol === range.endCol;

  if (isRowRange) {
    // Extract from columns in a single row
    for (let col = range.startCol; col <= range.endCol; col++) {
      const value = getRangeValue(accessor, range, range.startRow, col);
      labels.push(labelValue(value, ''));
    }
  } else if (isColRange) {
    // Extract from rows in a single column
    for (let row = range.startRow; row <= range.endRow; row++) {
      const value = getRangeValue(accessor, range, row, range.startCol);
      labels.push(labelValue(value, ''));
    }
  } else {
    // For multi-row/col ranges, flatten by reading row by row
    for (let row = range.startRow; row <= range.endRow; row++) {
      for (let col = range.startCol; col <= range.endCol; col++) {
        const value = getRangeValue(accessor, range, row, col);
        labels.push(labelValue(value, ''));
      }
    }
  }

  return labels;
}

export function extractValues(accessor: CellDataAccessor, range: CellRange): ChartCellValue[] {
  const values: ChartCellValue[] = [];
  for (let row = range.startRow; row <= range.endRow; row++) {
    for (let col = range.startCol; col <= range.endCol; col++) {
      values.push(getRangeValue(accessor, range, row, col));
    }
  }
  return values;
}

/**
 * Simple object-based cell data accessor for testing
 */
export class ObjectCellAccessor implements CellDataAccessor {
  constructor(private data: Record<string, ChartCellValue>) {}

  getValue(row: number, col: number): ChartCellValue {
    const key = `${colToLetter(col)}${row + 1}`;
    return this.data[key];
  }

  static fromArray(data: ChartCellValue[][]): ObjectCellAccessor {
    const obj: Record<string, ChartCellValue> = {};
    for (let row = 0; row < data.length; row++) {
      for (let col = 0; col < data[row].length; col++) {
        const key = `${colToLetter(col)}${row + 1}`;
        obj[key] = data[row][col];
      }
    }
    return new ObjectCellAccessor(obj);
  }
}
