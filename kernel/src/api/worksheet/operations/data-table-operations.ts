/**
 * Data Table Operations Module
 *
 * Standalone functions for What-If Data Table evaluation.
 *
 * RESPONSIBILITIES:
 * - dataTable: Evaluate a formula with different input values across a grid
 *
 * ARCHITECTURE:
 * - Takes (ctx: DocumentContext, sheetId: string) as first two params
 * - Resolves A1 addresses to CellIds, calls ComputeBridge.dataTable()
 * - Returns contract DataTableResult
 */

import type { CellValue, SheetId } from '@mog-sdk/contracts/core';
import type {
  CreateDataTableOptions,
  CreateDataTableResult,
  DataTableResult,
} from '@mog-sdk/contracts/what-if';
import { KernelError } from '../../../errors';
import type { DocumentContext } from '../../../context';
import { parseCellRange, rangeToA1 } from '../../internal/utils';
import { resolveCell } from '../../internal/address-resolver';
import * as CellOps from './cell-operations';

function decodeCreateDataTableResult(data: unknown): CreateDataTableResult {
  const result = data as Partial<CreateDataTableResult> | undefined;
  if (
    !result ||
    typeof result.regionId !== 'string' ||
    typeof result.tableRange !== 'string' ||
    typeof result.bodyRange !== 'string' ||
    typeof result.rowsComputed !== 'number' ||
    typeof result.colsComputed !== 'number' ||
    typeof result.cellCount !== 'number'
  ) {
    throw new KernelError('COMPUTE_ERROR', 'Rust response missing CreateDataTableResult.');
  }
  return {
    regionId: result.regionId,
    tableRange: result.tableRange,
    bodyRange: result.bodyRange,
    rowInputCell: result.rowInputCell ?? null,
    colInputCell: result.colInputCell ?? null,
    rowsComputed: result.rowsComputed,
    colsComputed: result.colsComputed,
    cellCount: result.cellCount,
  };
}

/**
 * Evaluate a formula with different input values (What-If Data Table).
 *
 * One-variable table: provide either rowInputCell or colInputCell (not both).
 * Two-variable table: provide both rowInputCell and colInputCell.
 * Input cells must already contain a value.
 */
export async function dataTable(
  ctx: DocumentContext,
  sheetId: SheetId,
  formulaCell: string,
  options: {
    rowInputCell?: string | null;
    colInputCell?: string | null;
    rowValues: (string | number | boolean | null)[];
    colValues: (string | number | boolean | null)[];
  },
): Promise<DataTableResult> {
  // Resolve formula cell A1 → CellId
  const formulaPos = resolveCell(formulaCell);
  const formulaCellId = await CellOps.getCellIdAt(ctx, sheetId, formulaPos.row, formulaPos.col);
  if (!formulaCellId) {
    throw new KernelError('COMPUTE_ERROR', `Formula cell ${formulaCell} has no content.`);
  }

  // Resolve row input cell (optional)
  let rowInputCellId: string | null = null;
  if (options.rowInputCell) {
    const pos = resolveCell(options.rowInputCell);
    const cid = await CellOps.getCellIdAt(ctx, sheetId, pos.row, pos.col);
    if (!cid) {
      throw new KernelError(
        'COMPUTE_ERROR',
        `Row input cell ${options.rowInputCell} must contain a value before calling dataTable().`,
      );
    }
    rowInputCellId = cid;
  }

  // Resolve column input cell (optional)
  let colInputCellId: string | null = null;
  if (options.colInputCell) {
    const pos = resolveCell(options.colInputCell);
    const cid = await CellOps.getCellIdAt(ctx, sheetId, pos.row, pos.col);
    if (!cid) {
      throw new KernelError(
        'COMPUTE_ERROR',
        `Column input cell ${options.colInputCell} must contain a value before calling dataTable().`,
      );
    }
    colInputCellId = cid;
  }

  // Call bridge with wire-type params (snake_case)
  const bridgeResult = await ctx.computeBridge.dataTable({
    formula_cell: formulaCellId,
    row_input_cell: rowInputCellId,
    col_input_cell: colInputCellId,
    row_values: options.rowValues as CellValue[],
    col_values: options.colValues as CellValue[],
  });

  // The NAPI transport normalises snake_case wire fields to camelCase at
  // runtime, so cast to the camelCase shape to access properties safely.
  const result = bridgeResult as unknown as {
    results: CellValue[][];
    cellCount: number;
    cancelled: boolean;
  };

  return {
    results: result.results,
    cellCount: result.cellCount ?? 0,
    elapsedMs: 0,
    cancelled: result.cancelled ?? false,
  };
}

/**
 * Create a persistent What-If Data Table region.
 */
export async function createDataTable(
  ctx: DocumentContext,
  sheetId: SheetId,
  options: CreateDataTableOptions,
): Promise<CreateDataTableResult> {
  const range = parseCellRange(options.tableRange);
  if (!range) {
    throw new KernelError('API_INVALID_RANGE', `Invalid Data Table range: ${options.tableRange}`);
  }
  const startRow = Math.min(range.startRow, range.endRow);
  const startCol = Math.min(range.startCol, range.endCol);
  const endRow = Math.max(range.startRow, range.endRow);
  const endCol = Math.max(range.startCol, range.endCol);
  const tableRange = rangeToA1({ sheetId, startRow, startCol, endRow, endCol });

  const bridgeResult = await ctx.computeBridge.createDataTable(
    sheetId,
    startRow,
    startCol,
    endRow,
    endCol,
    {
      sheetId,
      tableRange,
      rowInputCell: options.rowInputCell ?? null,
      colInputCell: options.colInputCell ?? null,
    },
  );

  return decodeCreateDataTableResult(bridgeResult.data);
}
