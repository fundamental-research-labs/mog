import type { CellData, CellRange, CellValue, CellValuePrimitive } from '@mog-sdk/contracts/core';
import { toA1, toSheetA1 } from '@mog/spreadsheet-utils/a1';
import { normalizeRange } from '@mog/spreadsheet-utils/range';

export type ConsolidateFunction =
  | 'sum'
  | 'count'
  | 'average'
  | 'max'
  | 'min'
  | 'product'
  | 'countNumbers'
  | 'stdDev'
  | 'stdDevP'
  | 'var'
  | 'varP';

export interface ConsolidateSourceRange {
  reference: string;
  range: CellRange;
  cells: CellData[][];
  sheetName?: string;
  qualifyFormulas?: boolean;
}

export interface ConsolidateBuildOptions {
  func: ConsolidateFunction;
  sources: ConsolidateSourceRange[];
  useTopRowLabels: boolean;
  useLeftColumnLabels: boolean;
  createLinks: boolean;
}

export interface ConsolidateBuildResult {
  values: CellValuePrimitive[][];
}

interface AxisEntry {
  key: string;
  label: string;
}

interface Bucket {
  values: CellValue[];
  refs: string[];
}

const FORMULA_FUNCTIONS: Record<ConsolidateFunction, string> = {
  sum: 'SUM',
  count: 'COUNTA',
  average: 'AVERAGE',
  max: 'MAX',
  min: 'MIN',
  product: 'PRODUCT',
  countNumbers: 'COUNT',
  stdDev: 'STDEV.S',
  stdDevP: 'STDEV.P',
  var: 'VAR.S',
  varP: 'VAR.P',
};

export function buildConsolidateOutput(options: ConsolidateBuildOptions): ConsolidateBuildResult {
  const rowEntries: AxisEntry[] = [];
  const colEntries: AxisEntry[] = [];
  const rowIndexes = new Map<string, number>();
  const colIndexes = new Map<string, number>();
  const buckets = new Map<string, Bucket>();

  for (const source of options.sources) {
    const range = normalizeRange(source.range);
    const height = range.endRow - range.startRow + 1;
    const width = range.endCol - range.startCol + 1;
    const dataStartRowOffset = options.useTopRowLabels ? 1 : 0;
    const dataStartColOffset = options.useLeftColumnLabels ? 1 : 0;

    for (let rowOffset = dataStartRowOffset; rowOffset < height; rowOffset++) {
      const rowEntry = axisEntryForRow(source, rowOffset, options.useLeftColumnLabels);
      const rowIndex = ensureAxisEntry(rowEntry, rowEntries, rowIndexes);

      for (let colOffset = dataStartColOffset; colOffset < width; colOffset++) {
        const colEntry = axisEntryForCol(source, colOffset, options.useTopRowLabels);
        const colIndex = ensureAxisEntry(colEntry, colEntries, colIndexes);
        const bucketKey = `${rowIndex}:${colIndex}`;
        const bucket = buckets.get(bucketKey) ?? { values: [], refs: [] };
        const cell = source.cells[rowOffset]?.[colOffset];
        bucket.values.push(cell?.value ?? null);
        bucket.refs.push(
          formatSourceRef(source, range.startRow + rowOffset, range.startCol + colOffset),
        );
        buckets.set(bucketKey, bucket);
      }
    }
  }

  const headerRows = options.useTopRowLabels ? 1 : 0;
  const headerCols = options.useLeftColumnLabels ? 1 : 0;
  const rowCount = headerRows + rowEntries.length;
  const colCount = headerCols + colEntries.length;
  const values: CellValuePrimitive[][] = Array.from({ length: rowCount }, () =>
    Array.from({ length: colCount }, () => ''),
  );

  if (options.useTopRowLabels) {
    for (let col = 0; col < colEntries.length; col++) {
      values[0][headerCols + col] = colEntries[col].label;
    }
  }
  if (options.useLeftColumnLabels) {
    for (let row = 0; row < rowEntries.length; row++) {
      values[headerRows + row][0] = rowEntries[row].label;
    }
  }

  for (let row = 0; row < rowEntries.length; row++) {
    for (let col = 0; col < colEntries.length; col++) {
      const bucket = buckets.get(`${row}:${col}`);
      values[headerRows + row][headerCols + col] = bucket
        ? buildBucketValue(options.func, bucket, options.createLinks)
        : '';
    }
  }

  return { values };
}

