import type { CellError, CellValue } from '@mog-sdk/contracts/core';
import { errorDisplayString } from '@mog/spreadsheet-utils/errors';
import type { ColumnTypeKind } from './types';

export type ClipboardInputCellValue = CellValue | Date | undefined;

export function isClipboardCellError(value: unknown): value is CellError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'error' &&
    'value' in value &&
    typeof value.value === 'string'
  );
}

export function toClipboardCellValue(value: ClipboardInputCellValue): CellValue {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  return value;
}

export function toClipboardCellValues(
  values: readonly (readonly ClipboardInputCellValue[])[],
): CellValue[][] {
  return values.map((row) => row.map((value) => toClipboardCellValue(value)));
}

export function clipboardCellValueToText(value: CellValue | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  if (isClipboardCellError(value)) {
    return errorDisplayString(value.value);
  }
  return String(value);
}

export function fromClipboardCellValue(
  value: ClipboardInputCellValue,
  targetType?: ColumnTypeKind,
): CellValue {
  const normalized = toClipboardCellValue(value);

  if (normalized === null || isClipboardCellError(normalized)) {
    return normalized;
  }

  switch (targetType) {
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
    case 'person':
    case 'file':
    case 'relation':
    case 'lookup':
    case 'rollup':
    case 'formula':
    case 'createdBy':
    case 'modifiedBy':
      return String(normalized);

    case 'number':
    case 'rating':
    case 'progress':
    case 'autoNumber': {
      if (typeof normalized === 'number') {
        return normalized;
      }
      const parsed = parseFloat(String(normalized));
      return Number.isNaN(parsed) ? null : parsed;
    }

    case 'checkbox': {
      if (typeof normalized === 'boolean') {
        return normalized;
      }
      const text = String(normalized).toLowerCase();
      if (text === 'true' || text === '1' || text === 'yes') {
        return true;
      }
      if (text === 'false' || text === '0' || text === 'no' || text === '') {
        return false;
      }
      return null;
    }

    case 'date':
    case 'createdTime':
    case 'modifiedTime':
      if (typeof normalized === 'number') {
        return normalized;
      }
      if (typeof normalized === 'string') {
        const parsed = new Date(normalized);
        return Number.isNaN(parsed.getTime()) ? null : normalized;
      }
      return null;

    case 'select':
      return String(normalized);

    default:
      return normalized;
  }
}
