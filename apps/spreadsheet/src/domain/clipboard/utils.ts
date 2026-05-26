/**
 * Clipboard Utilities
 *
 * Helper functions for clipboard operations.
 */

import type { CellFormat, CellValue } from '@mog-sdk/contracts/core';
import { toColId } from '@mog-sdk/contracts/cell-identity';
import type { ClipboardPayload, ColumnSchema, ColumnTypeKind } from './types';
import { fromClipboardCellValue } from './cell-value-contract';

// =============================================================================
// Payload Inspection
// =============================================================================

/**
 * Check if a ClipboardPayload has cell data.
 */
export function hasClipboardData(payload: ClipboardPayload | null): payload is ClipboardPayload {
  return payload !== null && payload.cells.rowCount > 0 && payload.cells.colCount > 0;
}

/**
 * Check if a ClipboardPayload has table context.
 */
export function hasTableContext(
  payload: ClipboardPayload,
): payload is ClipboardPayload & { tableContext: NonNullable<ClipboardPayload['tableContext']> } {
  return payload.tableContext !== undefined && payload.tableContext.rowIds.length > 0;
}

/**
 * Get the dimensions of clipboard data.
 */
export function getClipboardDimensions(payload: ClipboardPayload): { rows: number; cols: number } {
  return {
    rows: payload.cells.rowCount,
    cols: payload.cells.colCount,
  };
}

/**
 * Check if clipboard data is from the same table.
 */
export function isSameTable(payload: ClipboardPayload, tableId: string): boolean {
  return payload.tableContext?.tableId === tableId;
}

/**
 * Check if clipboard is from same view type.
 */
export function isSameViewType(payload: ClipboardPayload, viewType: string): boolean {
  return payload.source.viewType === viewType;
}

// =============================================================================
// Data Transformation
// =============================================================================

/**
 * Transpose clipboard data (swap rows and columns).
 */
export function transposePayload(payload: ClipboardPayload): ClipboardPayload {
  const { values, formats, rowCount, colCount } = payload.cells;

  const transposedValues: CellValue[][] = [];
  const transposedFormats: (Partial<CellFormat> | null)[][] | undefined = formats ? [] : undefined;

  for (let col = 0; col < colCount; col++) {
    const newRow: CellValue[] = [];
    const newFormatRow: (Partial<CellFormat> | null)[] = [];

    for (let row = 0; row < rowCount; row++) {
      newRow.push(values[row]?.[col] ?? null);
      if (formats) {
        newFormatRow.push(formats[row]?.[col] ?? null);
      }
    }

    transposedValues.push(newRow);
    if (transposedFormats) {
      transposedFormats.push(newFormatRow);
    }
  }

  // Note: tableContext is invalidated on transpose (column order changes)
  return {
    ...payload,
    cells: {
      values: transposedValues,
      formats: transposedFormats,
      rowCount: colCount,
      colCount: rowCount,
    },
    tableContext: undefined, // Transpose invalidates table context
  };
}

/**
 * Extract a single row from clipboard data.
 */
export function extractRow(payload: ClipboardPayload, rowIndex: number): CellValue[] {
  if (rowIndex < 0 || rowIndex >= payload.cells.rowCount) {
    return [];
  }
  return [...(payload.cells.values[rowIndex] ?? [])];
}

/**
 * Extract a single column from clipboard data.
 */
export function extractColumn(payload: ClipboardPayload, colIndex: number): CellValue[] {
  if (colIndex < 0 || colIndex >= payload.cells.colCount) {
    return [];
  }
  return payload.cells.values.map((row) => row[colIndex] ?? null);
}

/**
 * Extract a rectangular region from clipboard data.
 */
export function extractRegion(
  payload: ClipboardPayload,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
): CellValue[][] {
  const result: CellValue[][] = [];

  for (let row = startRow; row <= endRow && row < payload.cells.rowCount; row++) {
    const rowValues: CellValue[] = [];
    for (let col = startCol; col <= endCol && col < payload.cells.colCount; col++) {
      rowValues.push(payload.cells.values[row]?.[col] ?? null);
    }
    result.push(rowValues);
  }

  return result;
}

