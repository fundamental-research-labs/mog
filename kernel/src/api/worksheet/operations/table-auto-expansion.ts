import type {
  OperationDiagnostic,
  OperationEffect,
  TableAutoExpansionReceipt,
  TableAutoExpansionUnsupportedReason,
  TableInfo,
} from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';
import type {
  AutoExpansionResult,
  MutationResult,
  SheetRange,
} from '../../../bridges/compute/compute-types.gen';
import { colToLetter, letterToCol } from '../../internal/utils';
import type { DocumentContext, OperationResult } from './shared';
import { wrapOp } from './shared';
import { bridgeTableToTableInfo, createTableMutationOptions } from './table-operations';

interface TableAutoExpansionReceiptInput {
  sheetId: SheetId;
  tableName: string;
  before: TableInfo | null;
  after?: TableInfo | null;
  detection?: AutoExpansionResult | null;
  bridgeResult?: MutationResult | null;
  error?: unknown;
  unsupportedReasons?: readonly TableAutoExpansionUnsupportedReason[];
  undoEntryCreated?: boolean;
}

function parseA1Range(
  range: string,
): { startRow: number; startCol: number; endRow: number; endCol: number } | null {
  const match = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
  if (!match) return null;
  return {
    startCol: letterToCol(match[1]),
    startRow: parseInt(match[2], 10) - 1,
    endCol: letterToCol(match[3]),
    endRow: parseInt(match[4], 10) - 1,
  };
}

function sheetRangeToA1(range: Pick<SheetRange, 'startRow' | 'startCol' | 'endRow' | 'endCol'>) {
  return `${colToLetter(range.startCol)}${range.startRow + 1}:${colToLetter(range.endCol)}${
    range.endRow + 1
  }`;
}

function expectedAutoExpansionRange(
  before: TableInfo | null,
  detection: AutoExpansionResult | null | undefined,
): string | undefined {
  if (!before || detection?.shouldExpand !== true) return undefined;
  const parsed = parseA1Range(before.range);
  if (!parsed) return undefined;
  return sheetRangeToA1({
    startRow: parsed.startRow,
    startCol: parsed.startCol,
    endRow: detection.newEndRow,
    endCol: detection.newEndCol,
  });
}

