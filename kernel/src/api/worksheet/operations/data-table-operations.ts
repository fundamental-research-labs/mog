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

import type { CellRange, CellValue, CellValuePrimitive, SheetId } from '@mog-sdk/contracts/core';
import type { OperationDiagnostic, OperationEffect, SetCellsResult } from '@mog-sdk/contracts/api';
import type {
  CreateDataTableOptions,
  CreateDataTableResult,
  DataTableDescriptor,
  DataTableRefreshReceipt,
  DataTableWriteStaticValuesReceipt,
  DataTableResult,
  RefreshDataTableOptions,
  WriteDataTableValuesOptions,
} from '@mog-sdk/contracts/what-if';
import { KernelError } from '../../../errors';
import type { DocumentContext } from '../../../context';
import type { MutationAdmissionOptions } from '../../../bridges/compute';
import { parseCellRange, rangeToA1, toA1 } from '../../internal/utils';
import { resolveCell } from '../../internal/address-resolver';
import { getData } from '../../../domain/cells/cell-reads';
import * as CellOps from './cell-operations';
import * as QueryOps from './query-operations';

type CreateDataTablePayload = Pick<
  CreateDataTableResult,
  | 'regionId'
  | 'tableRange'
  | 'bodyRange'
  | 'rowInputCell'
  | 'colInputCell'
  | 'rowsComputed'
  | 'colsComputed'
  | 'cellCount'
>;

