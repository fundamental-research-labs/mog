import type {
  AutoFillApplyReceipt,
  OperationDiagnostic,
  OperationEffect,
  TableClearCalculatedColumnReceipt,
  TableInfo,
  TableSetCalculatedColumnReceipt,
} from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';
import { colToLetter } from '../../internal/utils';
import type { DocumentContext, OperationResult } from './shared';
import { operationFailed } from './shared';
import { toCellInput } from './cell-input';
import * as FillOps from './fill-operations';
import {
  createGroupedTableMutationOptions,
  getDataBodyRangeFromInfo,
  getTableByName,
  getTableColumnDataCellsFromInfo,
  type TableMutationOptions,
} from './table-operations';

type TableCalculatedColumnAction = 'set' | 'clear';
type TableCalculatedColumnStatus = TableSetCalculatedColumnReceipt['status'];

interface BuildTableCalculatedColumnReceiptParams {
  action: TableCalculatedColumnAction;
  sheetId: SheetId;
  table: TableInfo;
  columnIndex: number;
  formula: string | null;
  cells: readonly { row: number; col: number }[];
  metadataChanged: boolean;
  directCellWriteCount: number;
  directCellWriteRange?: string | null;
  directCellEffectTypes: readonly ('materializedCells' | 'changedRange')[];
  undoCreated: boolean;
  undoGroup: boolean;
  diagnostics?: readonly OperationDiagnostic[];
  autofillReceipt?: AutoFillApplyReceipt;
}

function sortedTableColumnCells(
  cells: readonly { row: number; col: number }[],
): Array<{ row: number; col: number }> {
  return [...cells].sort((a, b) => (a.row === b.row ? a.col - b.col : a.row - b.row));
}

function tableColumnFromInfo(
  table: TableInfo,
  columnIndex: number,
): TableInfo['columns'][number] | undefined {
  return table.columns.find((column) => column.index === columnIndex) ?? table.columns[columnIndex];
}

function a1RangeForCells(cells: readonly { row: number; col: number }[]): string | null {
  if (cells.length === 0) return null;
  const sorted = sortedTableColumnCells(cells);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  return `${colToLetter(first.col)}${first.row + 1}:${colToLetter(last.col)}${last.row + 1}`;
}

function autofillChangedCellCount(receipt: AutoFillApplyReceipt | undefined): number {
  if (!receipt) return 0;
  if (receipt.filledCellCount > 0) return receipt.filledCellCount;
  if (receipt.changes.length > 0) return receipt.changes.length;
  return Math.max(
    0,
    ...receipt.effects
      .filter((effect) => effect.type === 'materializedCells' || effect.type === 'changedRange')
      .map((effect) => effect.count ?? 0),
  );
}

function calculatedColumnDetails(params: {
  action: TableCalculatedColumnAction;
  table: TableInfo;
  columnIndex: number;
  formula: string | null;
  bodyRange: string | null;
  columnRange: string | null;
}): Record<string, unknown> {
  const column = tableColumnFromInfo(params.table, params.columnIndex);
  const details: Record<string, unknown> = {
    action: params.action,
    tableName: params.table.name,
    columnIndex: params.columnIndex,
  };
  if (column?.name !== undefined) details.columnName = column.name;
  if (params.formula !== null) details.formula = params.formula;
  if (params.bodyRange !== null) details.bodyRange = params.bodyRange;
  if (params.columnRange !== null) details.columnRange = params.columnRange;
  return details;
}

function calculatedColumnStatus(params: {
  metadataChanged: boolean;
  cellsWritten: number;
  diagnostics: readonly OperationDiagnostic[];
}): TableCalculatedColumnStatus {
  const hasError = params.diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  if (hasError) {
    return params.metadataChanged || params.cellsWritten > 0 ? 'partial' : 'failed';
  }
  return params.metadataChanged || params.cellsWritten > 0 ? 'applied' : 'noOp';
}

