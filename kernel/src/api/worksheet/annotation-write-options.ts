import type { CellAnnotationWriteOptions, RangeWriteOptions } from '@mog-sdk/contracts/api';
import { MAX_COLS, MAX_ROWS, type CellValuePrimitive } from '@mog-sdk/contracts/core';

import { KernelError } from '../../errors';
import { parseCellAddress } from '../internal/utils';
import { normalizeFormulaGrid, type NormalizedSetCellsEntry } from './formula-api-helpers';

type WorksheetRangeValueInput =
  | CellValuePrimitive
  | Date
  | {
      readonly value: CellValuePrimitive | Date;
      readonly annotation?: string | null;
    };

type WorksheetRangeFormulaInput =
  | string
  | {
      readonly formula: string;
      readonly annotation?: string | null;
    };

export type CellAnnotationTarget = {
  readonly row: number;
  readonly col: number;
  readonly text: string;
};

export function annotationFromOptions(
  operation: string,
  options: CellAnnotationWriteOptions | undefined,
): string | undefined {
  return annotationText(operation, options?.annotation, ['options', 'annotation']);
}

export function annotationTargetsFromRangeOptions(
  operation: string,
  startRow: number,
  startCol: number,
  values: readonly (readonly unknown[])[],
  options: RangeWriteOptions | undefined,
): CellAnnotationTarget[] {
  const annotations = options?.annotations;
  if (annotations === undefined) return [];
  if (!Array.isArray(annotations)) {
    throw new KernelError(
      'API_INVALID_ARGUMENT',
      `${operation}: options.annotations must be a 2D array matching the written values.`,
      {
        path: ['options', 'annotations'],
        suggestion:
          'Pass annotations with the same row/column shape as the values or formulas matrix.',
      },
    );
  }
  if (annotations.length !== values.length) {
    throw new KernelError(
      'API_INVALID_ARGUMENT',
      `${operation}: options.annotations row count must match the written values.`,
      {
        path: ['options', 'annotations'],
        context: {
          expectedRows: values.length,
          receivedRows: annotations.length,
        },
      },
    );
  }

  const targets: CellAnnotationTarget[] = [];
  for (let r = 0; r < values.length; r++) {
    const valueRow = values[r];
    const annotationRow = annotations[r];
    if (!Array.isArray(annotationRow) || annotationRow.length !== valueRow.length) {
      throw new KernelError(
        'API_INVALID_ARGUMENT',
        `${operation}: each options.annotations row must match the corresponding written row length.`,
        {
          path: ['options', 'annotations', String(r)],
          context: {
            expectedColumns: valueRow.length,
            receivedColumns: Array.isArray(annotationRow) ? annotationRow.length : undefined,
          },
        },
      );
    }
    for (let c = 0; c < valueRow.length; c++) {
      const text = annotationText(operation, annotationRow[c], [
        'options',
        'annotations',
        String(r),
        String(c),
      ]);
      if (text !== undefined) {
        targets.push({ row: startRow + r, col: startCol + c, text });
      }
    }
  }
  return targets;
}

export function normalizeRangeWriteValues(
  operation: string,
  startRow: number,
  startCol: number,
  input: readonly (readonly WorksheetRangeValueInput[])[],
  options: RangeWriteOptions | undefined,
): {
  values: Array<Array<CellValuePrimitive | Date>>;
  annotationTargets: CellAnnotationTarget[];
} {
  const pending = targetMap(
    annotationTargetsFromRangeOptions(operation, startRow, startCol, input, options),
  );
  const values = input.map((row, rowIndex) =>
    row.map((entry, colIndex) => {
      if (!isAnnotatedValueInput(entry)) return entry;
      const text = annotationText(operation, entry.annotation, [
        'values',
        String(rowIndex),
        String(colIndex),
        'annotation',
      ]);
      if (text !== undefined) {
        const row = startRow + rowIndex;
        const col = startCol + colIndex;
        pending.set(`${row},${col}`, { row, col, text });
      }
      return entry.value;
    }),
  );
  return { values, annotationTargets: [...pending.values()] };
}