function decodeCreateDataTableResult(data: unknown): CreateDataTablePayload {
  const result = data as Partial<CreateDataTablePayload> | undefined;
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

function normalizeCellRange(sheetId: SheetId, range: CellRange): CellRange {
  const startRow = Math.min(range.startRow, range.endRow);
  const startCol = Math.min(range.startCol, range.endCol);
  const endRow = Math.max(range.startRow, range.endRow);
  const endCol = Math.max(range.startCol, range.endCol);
  return { sheetId, startRow, startCol, endRow, endCol };
}

function parseDataTableRange(sheetId: SheetId, range: string): CellRange {
  const parsed = parseCellRange(range);
  if (!parsed) {
    throw new KernelError('API_INVALID_RANGE', `Invalid Data Table range: ${range}`);
  }
  return normalizeCellRange(sheetId, { sheetId, ...parsed });
}

function elapsedNow(ctx: DocumentContext): number {
  return ctx.clock.performanceNow?.() ?? ctx.clock.now();
}

function rangeCellCount(range: CellRange): number {
  return (range.endRow - range.startRow + 1) * (range.endCol - range.startCol + 1);
}

function rangeRows(range: CellRange): number {
  return range.endRow - range.startRow + 1;
}

function rangeCols(range: CellRange): number {
  return range.endCol - range.startCol + 1;
}

function toStaticCellValue(value: CellValue | undefined): CellValuePrimitive {
  if (typeof value === 'object' && value !== null && 'type' in value && value.type === 'error') {
    return value.value;
  }
  return (value ?? null) as CellValuePrimitive;
}

function diagnosticFromSetCellError(
  sheetId: SheetId,
  error: { addr: string; error: string },
): OperationDiagnostic {
  return {
    severity: 'error',
    code: 'DATA_TABLE_STATIC_WRITE_CELL_FAILED',
    message: error.error,
    target: { sheetId, address: error.addr },
    recoverable: true,
    nextAction: 'Review the target range and retry the static Data Table write.',
  };
}

function staticWriteEffects(params: {
  sheetId: SheetId;
  targetRange: string;
  computedCount: number;
  cellsWritten: number;
}): OperationEffect[] {
  const effects: OperationEffect[] = [
    { type: 'computedGrid', sheetId: params.sheetId, count: params.computedCount },
  ];
  if (params.cellsWritten === 0) {
    effects.push({
      type: 'worksheetUnchanged',
      sheetId: params.sheetId,
      range: params.targetRange,
    });
    return effects;
  }
  effects.push(
    {
      type: 'wroteStaticValues',
      sheetId: params.sheetId,
      range: params.targetRange,
      count: params.cellsWritten,
    },
    {
      type: 'changedRange',
      sheetId: params.sheetId,
      range: params.targetRange,
      count: params.cellsWritten,
    },
    { type: 'createdUndoEntry', sheetId: params.sheetId, range: params.targetRange },
  );
  return effects;
}

function descriptorFromRegion(
  sheetId: SheetId,
  region: {
    anchorRow: number;
    anchorCol: number;
    bounds: { rows: number; cols: number };
  },
): DataTableDescriptor {
  const startRow = region.anchorRow;
  const startCol = region.anchorCol;
  const endRow = startRow + region.bounds.rows - 1;
  const endCol = startCol + region.bounds.cols - 1;
  const rowsComputed = region.bounds.rows;
  const colsComputed = region.bounds.cols;
  const bodyRange = rangeToA1({ sheetId, startRow, startCol, endRow, endCol });
  return {
    regionId: `${sheetId}:${startRow}:${startCol}:${endRow}:${endCol}`,
    sheetId,
    lifecycle: 'live',
    materialized: true,
    bodyRange,
    anchorAddress: toA1(startRow, startCol),
    startRow,
    startCol,
    endRow,
    endCol,
    rowsComputed,
    colsComputed,
    cellCount: rowsComputed * colsComputed,
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
    kind: 'dataTable.compute',
    status: result.cancelled ? 'cancelled' : 'completed',
    effects: [
      { type: 'computedGrid', sheetId, count: result.cellCount ?? 0 },
      { type: 'worksheetUnchanged', sheetId },
    ],
    diagnostics: [],
    lifecycle: 'transient',
    materialized: false,
    worksheetChanged: false,
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
  mutationOptions: MutationAdmissionOptions,
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
    mutationOptions,
  );

  const payload = decodeCreateDataTableResult(bridgeResult.data);
  return {
    kind: 'dataTable.create',
    status: 'applied',
    effects: [
      { type: 'storedMetadata', sheetId, range: payload.bodyRange, objectId: payload.regionId },
      {
        type: 'materializedCells',
        sheetId,
        range: payload.bodyRange,
        objectId: payload.regionId,
        count: payload.cellCount,
      },
      { type: 'createdUndoEntry', sheetId, range: payload.tableRange, objectId: payload.regionId },
    ],
    diagnostics: [],
    lifecycle: 'live',
    materialized: true,
    worksheetChanged: true,
    ...payload,
  };
}

export async function writeDataTableValues(
  ctx: DocumentContext,
  sheetId: SheetId,
  formulaCell: string,
  options: WriteDataTableValuesOptions,
  mutationOptions: MutationAdmissionOptions,
): Promise<DataTableWriteStaticValuesReceipt> {
  const started = elapsedNow(ctx);
  const targetRange = parseDataTableRange(sheetId, options.targetRange);
  const targetRangeA1 = rangeToA1(targetRange);
  const computeReceipt = await dataTable(ctx, sheetId, formulaCell, {
    rowInputCell: options.rowInputCell,
    colInputCell: options.colInputCell,
    rowValues: [...options.rowValues],
    colValues: [...options.colValues],
  });

  if (computeReceipt.status !== 'completed') {
    return {
      kind: 'dataTable.writeStaticValues',
      status: computeReceipt.status,
      effects: staticWriteEffects({
        sheetId,
        targetRange: targetRangeA1,
        computedCount: computeReceipt.cellCount,
        cellsWritten: 0,
      }),
      diagnostics: computeReceipt.diagnostics,
      lifecycle: 'staticValues',
      materialized: false,
      worksheetChanged: false,
      targetRange: targetRangeA1,
      results: computeReceipt.results,
      cellCount: computeReceipt.cellCount,
      cellsWritten: 0,
      elapsedMs: elapsedNow(ctx) - started,
    };
  }

  const expectedRows = rangeRows(targetRange);
  const expectedCols = rangeCols(targetRange);
  const actualRows = computeReceipt.results.length;
  const actualCols = Math.max(0, ...computeReceipt.results.map((row) => row.length));
  if (
    actualRows !== expectedRows ||
    actualCols !== expectedCols ||
    computeReceipt.results.some((row) => row.length !== expectedCols)
  ) {
    return {
      kind: 'dataTable.writeStaticValues',
      status: 'failed',
      effects: staticWriteEffects({
        sheetId,
        targetRange: targetRangeA1,
        computedCount: computeReceipt.cellCount,
        cellsWritten: 0,
      }),
      diagnostics: [
        {
          severity: 'error',
          code: 'DATA_TABLE_STATIC_RANGE_MISMATCH',
          message: 'Computed Data Table result dimensions do not match the target range.',
          target: { sheetId, range: targetRangeA1 },
          recoverable: true,
          nextAction:
            'Choose a target range with the same row and column count as the result grid.',
          details: {
            expectedRows,
            expectedCols,
            actualRows,
            actualCols,
          },
        },
      ],
      lifecycle: 'staticValues',
      materialized: false,
      worksheetChanged: false,
      targetRange: targetRangeA1,
      results: computeReceipt.results,
      cellCount: computeReceipt.cellCount,
      cellsWritten: 0,
      elapsedMs: elapsedNow(ctx) - started,
    };
  }

  const writes: Array<{ row: number; col: number; value: CellValuePrimitive }> = [];
  for (let rowIndex = 0; rowIndex < expectedRows; rowIndex++) {
    for (let colIndex = 0; colIndex < expectedCols; colIndex++) {
      writes.push({
        row: targetRange.startRow + rowIndex,
        col: targetRange.startCol + colIndex,
        value: toStaticCellValue(computeReceipt.results[rowIndex]?.[colIndex]),
      });
    }
  }

  const writeResult: SetCellsResult = await CellOps.setCells(ctx, sheetId, writes, mutationOptions);
  const diagnostics = (writeResult.errors ?? []).map((error) =>
    diagnosticFromSetCellError(sheetId, error),
  );
  const cellsWritten = writeResult.cellsWritten;
  const status =
    diagnostics.length > 0
      ? cellsWritten > 0
        ? 'partial'
        : 'failed'
      : cellsWritten > 0
        ? 'applied'
        : 'noOp';

  return {
    kind: 'dataTable.writeStaticValues',
    status,
    effects: staticWriteEffects({
      sheetId,
      targetRange: targetRangeA1,
      computedCount: computeReceipt.cellCount,
      cellsWritten,
    }),
    diagnostics,
    lifecycle: 'staticValues',
    materialized: cellsWritten > 0,
    worksheetChanged: cellsWritten > 0,
    targetRange: targetRangeA1,
    results: computeReceipt.results,
    cellCount: computeReceipt.cellCount,
    cellsWritten,
    elapsedMs: elapsedNow(ctx) - started,
  };
}

/**
 * Describe persistent What-If Data Table regions by scanning the canonical
 * cell metadata region field. Without an explicit range, scan the used range.
 */
export async function describeDataTables(
  ctx: DocumentContext,
  sheetId: SheetId,
  range?: string,
): Promise<DataTableDescriptor[]> {
  const scanRange = range
    ? parseDataTableRange(sheetId, range)
    : await QueryOps.getUsedRange(ctx, sheetId);
  if (!scanRange) return [];

  const descriptors = new Map<string, DataTableDescriptor>();
  for (let row = scanRange.startRow; row <= scanRange.endRow; row++) {
    for (let col = scanRange.startCol; col <= scanRange.endCol; col++) {
      const data = await getData(ctx, sheetId, row, col);
      const region = data?.region;
      if (region?.kind !== 'dataTable') continue;

      const descriptor = descriptorFromRegion(sheetId, region);
      descriptors.set(descriptor.regionId, descriptor);
    }
  }

  return Array.from(descriptors.values()).sort((a, b) => {
    if (a.startRow !== b.startRow) return a.startRow - b.startRow;
    return a.startCol - b.startCol;
  });
}

export async function refreshDataTable(
  ctx: DocumentContext,
  sheetId: SheetId,
  regionIdOrRange: string,
  options?: RefreshDataTableOptions,
): Promise<DataTableRefreshReceipt> {
  const parsedTarget = parseCellRange(regionIdOrRange);
  const normalizedRange = parsedTarget
    ? rangeToA1(normalizeCellRange(sheetId, { sheetId, ...parsedTarget }))
    : null;
  const descriptors = parsedTarget
    ? await describeDataTables(ctx, sheetId, normalizedRange ?? regionIdOrRange)
    : await describeDataTables(ctx, sheetId);
  const descriptor = descriptors.find(
    (item) =>
      item.regionId === regionIdOrRange ||
      item.bodyRange === regionIdOrRange ||
      item.bodyRange === normalizedRange ||
      item.tableRange === regionIdOrRange ||
      item.tableRange === normalizedRange,
  );

  return {
    kind: 'dataTable.refresh',
    status: 'unsupported',
    effects: [{ type: 'worksheetUnchanged', sheetId }],
    diagnostics: [
      {
        severity: 'error',
        code: 'DATA_TABLE_REFRESH_UNSUPPORTED',
        message:
          'Persistent Data Table refresh requires a dedicated compute mutation; no production refresh bridge is available yet.',
        target: {
          sheetId,
          regionId: descriptor?.regionId,
          range: normalizedRange ?? regionIdOrRange,
        },
        recoverable: true,
        nextAction: 'Use dataTable() for transient computation, or recreate the Data Table region.',
        details: { options: options ?? null },
      },
    ],
    lifecycle: 'live',
    materialized: descriptor?.materialized ?? false,
    worksheetChanged: false,
    target: regionIdOrRange,
    regionId: descriptor?.regionId,
    bodyRange: descriptor?.bodyRange,
    tableRange: descriptor?.tableRange,
    cellCount: descriptor?.cellCount,
  };
}