function buildTableCalculatedColumnEffects(
  params: BuildTableCalculatedColumnReceiptParams & {
    bodyRange: string | null;
    columnRange: string | null;
    cellsWritten: number;
  },
): OperationEffect[] {
  const effects: OperationEffect[] = [];
  const details = calculatedColumnDetails(params);

  if (params.metadataChanged) {
    effects.push(
      {
        type: 'updatedConfig',
        sheetId: params.sheetId,
        range: params.table.range,
        objectId: params.table.id,
        details,
      },
      {
        type: 'storedMetadata',
        sheetId: params.sheetId,
        range: params.table.range,
        objectId: params.table.id,
        details,
      },
    );
  }

  if (params.directCellWriteCount > 0 && params.directCellWriteRange) {
    for (const type of params.directCellEffectTypes) {
      effects.push({
        type,
        sheetId: params.sheetId,
        range: params.directCellWriteRange,
        objectId: params.table.id,
        count: params.directCellWriteCount,
        details,
      });
    }
  }

  if (params.autofillReceipt) {
    effects.push(...params.autofillReceipt.effects);
  }

  if (params.undoCreated) {
    effects.push({
      type: 'createdUndoEntry',
      sheetId: params.sheetId,
      range: params.table.range,
      objectId: params.table.id,
      details: { ...details, undoGroup: params.undoGroup },
    });
  }

  if (effects.length === 0) {
    effects.push({
      type: 'worksheetUnchanged',
      sheetId: params.sheetId,
      range: params.bodyRange ?? params.table.range,
      objectId: params.table.id,
      details,
    });
  }

  return effects;
}

function buildTableCalculatedColumnReceipt(
  params: BuildTableCalculatedColumnReceiptParams,
): TableSetCalculatedColumnReceipt | TableClearCalculatedColumnReceipt {
  const bodyRange = getDataBodyRangeFromInfo(params.table);
  const columnRange = a1RangeForCells(params.cells);
  const diagnostics = [
    ...(params.diagnostics ?? []),
    ...(params.autofillReceipt?.diagnostics ?? []),
  ];
  const cellsWritten =
    params.directCellWriteCount + autofillChangedCellCount(params.autofillReceipt);
  const status = calculatedColumnStatus({
    metadataChanged: params.metadataChanged,
    cellsWritten,
    diagnostics,
  });
  const column = tableColumnFromInfo(params.table, params.columnIndex);
  const common = {
    status,
    effects: buildTableCalculatedColumnEffects({
      ...params,
      bodyRange,
      columnRange,
      cellsWritten,
    }),
    diagnostics,
    tableName: params.table.name,
    tableId: params.table.id,
    columnIndex: params.columnIndex,
    tableRange: params.table.range,
    bodyRange,
    columnRange,
    cellsWritten,
    metadataChanged: params.metadataChanged,
    undoGroup: params.undoGroup,
  };
  const payload = column?.name === undefined ? common : { ...common, columnName: column.name };

  if (params.action === 'set') {
    return {
      kind: 'table.calculatedColumn.set',
      action: 'set',
      formula: params.formula ?? '',
      ...payload,
      ...(params.autofillReceipt ? { autofillReceipt: params.autofillReceipt } : {}),
    };
  }

  return {
    kind: 'table.calculatedColumn.clear',
    action: 'clear',
    formula: null,
    ...payload,
  };
}

function buildTableSetCalculatedColumnReceipt(
  params: Omit<BuildTableCalculatedColumnReceiptParams, 'action' | 'formula'> & {
    formula: string;
  },
): TableSetCalculatedColumnReceipt {
  return buildTableCalculatedColumnReceipt({
    ...params,
    action: 'set',
  }) as TableSetCalculatedColumnReceipt;
}

function buildTableClearCalculatedColumnReceipt(
  params: Omit<BuildTableCalculatedColumnReceiptParams, 'action' | 'formula' | 'autofillReceipt'>,
): TableClearCalculatedColumnReceipt {
  return buildTableCalculatedColumnReceipt({
    ...params,
    action: 'clear',
    formula: null,
  }) as TableClearCalculatedColumnReceipt;
}

function isSetCalculatedColumnNoOp(
  table: TableInfo,
  columnIndex: number,
  formula: string,
  cells: readonly { row: number; col: number }[],
): boolean {
  return (
    cells.length === 0 && tableColumnFromInfo(table, columnIndex)?.calculatedFormula === formula
  );
}