// =============================================================================
// Column Type Utilities
// =============================================================================

/**
 * Get column schema by column ID from table context.
 */
export function getColumnSchema(
  payload: ClipboardPayload,
  colId: string,
): ColumnSchema | undefined {
  return payload.tableContext?.columnSchemas.find((schema) => schema.id === colId);
}

/**
 * Get column index in clipboard by column ID.
 */
export function getColumnIndex(payload: ClipboardPayload, colId: string): number {
  if (!payload.tableContext) {
    return -1;
  }
  return payload.tableContext.colIds.indexOf(toColId(colId));
}

/**
 * Map column values by column type for type-aware paste.
 */
export function mapColumnsByType(
  payload: ClipboardPayload,
  targetSchemas: ColumnSchema[],
): Map<string, CellValue[]> {
  const result = new Map<string, CellValue[]>();

  if (!payload.tableContext) {
    return result;
  }

  // Create a map of source columns by name
  const sourceByName = new Map<string, number>();
  payload.tableContext.columnSchemas.forEach((schema, index) => {
    sourceByName.set(schema.name.toLowerCase(), index);
  });

  // Map target columns to source columns by name
  for (const targetSchema of targetSchemas) {
    const sourceIndex = sourceByName.get(targetSchema.name.toLowerCase());
    if (sourceIndex !== undefined && sourceIndex < payload.cells.colCount) {
      const values = extractColumn(payload, sourceIndex);
      result.set(targetSchema.id, values);
    }
  }

  return result;
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Check if clipboard data fits in target region.
 */
export function fitsInRegion(
  payload: ClipboardPayload,
  targetRows: number,
  targetCols: number,
): boolean {
  return payload.cells.rowCount <= targetRows && payload.cells.colCount <= targetCols;
}

/**
 * Check if paste would overflow sheet bounds.
 */
export function wouldOverflow(
  payload: ClipboardPayload,
  startRow: number,
  startCol: number,
  maxRows: number,
  maxCols: number,
): boolean {
  return startRow + payload.cells.rowCount > maxRows || startCol + payload.cells.colCount > maxCols;
}

/**
 * Check if a column type is compatible for paste.
 */
export function isTypeCompatible(sourceType: ColumnTypeKind, targetType: ColumnTypeKind): boolean {
  // Same type is always compatible
  if (sourceType === targetType) {
    return true;
  }

  // Text can accept anything
  if (targetType === 'text') {
    return true;
  }

  // Number can accept number-like types
  if (targetType === 'number') {
    return ['number', 'rating', 'progress', 'autoNumber'].includes(sourceType);
  }

  // Date types are compatible
  if (targetType === 'date') {
    return ['date', 'createdTime', 'modifiedTime'].includes(sourceType);
  }

  // Checkbox can accept boolean-like values
  if (targetType === 'checkbox') {
    return sourceType === 'checkbox';
  }

  // By default, treat as incompatible (will be converted to string)
  return false;
}

// =============================================================================
// Value Conversion
// =============================================================================

/**
 * Convert a value for a target column type.
 * Returns null if conversion fails.
 */
export function convertValueForType(value: CellValue, targetType: ColumnTypeKind): CellValue {
  return fromClipboardCellValue(value, targetType);
}

/**
 * Convert all values in clipboard for target column schemas.
 */
export function convertPayloadForSchema(
  payload: ClipboardPayload,
  targetSchemas: ColumnSchema[],
): CellValue[][] {
  const result: CellValue[][] = [];

  for (let row = 0; row < payload.cells.rowCount; row++) {
    const rowValues: CellValue[] = [];

    for (let col = 0; col < targetSchemas.length && col < payload.cells.colCount; col++) {
      const sourceValue = payload.cells.values[row]?.[col] ?? null;
      const targetType = targetSchemas[col].kind;
      rowValues.push(convertValueForType(sourceValue, targetType));
    }

    result.push(rowValues);
  }

  return result;
}
