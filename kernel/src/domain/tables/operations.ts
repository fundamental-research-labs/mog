/**
 * Tables Operations Module
 *
 * Table operations: resize, total row, rename.
 * Delegates to ComputeBridge for all mutations.
 *
 */

import type { CellRange } from '@mog-sdk/contracts/core';
import type { TotalFunction } from '@mog-sdk/contracts/tables';
import type { DocumentContext } from '../../context/types';
import { KernelError } from '../../errors';
// Import from sibling modules
import { getTable, isValidTableName, validateTableResize } from './core';
// Export validation result type for consumers
export type { TableResizeValidation } from './core';
// Import for rename operations and #REF! propagation
import {
  propagateRefErrorForColumnDelete,
  updateFormulasForColumnRename,
  updateFormulasForTableRename,
} from '../formulas/structured-ref-updater';

// =============================================================================
// Table Operations
// =============================================================================

/**
 * Resize table to a new range.
 *
 * Validates resize before applying (overlap, minimum rows).
 */
export async function resizeTable(
  ctx: DocumentContext,
  tableId: string,
  newRange: CellRange,
): Promise<void> {
  const existing = await getTable(ctx, tableId);
  if (!existing) return;

  // Validate resize before applying
  const validation = await validateTableResize(ctx, tableId, newRange);
  if (!validation.valid) {
    throw new KernelError('TABLE_INVALID_RESIZE', validation.error ?? 'Invalid table resize');
  }

  await ctx.computeBridge.resizeTable(
    existing.name,
    newRange.startRow,
    newRange.startCol,
    newRange.endRow,
    newRange.endCol,
  );
}

/**
 * Enable or disable the total row.
 */
export async function setTotalRow(
  ctx: DocumentContext,
  tableId: string,
  enabled: boolean,
): Promise<void> {
  const existing = await getTable(ctx, tableId);
  if (!existing) return;

  // Only toggle if the state is actually changing
  if (existing.hasTotalRow !== enabled) {
    await ctx.computeBridge.toggleTotalsRow(existing.name);
  }
}

/**
 * Set total row function for a column.
 *
 * Note: In the ComputeBridge world, total functions are managed as part of
 * calculated columns. This updates the table via ComputeBridge.
 */
export async function setColumnTotalFunction(
  ctx: DocumentContext,
  tableId: string,
  columnIndex: number,
  fn: TotalFunction,
): Promise<void> {
  const existing = await getTable(ctx, tableId);
  if (!existing) return;

  if (columnIndex < 0 || columnIndex >= existing.columns.length) return;

  // Generate the SUBTOTAL formula
  const subtotalFunctionNumber: Record<string, number> = {
    average: 101,
    count: 102,
    countNums: 103,
    max: 104,
    min: 105,
    stdDev: 107,
    sum: 109,
    var: 110,
  };

  const funcNum = subtotalFunctionNumber[fn];
  if (!funcNum && fn !== 'none') return;

  const formula =
    fn !== 'none' ? `=SUBTOTAL(${funcNum},[${existing.columns[columnIndex].name}])` : '';

  // Use setCalculatedColumnFormula for the total row formula
  await ctx.computeBridge.setCalculatedColumnFormula(existing.name, columnIndex, formula);
}

/**
 * Rename a table.
 *
 * Also updates all formulas referencing this table.
 */
export async function renameTable(
  ctx: DocumentContext,
  tableId: string,
  newName: string,
): Promise<void> {
  if (!(await isValidTableName(ctx, newName, tableId))) {
    throw new KernelError(
      'TABLE_INVALID_NAME',
      `Table name "${newName}" is invalid or already exists`,
    );
  }

  const existing = await getTable(ctx, tableId);
  if (!existing) return;

  const oldName = existing.name;

  await ctx.computeBridge.renameTable(oldName, newName);

  // Update all formulas that reference this table
  const updatedFormulaCount = updateFormulasForTableRename(ctx, oldName, newName);
  if (updatedFormulaCount > 0) {
    console.log(
      `[tables] Updated ${updatedFormulaCount} formulas after renaming table "${oldName}" to "${newName}"`,
    );
  }
}

/**
 * Rename a column in a table.
 *
 * Also updates all formulas referencing this column.
 */
export async function renameColumn(
  ctx: DocumentContext,
  tableId: string,
  columnIndex: number,
  newName: string,
): Promise<void> {
  const existing = await getTable(ctx, tableId);
  if (!existing) return;

  if (columnIndex < 0 || columnIndex >= existing.columns.length) return;

  const oldName = existing.columns[columnIndex].name;
  const tableName = existing.name;

  await ctx.computeBridge.renameTableColumn(tableName, columnIndex, newName);

  // Update all formulas that reference this column
  const updatedFormulaCount = updateFormulasForColumnRename(ctx, tableName, oldName, newName);
  if (updatedFormulaCount > 0) {
    console.log(
      `[tables] Updated ${updatedFormulaCount} formulas after renaming column "${oldName}" to "${newName}" in table "${tableName}"`,
    );
  }
}

/**
 * Delete a column from a table.
 *
 * Propagates #REF! errors to formulas referencing this column.
 *
 * @returns Number of formulas updated to #REF!
 */
export async function deleteTableColumn(
  ctx: DocumentContext,
  tableId: string,
  columnIndex: number,
): Promise<number> {
  const existing = await getTable(ctx, tableId);
  if (!existing) return 0;

  if (columnIndex < 0 || columnIndex >= existing.columns.length) return 0;

  const deletedColumnName = existing.columns[columnIndex].name;
  const tableName = existing.name;

  // Propagate #REF! errors BEFORE removing the column
  const affectedFormulaCount = propagateRefErrorForColumnDelete(ctx, tableName, deletedColumnName);
  if (affectedFormulaCount > 0) {
    console.log(
      `[tables] Propagated #REF! to ${affectedFormulaCount} formulas after deleting column "${deletedColumnName}" from table "${tableName}"`,
    );
  }

  await ctx.computeBridge.removeTableColumn(tableName, columnIndex);

  return affectedFormulaCount;
}