function isClearCalculatedColumnNoOp(
  table: TableInfo,
  columnIndex: number,
  cells: readonly { row: number; col: number }[],
): boolean {
  const currentFormula = tableColumnFromInfo(table, columnIndex)?.calculatedFormula;
  return cells.length === 0 && (currentFormula === undefined || currentFormula === '');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function tableCalculatedColumnDiagnostic(params: {
  action: TableCalculatedColumnAction;
  sheetId: SheetId;
  table: TableInfo;
  columnIndex: number;
  stage: string;
  error: unknown;
}): OperationDiagnostic {
  const actionLabel = params.action === 'set' ? 'set' : 'clear';
  return {
    severity: 'error',
    code:
      params.action === 'set'
        ? 'TABLE_CALCULATED_COLUMN_SET_FAILED'
        : 'TABLE_CALCULATED_COLUMN_CLEAR_FAILED',
    message: `Failed to ${actionLabel} the table calculated column.`,
    target: {
      sheetId: params.sheetId,
      range: params.table.range,
      objectId: params.table.id,
      stage: params.stage,
    },
    recoverable: true,
    nextAction: 'Review the table state and retry the calculated column operation.',
    details: {
      tableName: params.table.name,
      columnIndex: params.columnIndex,
      cause: errorMessage(params.error),
    },
  };
}

function undoGroupBridge(ctx: DocumentContext): {
  beginUndoGroup(admissionOptions?: TableMutationOptions): Promise<unknown>;
  endUndoGroup(admissionOptions?: TableMutationOptions): Promise<unknown>;
} {
  return ctx.computeBridge as unknown as {
    beginUndoGroup(admissionOptions?: TableMutationOptions): Promise<unknown>;
    endUndoGroup(admissionOptions?: TableMutationOptions): Promise<unknown>;
  };
}

export async function applySetCalculatedColumnWithReceipt(
  ctx: DocumentContext,
  sheetId: SheetId,
  table: TableInfo,
  tableName: string,
  columnIndex: number,
  formula: string,
  cells: readonly { row: number; col: number }[],
): Promise<TableSetCalculatedColumnReceipt> {
  const sortedCells = sortedTableColumnCells(cells);
  if (isSetCalculatedColumnNoOp(table, columnIndex, formula, sortedCells)) {
    return buildTableSetCalculatedColumnReceipt({
      sheetId,
      table,
      columnIndex,
      formula,
      cells: sortedCells,
      metadataChanged: false,
      directCellWriteCount: 0,
      directCellWriteRange: null,
      directCellEffectTypes: ['materializedCells', 'changedRange'],
      undoCreated: false,
      undoGroup: false,
    });
  }

  let metadataChanged = false;
  let directCellWriteCount = 0;
  let directCellWriteRange: string | null = null;
  let autofillReceipt: AutoFillApplyReceipt | undefined;
  let undoGroupStarted = false;
  let stage = 'beginUndoGroup';
  const nextOptions = createGroupedTableMutationOptions(ctx, 'tables.setCalculatedColumn', sheetId);

  try {
    await undoGroupBridge(ctx).beginUndoGroup(nextOptions());
    undoGroupStarted = true;

    stage = 'updateMetadata';
    await ctx.computeBridge.updateCalculatedColumn(tableName, columnIndex, formula, nextOptions());
    metadataChanged = true;

    if (sortedCells.length > 0) {
      const sourceCell = sortedCells[0]!;
      directCellWriteRange = a1RangeForCells([sourceCell]);
      stage = 'writeSeedCell';
      await ctx.computeBridge.setCellsByPosition(
        sheetId,
        [{ row: sourceCell.row, col: sourceCell.col, input: toCellInput(formula) }],
        nextOptions(),
      );
      directCellWriteCount = 1;

      if (sortedCells.length > 1) {
        const firstTargetCell = sortedCells[1]!;
        const lastCell = sortedCells[sortedCells.length - 1]!;
        stage = 'autofill';
        autofillReceipt = await FillOps.autoFill(
          ctx,
          sheetId,
          {
            startRow: sourceCell.row,
            startCol: sourceCell.col,
            endRow: sourceCell.row,
            endCol: sourceCell.col,
          },
          {
            startRow: firstTargetCell.row,
            startCol: firstTargetCell.col,
            endRow: lastCell.row,
            endCol: lastCell.col,
          },
          'withoutFormats',
          { undoGroup: false },
        );
      }
    }

    stage = 'endUndoGroup';
    await undoGroupBridge(ctx).endUndoGroup(nextOptions());
  } catch (error) {
    if (undoGroupStarted && stage !== 'endUndoGroup') {
      try {
        await undoGroupBridge(ctx).endUndoGroup(nextOptions());
      } catch {
        // Preserve the original mutation failure in the receipt diagnostic.
      }
    }
    return buildTableSetCalculatedColumnReceipt({
      sheetId,
      table,
      columnIndex,
      formula,
      cells: sortedCells,
      metadataChanged,
      directCellWriteCount,
      directCellWriteRange,
      directCellEffectTypes: ['materializedCells', 'changedRange'],
      undoCreated: metadataChanged || directCellWriteCount > 0 || !!autofillReceipt,
      undoGroup: undoGroupStarted,
      ...(autofillReceipt ? { autofillReceipt } : {}),
      diagnostics: [
        tableCalculatedColumnDiagnostic({
          action: 'set',
          sheetId,
          table,
          columnIndex,
          stage,
          error,
        }),
      ],
    });
  }

  return buildTableSetCalculatedColumnReceipt({
    sheetId,
    table,
    columnIndex,
    formula,
    cells: sortedCells,
    metadataChanged,
    directCellWriteCount,
    directCellWriteRange,
    directCellEffectTypes: ['materializedCells', 'changedRange'],
    undoCreated: metadataChanged || directCellWriteCount > 0 || !!autofillReceipt,
    undoGroup: undoGroupStarted,
    ...(autofillReceipt ? { autofillReceipt } : {}),
  });
}

export async function applyClearCalculatedColumnWithReceipt(
  ctx: DocumentContext,
  sheetId: SheetId,
  table: TableInfo,
  tableName: string,
  columnIndex: number,
  cells: readonly { row: number; col: number }[],
): Promise<TableClearCalculatedColumnReceipt> {
  const sortedCells = sortedTableColumnCells(cells);
  if (isClearCalculatedColumnNoOp(table, columnIndex, sortedCells)) {
    return buildTableClearCalculatedColumnReceipt({
      sheetId,
      table,
      columnIndex,
      cells: sortedCells,
      metadataChanged: false,
      directCellWriteCount: 0,
      directCellWriteRange: null,
      directCellEffectTypes: ['changedRange'],
      undoCreated: false,
      undoGroup: false,
    });
  }

  let metadataChanged = false;
  let directCellWriteCount = 0;
  const directCellWriteRange = a1RangeForCells(sortedCells);
  let stage = 'removeMetadata';
  const nextOptions = createGroupedTableMutationOptions(
    ctx,
    'tables.clearCalculatedColumn',
    sheetId,
  );

  try {
    await ctx.computeBridge.removeCalculatedColumn(tableName, columnIndex, nextOptions());
    metadataChanged = true;

    if (sortedCells.length > 0) {
      stage = 'clearCells';
      const edits = sortedCells.map(({ row, col }) => ({ row, col, input: toCellInput(null) }));
      await ctx.computeBridge.setCellsByPosition(sheetId, edits, nextOptions());
      directCellWriteCount = edits.length;
    }
  } catch (error) {
    return buildTableClearCalculatedColumnReceipt({
      sheetId,
      table,
      columnIndex,
      cells: sortedCells,
      metadataChanged,
      directCellWriteCount,
      directCellWriteRange,
      directCellEffectTypes: ['changedRange'],
      undoCreated: metadataChanged || directCellWriteCount > 0,
      undoGroup: false,
      diagnostics: [
        tableCalculatedColumnDiagnostic({
          action: 'clear',
          sheetId,
          table,
          columnIndex,
          stage,
          error,
        }),
      ],
    });
  }

  return buildTableClearCalculatedColumnReceipt({
    sheetId,
    table,
    columnIndex,
    cells: sortedCells,
    metadataChanged,
    directCellWriteCount,
    directCellWriteRange,
    directCellEffectTypes: ['changedRange'],
    undoCreated: metadataChanged || directCellWriteCount > 0,
    undoGroup: false,
  });
}

export async function setCalculatedColumnFormula(
  ctx: DocumentContext,
  sheetId: SheetId,
  tableName: string,
  colIndex: number,
  formula: string,
): Promise<OperationResult<TableSetCalculatedColumnReceipt>> {
  const table = await getTableByName(ctx, tableName);
  if (!table) {
    return {
      success: false,
      error: operationFailed('setCalculatedColumnFormula', 'Table not found'),
    };
  }

  return {
    success: true,
    data: await applySetCalculatedColumnWithReceipt(
      ctx,
      sheetId,
      table,
      tableName,
      colIndex,
      formula,
      getTableColumnDataCellsFromInfo(table, colIndex),
    ),
  };
}

export async function clearCalculatedColumnFormula(
  ctx: DocumentContext,
  sheetId: SheetId,
  tableName: string,
  colIndex: number,
): Promise<OperationResult<TableClearCalculatedColumnReceipt>> {
  const table = await getTableByName(ctx, tableName);
  if (!table) {
    return {
      success: false,
      error: operationFailed('clearCalculatedColumnFormula', 'Table not found'),
    };
  }

  return {
    success: true,
    data: await applyClearCalculatedColumnWithReceipt(
      ctx,
      sheetId,
      table,
      tableName,
      colIndex,
      getTableColumnDataCellsFromInfo(table, colIndex),
    ),
  };
}