function errorMessage(error: unknown): string | undefined {
  if (error == null) return undefined;
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

function unsupportedReasonsForAutoExpansionError(
  error: unknown,
): TableAutoExpansionUnsupportedReason[] {
  const message = errorMessage(error)?.toLowerCase() ?? '';
  const code = errorCode(error);
  const reasons: TableAutoExpansionUnsupportedReason[] = [];

  if (code === 'API_PROTECTED_SHEET' || message.includes('protect')) {
    reasons.push('protectedRegion');
  }
  if (message.includes('filter')) {
    reasons.push('filteredRegion');
  }
  if (message.includes('merge')) {
    reasons.push('mergedRegion');
  }

  return reasons;
}

function uniqueUnsupportedReasons(
  reasons: readonly TableAutoExpansionUnsupportedReason[],
): readonly TableAutoExpansionUnsupportedReason[] {
  return [...new Set(reasons)];
}

function changedCells(result: MutationResult | null | undefined) {
  return result?.recalc?.changedCells ?? [];
}

function changedCellsRange(result: MutationResult | null | undefined): string | undefined {
  const positions = changedCells(result)
    .map((cell) => cell.position)
    .filter((position): position is { row: number; col: number } => position != null);
  if (positions.length === 0) return undefined;

  const startRow = Math.min(...positions.map((position) => position.row));
  const startCol = Math.min(...positions.map((position) => position.col));
  const endRow = Math.max(...positions.map((position) => position.row));
  const endCol = Math.max(...positions.map((position) => position.col));
  return sheetRangeToA1({ startRow, startCol, endRow, endCol });
}

function tableChangeCount(result: MutationResult | null | undefined, table: TableInfo | null) {
  const changes = result?.tableChanges ?? [];
  if (!table) return changes.length;
  return changes.filter(
    (change) =>
      change.tableId === table.id ||
      change.name === table.name ||
      change.name === table.displayName,
  ).length;
}

function autoExpansionTarget(input: {
  sheetId: SheetId;
  table: TableInfo | null;
  tableName: string;
}): NonNullable<OperationDiagnostic['target']> {
  return {
    sheetId: input.sheetId,
    objectId: input.table?.id ?? input.tableName,
    ...(input.table?.range ? { range: input.table.range } : {}),
    stage: 'autoExpansion',
  };
}

function diagnosticForTableAutoExpansion(
  input: TableAutoExpansionReceiptInput,
  status: TableAutoExpansionReceipt['status'],
  unsupportedReasons: readonly TableAutoExpansionUnsupportedReason[],
): OperationDiagnostic[] {
  const target = autoExpansionTarget({
    sheetId: input.sheetId,
    table: input.before,
    tableName: input.tableName,
  });
  const message = errorMessage(input.error);

  if (!input.before && status === 'failed') {
    return [
      {
        severity: 'error',
        code: 'TABLE_AUTO_EXPANSION_TABLE_NOT_FOUND',
        message: message ?? `Table not found: ${input.tableName}`,
        target,
        recoverable: true,
        nextAction: 'Check the table name and worksheet before retrying.',
      },
    ];
  }

  if (status === 'unsupported') {
    return [
      {
        severity: 'warning',
        code: 'TABLE_AUTO_EXPANSION_UNSUPPORTED_REGION',
        message: message ?? 'Table auto-expansion is not supported for this region.',
        target,
        recoverable: true,
        nextAction: 'Remove the unsupported worksheet condition and retry.',
        details: { unsupportedReasons },
      },
    ];
  }

  if (status === 'noOp') {
    return [
      {
        severity: 'info',
        code: 'TABLE_AUTO_EXPANSION_NO_OP',
        message: 'No adjacent data required table auto-expansion.',
        target,
        recoverable: true,
      },
    ];
  }

  if (status === 'partial') {
    return [
      {
        severity: 'warning',
        code: 'TABLE_AUTO_EXPANSION_PARTIAL',
        message: message ?? 'Table auto-expansion committed some effects but did not complete.',
        target,
        recoverable: true,
        nextAction: 'Inspect the table range and affected cells before retrying.',
      },
    ];
  }

  if (status === 'failed') {
    return [
      {
        severity: 'error',
        code: 'TABLE_AUTO_EXPANSION_NO_DURABLE_EFFECT',
        message: message ?? 'Table auto-expansion did not commit any durable effects.',
        target,
        recoverable: true,
        nextAction: 'Retry after confirming the table can expand into the adjacent region.',
      },
    ];
  }

  return [];
}

function tableAutoExpansionReceipt(
  input: TableAutoExpansionReceiptInput,
): TableAutoExpansionReceipt {
  const explicitUnsupportedReasons = input.unsupportedReasons ?? [];
  const unsupportedReasons = uniqueUnsupportedReasons([
    ...explicitUnsupportedReasons,
    ...unsupportedReasonsForAutoExpansionError(input.error),
  ]);
  const previousRange = input.before?.range;
  const afterRange = input.after?.range ?? previousRange;
  const expectedRange = expectedAutoExpansionRange(input.before, input.detection);
  const rangeChanged = previousRange != null && afterRange != null && afterRange !== previousRange;
  const matchingTableChangeCount = tableChangeCount(input.bridgeResult, input.before);
  const changedTableMetadata = rangeChanged || matchingTableChangeCount > 0;
  const changedCellCount = changedCells(input.bridgeResult).length;
  const changedCellRange = changedCellsRange(input.bridgeResult);
  const durableEffectsCommitted = changedTableMetadata || changedCellCount > 0;
  const expansionExpected = input.detection?.shouldExpand === true;

  let status: TableAutoExpansionReceipt['status'];
  if (unsupportedReasons.length > 0) {
    status = 'unsupported';
  } else if (!input.before) {
    status = 'failed';
  } else if (input.error && durableEffectsCommitted) {
    status = 'partial';
  } else if (input.error) {
    status = 'failed';
  } else if (!expansionExpected) {
    status = 'noOp';
  } else if (rangeChanged) {
    status = 'applied';
  } else if (durableEffectsCommitted) {
    status = 'partial';
  } else {
    status = 'failed';
  }

  const effects: OperationEffect[] = [];
  if (durableEffectsCommitted) {
    if (changedTableMetadata) {
      effects.push({
        type: 'storedMetadata',
        sheetId: input.sheetId,
        objectId: input.before?.id ?? input.tableName,
        ...(afterRange ? { range: afterRange } : {}),
        details: {
          tableName: input.tableName,
          tableChangeCount: matchingTableChangeCount,
        },
      });
      if (rangeChanged && afterRange) {
        effects.push({
          type: 'changedRange',
          sheetId: input.sheetId,
          objectId: input.before?.id ?? input.tableName,
          range: afterRange,
          details: {
            previousRange,
            expectedRange,
          },
        });
      }
    }

    if (changedCellCount > 0) {
      effects.push({
        type: 'materializedCells',
        sheetId: input.sheetId,
        ...(changedCellRange ? { range: changedCellRange } : {}),
        count: changedCellCount,
      });
    }

    if (input.undoEntryCreated && (status === 'applied' || status === 'partial')) {
      const undoRange = afterRange ?? expectedRange ?? previousRange;
      effects.push({
        type: 'createdUndoEntry',
        sheetId: input.sheetId,
        ...(undoRange ? { range: undoRange } : {}),
      });
    }
  } else {
    effects.push({
      type: 'worksheetUnchanged',
      sheetId: input.sheetId,
      ...((previousRange ?? expectedRange) ? { range: previousRange ?? expectedRange } : {}),
    });
  }

  return {
    kind: 'tableAutoExpansion',
    status,
    sheetId: input.sheetId,
    tableName: input.tableName,
    ...(input.before?.id ? { tableId: input.before.id } : {}),
    ...(previousRange ? { previousRange } : {}),
    ...(expectedRange ? { expectedRange } : {}),
    ...(afterRange ? { newRange: afterRange } : {}),
    changedTableMetadata,
    changedCellCount,
    unsupportedReasons,
    effects,
    diagnostics: diagnosticForTableAutoExpansion(input, status, unsupportedReasons),
  };
}

async function getTableByName(ctx: DocumentContext, tableName: string): Promise<TableInfo | null> {
  try {
    const table = await ctx.computeBridge.getTableByName(tableName);
    return table ? bridgeTableToTableInfo(table) : null;
  } catch {
    return null;
  }
}

/**
 * Apply auto-expansion to a table.
 * Bridge: applyAutoExpansion(sheetId, tableName) -> MutationResult
 */
export async function applyAutoExpansion(
  ctx: DocumentContext,
  sheetId: SheetId,
  tableName: string,
  options: {
    assertAllowed?: (table: TableInfo) => Promise<void>;
    unsupportedReasonForAssertError?: TableAutoExpansionUnsupportedReason;
  } = {},
): Promise<OperationResult<TableAutoExpansionReceipt>> {
  return wrapOp('applyAutoExpansion', async () => {
    const before = await getTableByName(ctx, tableName);
    if (!before) {
      return tableAutoExpansionReceipt({
        sheetId,
        tableName,
        before,
        error: new Error(`Table not found: ${tableName}`),
      });
    }

    if (options.assertAllowed) {
      try {
        await options.assertAllowed(before);
      } catch (error) {
        return tableAutoExpansionReceipt({
          sheetId,
          tableName,
          before,
          error,
          ...(options.unsupportedReasonForAssertError
            ? { unsupportedReasons: [options.unsupportedReasonForAssertError] }
            : {}),
        });
      }
    }

    let detection: AutoExpansionResult | null = null;
    try {
      detection = await ctx.computeBridge.detectAutoExpansion(sheetId, tableName);
    } catch (error) {
      return tableAutoExpansionReceipt({
        sheetId,
        tableName,
        before,
        error,
      });
    }

    if (!detection.shouldExpand) {
      return tableAutoExpansionReceipt({
        sheetId,
        tableName,
        before,
        detection,
      });
    }

    try {
      const bridgeResult = await ctx.computeBridge.applyAutoExpansion(
        sheetId,
        tableName,
        createTableMutationOptions(ctx, 'tables.applyAutoExpansion', sheetId),
      );
      const after = await getTableByName(ctx, tableName).catch(() => before);
      return tableAutoExpansionReceipt({
        sheetId,
        tableName,
        before,
        after,
        detection,
        bridgeResult,
        undoEntryCreated: true,
      });
    } catch (error) {
      const after = await getTableByName(ctx, tableName).catch(() => before);
      return tableAutoExpansionReceipt({
        sheetId,
        tableName,
        before,
        after,
        detection,
        error,
        undoEntryCreated: true,
      });
    }
  });
}
