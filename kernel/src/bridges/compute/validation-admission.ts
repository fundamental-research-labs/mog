import type { SheetId } from '@mog-sdk/contracts/core';

import { KernelError } from '../../errors';
import type { CellInput, CellValidationResult, RangeSchema } from './compute-types.gen';
import type { PositionedCellInput } from './table-header-write-intercept';

interface ValidationAdmissionBridge {
  getRangeSchemasForSheet(sheetId: SheetId): Promise<RangeSchema[]>;
  getAllColumnSchemas(sheetId: SheetId): Promise<Array<[number, unknown]>>;
  validateCellValueInDoc(
    sheetId: SheetId,
    row: number,
    col: number,
    value: string,
  ): Promise<CellValidationResult>;
}

interface ValidationAdmissionEdit {
  row: number;
  col: number;
  value: string;
}

function validationTextForCellInput(input: CellInput): string | null {
  switch (input.kind) {
    case 'clear':
      return '';
    case 'literal':
      return input.text;
    case 'parse': {
      const trimmed = input.text.trim();
      if (trimmed.startsWith('=')) {
        return null;
      }
      if (trimmed.startsWith("'")) {
        return trimmed.slice(1);
      }
      return input.text;
    }
    case 'value': {
      const value = input.value as unknown;
      if (value == null) return '';
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
      }
      return null;
    }
  }
}

function parseValidationRefId(id: string): { row: number; col: number } | null {
  const colonIdx = id.indexOf(':');
  if (colonIdx > 0) {
    const row = Number.parseInt(id.slice(0, colonIdx), 10);
    const col = Number.parseInt(id.slice(colonIdx + 1), 10);
    return Number.isFinite(row) && Number.isFinite(col) && row >= 0 && col >= 0
      ? { row, col }
      : null;
  }

  if (!id.startsWith('cell-')) return null;
  const parts = id.split('-');
  if (parts.length < 4) return null;
  const row = Number.parseInt(parts[parts.length - 2]!, 10);
  const col = Number.parseInt(parts[parts.length - 1]!, 10);
  return Number.isFinite(row) && Number.isFinite(col) && row >= 0 && col >= 0 ? { row, col } : null;
}

function rangeSchemaCoversCell(
  schema: RangeSchema,
  sheetId: SheetId,
  row: number,
  col: number,
): boolean {
  return schema.ranges.some((range) => {
    if (range.sheetId != null && range.sheetId !== String(sheetId)) return false;
    const start = parseValidationRefId(range.startId);
    const end = parseValidationRefId(range.endId);
    if (!start || !end) return false;
    const minRow = Math.min(start.row, end.row);
    const maxRow = Math.max(start.row, end.row);
    const minCol = Math.min(start.col, end.col);
    const maxCol = Math.max(start.col, end.col);
    return row >= minRow && row <= maxRow && col >= minCol && col <= maxCol;
  });
}

export async function assertStrictValidationAdmission(
  bridge: ValidationAdmissionBridge,
  sheetId: SheetId,
  edits: readonly PositionedCellInput[],
): Promise<void> {
  const finalEdits = new Map<string, ValidationAdmissionEdit>();
  for (const edit of edits) {
    const value = validationTextForCellInput(edit.input);
    if (value == null) continue;
    finalEdits.set(`${edit.row}:${edit.col}`, { row: edit.row, col: edit.col, value });
  }
  if (finalEdits.size === 0) return;

  const [rangeSchemas, columnSchemas] = await Promise.all([
    bridge.getRangeSchemasForSheet(sheetId),
    bridge.getAllColumnSchemas(sheetId),
  ]);
  const validationColumns = new Set(columnSchemas.map(([col]) => col));
  if (rangeSchemas.length === 0 && validationColumns.size === 0) return;

  for (const edit of finalEdits.values()) {
    const covered =
      validationColumns.has(edit.col) ||
      rangeSchemas.some((schema) => rangeSchemaCoversCell(schema, sheetId, edit.row, edit.col));
    if (!covered) continue;

    const result = await bridge.validateCellValueInDoc(sheetId, edit.row, edit.col, edit.value);
    if (!result.valid && result.enforcement === 'strict') {
      throw KernelError.from(
        null,
        'API_INVALID_ARGUMENT',
        result.errorMessage ?? 'Cell value violates strict data validation.',
        {
          context: {
            sheetId,
            row: edit.row,
            col: edit.col,
            validationEnforcement: result.enforcement,
            validationErrorTitle: result.errorTitle,
          },
        },
      );
    }
  }
}
