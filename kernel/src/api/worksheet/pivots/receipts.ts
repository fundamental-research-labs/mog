import type {
  OperationDiagnostic,
  OperationEffect,
  PivotAddReceipt,
  PivotAddWithSheetReceipt,
  PivotCreationLifecycle,
  PivotRefreshAllReceipt,
  PivotRefreshReceipt,
} from '@mog-sdk/contracts/api';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type {
  PivotTableConfig as DataPivotTableConfig,
  PivotTableResult,
} from '@mog-sdk/contracts/pivot';
import { rangeToA1 } from '../../internal/utils';

function pivotIdFor(config: DataPivotTableConfig): string {
  return config.id ?? config.name;
}

function errorMessage(error: unknown): string | undefined {
  if (!error) return undefined;
  return error instanceof Error ? error.message : String(error);
}

function renderedRangeFor(
  sheetId: SheetId,
  config: DataPivotTableConfig | null | undefined,
  result: PivotTableResult | null | undefined,
): CellRange | null {
  if (!config?.outputLocation || !result?.renderedBounds) return null;
  const { totalRows, totalCols } = result.renderedBounds;
  if (totalRows <= 0 || totalCols <= 0) return null;
  return {
    sheetId,
    startRow: config.outputLocation.row,
    startCol: config.outputLocation.col,
    endRow: config.outputLocation.row + totalRows - 1,
    endCol: config.outputLocation.col + totalCols - 1,
  };
}

function materializationFailureDiagnostic(input: {
  sheetId: SheetId;
  pivotId: string;
  message?: string;
  partial: boolean;
}): OperationDiagnostic {
  return {
    severity: 'error',
    code: 'PIVOT_MATERIALIZATION_FAILED',
    message:
      input.message ??
      (input.partial
        ? 'Pivot metadata was stored, but rendered cells were not materialized.'
        : 'Pivot refresh did not materialize rendered cells.'),
    target: {
      sheetId: input.sheetId,
      pivotId: input.pivotId,
      stage: 'materialize',
    },
    recoverable: true,
    nextAction: 'Fix the pivot source/configuration and call ws.pivots.refresh(name).',
  };
}

function refreshAllListFailureDiagnostic(input: {
  sheetId: SheetId;
  message?: string;
}): OperationDiagnostic {
  return {
    severity: 'error',
    code: 'PIVOT_REFRESH_ALL_LIST_FAILED',
    message: input.message ?? 'Pivot refreshAll could not list worksheet pivot tables.',
    target: {
      sheetId: input.sheetId,
      stage: 'refreshAll',
    },
    recoverable: true,
    nextAction: 'Retry ws.pivots.refreshAll() after the worksheet pivot catalog is available.',
  };
}

function pivotStoredMetadataEffects(sheetId: SheetId, pivotId: string): OperationEffect[] {
  return [
    {
      type: 'createdObject',
      sheetId,
      objectId: pivotId,
      details: { objectType: 'pivotTable' },
    },
    {
      type: 'storedMetadata',
      sheetId,
      objectId: pivotId,
      details: { objectType: 'pivotTable' },
    },
  ];
}

function pivotMaterializationEffects(
  sheetId: SheetId,
  pivotId: string,
  renderedRange: CellRange | null,
): OperationEffect[] {
  return [
    {
      type: 'materializedCells',
      sheetId,
      objectId: pivotId,
      ...(renderedRange ? { range: rangeToA1(renderedRange) } : {}),
    },
    {
      type: 'refreshedViewport',
      sheetId,
      objectId: pivotId,
    },
  ];
}

export async function materializePivotForReceipt(
  lifecycle: PivotCreationLifecycle | undefined,
  refresh: () => Promise<PivotTableResult | null>,
): Promise<{ result: PivotTableResult | null; error?: unknown }> {
  if (lifecycle !== 'materialize') return { result: null };
  try {
    return { result: await refresh() };
  } catch (error) {
    return { result: null, error };
  }
}

export function buildPivotAddReceipt(input: {
  sheetId: SheetId;
  config: DataPivotTableConfig;
  lifecycle: PivotCreationLifecycle;
  result?: PivotTableResult | null;
  materializationError?: unknown;
}): PivotAddReceipt {
  const pivotId = pivotIdFor(input.config);
  const renderedRange = renderedRangeFor(input.sheetId, input.config, input.result);
  const materialized = input.result != null;
  const materializationRequested = input.lifecycle === 'materialize';
  const diagnostics =
    materializationRequested && !materialized
      ? [
          materializationFailureDiagnostic({
            sheetId: input.sheetId,
            pivotId,
            message: errorMessage(input.materializationError),
            partial: true,
          }),
        ]
      : [];
  const effects = [
    ...pivotStoredMetadataEffects(input.sheetId, pivotId),
    ...(materialized ? pivotMaterializationEffects(input.sheetId, pivotId, renderedRange) : []),
  ];

  return {
    kind: 'pivot.add',
    status: diagnostics.length > 0 ? 'partial' : 'applied',
    effects,
    diagnostics,
    pivotId,
    config: input.config,
    lifecycle: input.lifecycle,
    materialized,
    renderedRange,
    result: input.result ?? null,
  };
}