export function normalizeRangeFormulaValues(
  operation: string,
  startRow: number,
  startCol: number,
  input: unknown,
  options: RangeWriteOptions | undefined,
): {
  values: string[][];
  annotationTargets: CellAnnotationTarget[];
} {
  if (!containsAnnotatedFormulaInput(input)) {
    const values = normalizeFormulaGrid(input, operation);
    return {
      values,
      annotationTargets: annotationTargetsFromRangeOptions(
        operation,
        startRow,
        startCol,
        values,
        options,
      ),
    };
  }

  const extracted = extractFormulaGrid(input) as unknown[][];
  const values = normalizeFormulaGrid(extracted, operation);
  const pending = targetMap(
    annotationTargetsFromRangeOptions(operation, startRow, startCol, values, options),
  );

  for (let rowIndex = 0; rowIndex < extracted.length; rowIndex++) {
    const row = inputRow(input, rowIndex);
    if (!row) continue;
    for (let colIndex = 0; colIndex < row.length; colIndex++) {
      const entry = row[colIndex];
      if (!isAnnotatedFormulaInput(entry)) continue;
      const text = annotationText(operation, entry.annotation, [
        'formulas',
        String(rowIndex),
        String(colIndex),
        'annotation',
      ]);
      if (text !== undefined) {
        const row = startRow + rowIndex;
        const col = startCol + colIndex;
        pending.set(`${row},${col}`, { row, col, text });
      }
    }
  }

  return { values, annotationTargets: [...pending.values()] };
}

export function annotationTargetsFromSetCells(
  operation: string,
  cells: readonly NormalizedSetCellsEntry[],
): CellAnnotationTarget[] {
  const pending = new Map<string, CellAnnotationTarget>();
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const text = annotationText(operation, cell.annotation, ['cells', String(i), 'annotation']);
    const position = setCellsEntryPosition(cell);
    if (!position) continue;

    const key = `${position.row},${position.col}`;
    if (text === undefined) {
      pending.delete(key);
    } else {
      pending.set(key, { ...position, text });
    }
  }
  return [...pending.values()];
}

function annotationText(
  operation: string,
  value: unknown,
  path: readonly string[],
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new KernelError(
      'API_INVALID_ARGUMENT',
      `${operation}: annotation must be a string when provided.`,
      {
        path: [...path],
        suggestion: 'Pass annotation text as a string, or omit the annotation field.',
        context: {
          validationKind: 'invalidAnnotationText',
          operation,
          expected: 'string',
          received: typeof value,
        },
      },
    );
  }
  return value;
}

function targetMap(targets: readonly CellAnnotationTarget[]): Map<string, CellAnnotationTarget> {
  return new Map(targets.map((target) => [`${target.row},${target.col}`, target]));
}

function isAnnotatedValueInput(
  value: WorksheetRangeValueInput,
): value is Extract<WorksheetRangeValueInput, { readonly value: CellValuePrimitive | Date }> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !(value instanceof Date) &&
    Object.prototype.hasOwnProperty.call(value, 'value')
  );
}

function isAnnotatedFormulaInput(
  value: unknown,
): value is Extract<WorksheetRangeFormulaInput, { readonly formula: string }> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.prototype.hasOwnProperty.call(value, 'formula')
  );
}

function containsAnnotatedFormulaInput(input: unknown): boolean {
  return (
    Array.isArray(input) &&
    input.some((row) => Array.isArray(row) && row.some((entry) => isAnnotatedFormulaInput(entry)))
  );
}

function extractFormulaGrid(input: unknown): unknown {
  if (!Array.isArray(input)) return input;
  return input.map((row) => {
    if (!Array.isArray(row)) return row;
    return row.map((entry) => (isAnnotatedFormulaInput(entry) ? entry.formula : entry));
  });
}

function inputRow(input: unknown, rowIndex: number): readonly unknown[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const row = input[rowIndex];
  return Array.isArray(row) ? row : undefined;
}

function setCellsEntryPosition(
  cell: NormalizedSetCellsEntry,
): { row: number; col: number } | undefined {
  const addr = cell.addr ?? cell.address;
  if (addr !== undefined) {
    const parsed = parseCellAddress(addr);
    return parsed ?? undefined;
  }
  if (
    typeof cell.row !== 'number' ||
    typeof cell.col !== 'number' ||
    !Number.isInteger(cell.row) ||
    !Number.isInteger(cell.col) ||
    cell.row < 0 ||
    cell.row >= MAX_ROWS ||
    cell.col < 0 ||
    cell.col >= MAX_COLS
  ) {
    return undefined;
  }
  return { row: cell.row, col: cell.col };
}
