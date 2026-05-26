/**
 * Shared types and runtime utilities for SheetAPI operation modules.
 *
 * Re-exports commonly used types, error helpers, and validation utilities
 * from contracts for convenience. Named "shared" rather than "types" because
 * it includes runtime functions (error helpers, validation utils), not just types.
 */

// Re-export all types used across operation modules
export type { MergedRegion } from '@mog-sdk/contracts/api';
export type {
  CellAddress,
  CellData,
  CellFormat,
  CellRange,
  CellValue,
  CellValuePrimitive,
} from '@mog-sdk/contracts/core';
export type { Chart, ChartConfig, ChartType } from '@mog-sdk/contracts/data/charts';
export type { ApiSortOptions, SortCriterion } from '@mog-sdk/contracts/sorting';
export type { OperationResult } from '../../../errors/operation';

// Re-export error helpers (extracted from contracts to kernel/api/contracts-runtime)
export { rawToCellValue } from '@mog/spreadsheet-utils/rich-text';
export {
  chartNotFound,
  drawingNotFound,
  equationNotFound,
  invalidCellAddress,
  invalidChartConfig,
  invalidRange,
  invalidShapeConfig,
  objectNotFound,
  operationFailed,
  shapeNotFound,
  diagramNotFound,
  textEffectNotFound,
} from '../../../errors/api';

// Re-export DocumentContext type
export type { DocumentContext } from '../../../context';

// Re-export validation utilities from utils
export { isValidAddress, isValidRange } from '../../internal/utils';

// =============================================================================
// Shared Operation Helpers
// =============================================================================

import {
  isValidAddress as _isValidAddress,
  isValidRange as _isValidRange,
} from '../../internal/utils';
import {
  invalidCellAddress as _invalidCellAddress,
  invalidRange as _invalidRange,
  operationFailed as _operationFailed,
} from '../../../errors/api';

/**
 * Wrap an async operation in try/catch, returning OperationResult.
 * Eliminates repetitive try/catch + operationFailed boilerplate.
 */
export async function wrapOp<T = void>(
  name: string,
  fn: () => Promise<T>,
): Promise<import('../../../errors/operation').OperationResult<T>> {
  try {
    const data = await fn();
    return { success: true, data: data as T };
  } catch (e) {
    return { success: false, error: _operationFailed(name, String(e)) };
  }
}

/**
 * Validate a cell address; returns a failure result or null if valid.
 */
export function validateAddress(
  row: number,
  col: number,
): import('../../../errors/operation').OperationResult<never> | null {
  if (!_isValidAddress(row, col)) {
    return { success: false, error: _invalidCellAddress(row, col) };
  }
  return null;
}

/**
 * Validate a cell range; returns a failure result or null if valid.
 */
export function validateRange(
  range: import('@mog-sdk/contracts/core').CellRange,
): import('../../../errors/operation').OperationResult<never> | null {
  if (!_isValidRange(range)) {
    return {
      success: false,
      error: _invalidRange(range.startRow, range.startCol, range.endRow, range.endCol),
    };
  }
  return null;
}