export function buildPivotRefreshAllReceipt(input: {
  sheetId: SheetId;
  receipts: readonly PivotRefreshReceipt[];
  listError?: unknown;
}): PivotRefreshAllReceipt {
  const pivotIds = input.receipts.map((receipt) => receipt.pivotId);
  const materializedCount = input.receipts.filter((receipt) => receipt.materialized).length;
  const failedCount = input.receipts.filter((receipt) => receipt.status !== 'applied').length;
  const listDiagnostic = input.listError
    ? [
        refreshAllListFailureDiagnostic({
          sheetId: input.sheetId,
          message: errorMessage(input.listError),
        }),
      ]
    : [];
  const diagnostics = [
    ...listDiagnostic,
    ...input.receipts.flatMap((receipt) => [...receipt.diagnostics]),
  ];
  const status: PivotRefreshAllReceipt['status'] = input.listError
    ? 'failed'
    : input.receipts.length === 0
      ? 'noOp'
      : failedCount === 0
        ? 'applied'
        : materializedCount > 0
          ? 'partial'
          : 'failed';
  const effects: OperationEffect[] = input.listError
    ? []
    : input.receipts.length === 0
      ? [{ type: 'worksheetUnchanged', sheetId: input.sheetId }]
      : input.receipts.flatMap((receipt) => [...receipt.effects]);

  return {
    kind: 'pivot.refreshAll',
    status,
    effects,
    diagnostics,
    sheetId: input.sheetId,
    pivotIds,
    receipts: input.receipts,
    materialized: input.receipts.length > 0 && failedCount === 0,
    materializedCount,
    failedCount,
    renderedRanges: input.receipts.map((receipt) => receipt.renderedRange ?? null),
  };
}

export function buildPivotAddWithSheetReceipt(input: {
  sheetId: SheetId;
  sheetName: string;
  config: DataPivotTableConfig;
  lifecycle: PivotCreationLifecycle;
  result?: PivotTableResult | null;
  materializationError?: unknown;
}): PivotAddWithSheetReceipt {
  const pivotId = pivotIdFor(input.config);
  const renderedRange = renderedRangeFor(input.sheetId, input.config, input.result);
  const materialized = input.result != null;
  const materializationRequested = input.lifecycle === 'materialize';
  const diagnostics =
    materializationRequested && !materialized
      ? [
          materializationFailureDiagnostic({
            sheetId: input.sheetId,
            pivotId,
            message: errorMessage(input.materializationError),
            partial: true,
          }),
        ]
      : [];
  const effects = [
    {
      type: 'createdObject',
      sheetId: input.sheetId,
      objectId: input.sheetId,
      details: { objectType: 'worksheet', name: input.sheetName },
    },
    ...pivotStoredMetadataEffects(input.sheetId, pivotId),
    ...(materialized ? pivotMaterializationEffects(input.sheetId, pivotId, renderedRange) : []),
  ];

  return {
    kind: 'pivot.addWithSheet',
    status: diagnostics.length > 0 ? 'partial' : 'applied',
    effects,
    diagnostics,
    sheetId: input.sheetId,
    pivotId,
    config: input.config,
    lifecycle: input.lifecycle,
    materialized,
    renderedRange,
    result: input.result ?? null,
  };
}

export function buildPivotRefreshReceipt(input: {
  sheetId: SheetId;
  pivotId: string;
  config?: DataPivotTableConfig | null;
  result?: PivotTableResult | null;
  materializationError?: unknown;
}): PivotRefreshReceipt {
  const renderedRange = renderedRangeFor(input.sheetId, input.config, input.result);
  const materialized = input.result != null;
  const diagnostics = materialized
    ? []
    : [
        materializationFailureDiagnostic({
          sheetId: input.sheetId,
          pivotId: input.pivotId,
          message: errorMessage(input.materializationError),
          partial: false,
        }),
      ];

  return {
    kind: 'pivot.refresh',
    status: materialized ? 'applied' : 'failed',
    effects: materialized
      ? pivotMaterializationEffects(input.sheetId, input.pivotId, renderedRange)
      : [],
    diagnostics,
    pivotId: input.pivotId,
    config: input.config ?? null,
    materialized,
    renderedRange,
    result: input.result ?? null,
  };
}