function axisEntryForRow(
  source: ConsolidateSourceRange,
  rowOffset: number,
  useLeftColumnLabels: boolean,
): AxisEntry {
  if (!useLeftColumnLabels) {
    return { key: `position:${rowOffset}`, label: '' };
  }
  const label = displayLabel(source.cells[rowOffset]?.[0]);
  return { key: labelKey('row', rowOffset, label), label };
}

function axisEntryForCol(
  source: ConsolidateSourceRange,
  colOffset: number,
  useTopRowLabels: boolean,
): AxisEntry {
  if (!useTopRowLabels) {
    return { key: `position:${colOffset}`, label: '' };
  }
  const label = displayLabel(source.cells[0]?.[colOffset]);
  return { key: labelKey('col', colOffset, label), label };
}

function ensureAxisEntry(
  entry: AxisEntry,
  entries: AxisEntry[],
  indexes: Map<string, number>,
): number {
  const existing = indexes.get(entry.key);
  if (existing !== undefined) return existing;
  const index = entries.length;
  entries.push(entry);
  indexes.set(entry.key, index);
  return index;
}

function labelKey(axis: 'row' | 'col', offset: number, label: string): string {
  const normalized = label.trim().toLowerCase();
  return normalized ? `label:${normalized}` : `blank:${axis}:${offset}`;
}

function displayLabel(cell: CellData | undefined): string {
  const value = cell?.value;
  if (value == null) return cell?.formatted ?? '';
  if (typeof value === 'object') return cell?.formatted ?? '';
  return String(value);
}

function formatSourceRef(source: ConsolidateSourceRange, row: number, col: number): string {
  if (source.qualifyFormulas && source.sheetName) {
    return toSheetA1(row, col, source.sheetName);
  }
  return toA1(row, col);
}

function buildBucketValue(
  func: ConsolidateFunction,
  bucket: Bucket,
  createLinks: boolean,
): CellValuePrimitive {
  if (createLinks) {
    return `=${FORMULA_FUNCTIONS[func]}(${bucket.refs.join(',')})`;
  }
  return aggregate(func, bucket.values);
}

function aggregate(func: ConsolidateFunction, values: CellValue[]): CellValuePrimitive {
  const numbers = values.map(numericValue).filter((value): value is number => value !== null);
  switch (func) {
    case 'sum':
      return numbers.reduce((sum, value) => sum + value, 0);
    case 'count':
      return values.filter(isNonEmptyValue).length;
    case 'average':
      return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : '';
    case 'max':
      return numbers.length ? Math.max(...numbers) : '';
    case 'min':
      return numbers.length ? Math.min(...numbers) : '';
    case 'product':
      return numbers.length ? numbers.reduce((product, value) => product * value, 1) : 0;
    case 'countNumbers':
      return numbers.length;
    case 'stdDev':
      return standardDeviation(numbers, true);
    case 'stdDevP':
      return standardDeviation(numbers, false);
    case 'var':
      return variance(numbers, true);
    case 'varP':
      return variance(numbers, false);
  }
}

function numericValue(value: CellValue): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function isNonEmptyValue(value: CellValue): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.length > 0;
  return true;
}

function variance(values: number[], sample: boolean): CellValuePrimitive {
  const denominator = sample ? values.length - 1 : values.length;
  if (denominator <= 0) return '';
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / denominator;
}

function standardDeviation(values: number[], sample: boolean): CellValuePrimitive {
  const result = variance(values, sample);
  return typeof result === 'number' ? Math.sqrt(result) : result;
}
