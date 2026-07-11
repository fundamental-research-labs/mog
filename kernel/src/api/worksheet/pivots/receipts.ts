import type {
  OperationDiagnostic,
  OperationEffect,
  PivotAddReceipt,
  PivotAddWithSheetReceipt,
  PivotClearReceipt,
  PivotCreationLifecycle,
  PivotRefreshAllReceipt,
  PivotRefreshReceipt,
  PivotRemoveReceipt,
  PivotWorksheetMutationReceipt,
} from '@mog-sdk/contracts/api';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type {
  PivotKernelMutationReceipt,
  PivotTableConfig as DataPivotTableConfig,
  PivotTableResult,
} from '@mog-sdk/contracts/pivot';
import type { DocumentContext } from '../../../context';
import { createPivotNotFoundError, isKernelError } from '../../../errors';
import { rangeToA1 } from '../../internal/utils';
import { toWorksheetRangeOrNull } from '../public-ranges';
import { findPivotByName, resolvePivotName } from '../../../domain/pivots/lookup';

export function pivotIdFor(config: DataPivotTableConfig): string {
  return config.id ?? config.name;
}

export function errorMessage(error: unknown): string | undefined {
  if (!error) return undefined;
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.length > 0) return code;
  }
  return 'PIVOT_MUTATION_FAILED';
}

function errorDetails(error: unknown): Record<string, unknown> | undefined {
  if (error && typeof error === 'object' && 'context' in error) {
    const context = (error as { context?: unknown }).context;
    if (context && typeof context === 'object') {
      return context as Record<string, unknown>;
    }
  }
  return undefined;
}

type CachePivot = (config: DataPivotTableConfig) => void;
type MarkPivotDeleted = (pivotId: string) => void;
type PivotReceipt<K extends PivotWorksheetMutationReceipt['kind']> = Extract<
  PivotWorksheetMutationReceipt,
  { kind: K }
>;

function rethrowPivotTargetNotFound(error: unknown): void {
  if (isKernelError(error) && error.code === 'PIVOT_NOT_FOUND') throw error;
}

export async function runPivotMutationReceipt<
  K extends PivotWorksheetMutationReceipt['kind'],
>(input: {
  kind: K;
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
  mutate: (currentConfig?: DataPivotTableConfig) => Promise<PivotKernelMutationReceipt | void>;
  cachePivot?: CachePivot;
  noOp?: (currentConfig?: DataPivotTableConfig) => string | null;
  extra?: Record<string, unknown>;
}): Promise<PivotReceipt<K>> {
  const { config: currentConfig, pivotId } = await resolvePivotName(
    input.ctx,
    input.sheetId,
    input.pivotName,
    input.kind,
  );
  const noOpReason = input.noOp?.(currentConfig);
  if (noOpReason) {
    return buildPivotMutationReceipt({
      kind: input.kind,
      sheetId: input.sheetId,
      pivotId,
      pivotName: input.pivotName,
      config: currentConfig,
      status: 'noOp',
      noOpReason,
      extra: input.extra,
    }) as PivotReceipt<K>;
  }

  let kernelReceipt: PivotKernelMutationReceipt | void;
  try {
    kernelReceipt = await input.mutate(currentConfig);
  } catch (error) {
    rethrowPivotTargetNotFound(error);
    return buildPivotMutationReceipt({
      kind: input.kind,
      sheetId: input.sheetId,
      pivotId,
      pivotName: input.pivotName,
      config: currentConfig,
      status: 'failed',
      error,
      extra: input.extra,
    }) as PivotReceipt<K>;
  }

  const resolvedPivotId = kernelReceipt?.pivotId ?? pivotId;
  const updatedConfig = resolvedPivotId
    ? await input.ctx.pivot.getPivot(input.sheetId, resolvedPivotId).catch(() => null)
    : await findPivotByName(input.ctx, input.sheetId, input.pivotName).catch(() => undefined);
  if (updatedConfig) input.cachePivot?.(updatedConfig);

  return buildPivotMutationReceipt({
    kind: input.kind,
    sheetId: input.sheetId,
    pivotId: resolvedPivotId,
    pivotName: input.pivotName,
    config: updatedConfig ?? currentConfig ?? null,
    status: kernelReceipt?.status ?? 'applied',
    kernelReceipt: kernelReceipt || undefined,
    extra: input.extra,
  }) as PivotReceipt<K>;
}

export async function applyPivotRenameReceipt(input: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
  newName: string;
  cachePivot?: CachePivot;
}): Promise<PivotReceipt<'pivot.rename'>> {
  const { pivotId, config } = await resolvePivotName(
    input.ctx,
    input.sheetId,
    input.pivotName,
    'rename',
  );
  if ((config.name ?? pivotId) === input.newName) {
    return buildPivotMutationReceipt({
      kind: 'pivot.rename',
      sheetId: input.sheetId,
      pivotId,
      pivotName: input.pivotName,
      config,
      status: 'noOp',
      noOpReason: 'unchangedName',
      extra: { oldName: input.pivotName, newName: input.newName },
    }) as PivotReceipt<'pivot.rename'>;
  }
  let updated: DataPivotTableConfig | null = null;
  let error: unknown;
  try {
    updated = await input.ctx.pivot.updatePivot(
      input.sheetId,
      pivotId,
      { name: input.newName },
      { reason: 'renamed', refreshPolicy: 'refreshAndMaterialize' },
    );
  } catch (caught) {
    rethrowPivotTargetNotFound(caught);
    error = caught;
  }
  if (updated) input.cachePivot?.(updated);
  return buildPivotMutationReceipt({
    kind: 'pivot.rename',
    sheetId: input.sheetId,
    pivotId,
    pivotName: input.pivotName,
    config: updated ?? config,
    status: updated ? 'applied' : 'failed',
    updateReason: 'renamed',
    extra: { oldName: input.pivotName, newName: input.newName },
    ...(updated ? {} : { error: error ?? new Error('Pivot bridge update returned no config') }),
  }) as PivotReceipt<'pivot.rename'>;
}

export async function applyPivotRemoveReceipt(input: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
  markPivotDeleted?: MarkPivotDeleted;
}): Promise<PivotRemoveReceipt> {
  const { pivotId, config: pivot } = await resolvePivotName(
    input.ctx,
    input.sheetId,
    input.pivotName,
    'remove',
  );
  let deleted = false;
  let error: unknown;
  try {
    deleted = await input.ctx.pivot.deletePivot(input.sheetId, pivotId);
  } catch (caught) {
    rethrowPivotTargetNotFound(caught);
    error = caught;
  }
  if (!deleted) {
    if (!error) {
      throw createPivotNotFoundError({
        pivotName: input.pivotName,
        sheetId: String(input.sheetId),
      });
    }
    return buildPivotRemoveReceipt({
      sheetId: input.sheetId,
      pivotName: input.pivotName,
      pivotId,
      removedConfig: pivot,
      status: 'failed',
      error,
    });
  }
  input.markPivotDeleted?.(pivotId);
  return buildPivotRemoveReceipt({
    sheetId: input.sheetId,
    pivotName: input.pivotName,
    pivotId,
    removedConfig: pivot,
    status: 'applied',
  });
}

export async function applyPivotClearReceipt(input: {
  ctx: DocumentContext;
  sheetId: SheetId;
  markPivotDeleted?: MarkPivotDeleted;
}): Promise<PivotClearReceipt> {
  let pivots: DataPivotTableConfig[];
  try {
    pivots = await input.ctx.pivot.getAllPivots(input.sheetId);
  } catch (error) {
    return buildPivotClearReceipt({ sheetId: input.sheetId, receipts: [], listError: error });
  }
  const receipts = [];
  for (const pivot of pivots) {
    receipts.push(
      await applyPivotRemoveReceipt({
        ctx: input.ctx,
        sheetId: input.sheetId,
        pivotName: pivot.name ?? pivot.id,
        markPivotDeleted: input.markPivotDeleted,
      }),
    );
  }
  return buildPivotClearReceipt({ sheetId: input.sheetId, receipts });
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

export function pivotConfigMutationEffects(input: {
  sheetId: SheetId;
  pivotId: string;
  kind: string;
  details?: Record<string, unknown>;
  updateReason?: string;
  kernelEffects?: PivotKernelMutationReceipt['effects'];
}): OperationEffect[] {
  const details = {
    objectType: 'pivotTable',
    operation: input.kind,
    ...input.details,
    ...(input.updateReason ? { updateReason: input.updateReason } : {}),
    ...(input.kernelEffects?.length ? { kernelEffects: input.kernelEffects } : {}),
  };
  return [
    {
      type: 'updatedConfig',
      sheetId: input.sheetId,
      objectId: input.pivotId,
      details,
    },
    {
      type: 'storedMetadata',
      sheetId: input.sheetId,
      objectId: input.pivotId,
      details: { objectType: 'pivotTable' },
    },
    {
      type: 'invalidatedCache',
      sheetId: input.sheetId,
      objectId: input.pivotId,
      details,
    },
  ];
}

export function pivotUnchangedEffects(input: {
  sheetId: SheetId;
  pivotId?: string;
  kind: string;
  reason?: string;
}): OperationEffect[] {
  return [
    {
      type: 'worksheetUnchanged',
      sheetId: input.sheetId,
      ...(input.pivotId ? { objectId: input.pivotId } : {}),
      details: {
        objectType: 'pivotTable',
        operation: input.kind,
        ...(input.reason ? { reason: input.reason } : {}),
      },
    },
  ];
}

export function kernelReceiptDiagnostics(input: {
  sheetId: SheetId;
  receipt: PivotKernelMutationReceipt;
}): OperationDiagnostic[] {
  const error = input.receipt.error;
  if (!error) return [];
  const placementId = input.receipt.effects.find((effect) => effect.placementId)?.placementId;
  const calculatedFieldId = input.receipt.effects.find(
    (effect) => effect.calculatedFieldId,
  )?.calculatedFieldId;
  return [
    {
      severity: 'error',
      code: error.code,
      message: error.message,
      target: {
        sheetId: input.sheetId,
        pivotId: input.receipt.pivotId,
        ...(placementId ? { placementId } : {}),
        ...(calculatedFieldId ? { calculatedFieldId } : {}),
        stage: error.stage,
      },
      recoverable: error.stage !== 'validate',
    },
  ];
}

function pivotMutationFailureDiagnostic(input: {
  sheetId: SheetId;
  pivotId?: string;
  pivotName?: string;
  kind: string;
  error?: unknown;
  stage?: string;
}): OperationDiagnostic {
  return {
    severity: 'error',
    code: errorCode(input.error),
    message: errorMessage(input.error) ?? `${input.kind} did not apply.`,
    target: {
      sheetId: input.sheetId,
      ...(input.pivotId ? { pivotId: input.pivotId } : {}),
      ...(input.stage ? { stage: input.stage } : {}),
    },
    recoverable: true,
    details: {
      ...(input.pivotName ? { pivotName: input.pivotName } : {}),
      ...(errorDetails(input.error) ?? {}),
    },
  };
}

function kernelReceiptFailureDiagnostic(input: {
  sheetId: SheetId;
  kind: string;
  receipt: PivotKernelMutationReceipt;
}): OperationDiagnostic {
  return pivotMutationFailureDiagnostic({
    sheetId: input.sheetId,
    pivotId: input.receipt.pivotId,
    kind: input.kind,
    error: input.receipt.error,
    stage: input.receipt.error?.stage,
  });
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
  const internalRenderedRange = renderedRangeFor(input.sheetId, input.config, input.result);
  const renderedRange = toWorksheetRangeOrNull(internalRenderedRange);
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
    ...(materialized
      ? pivotMaterializationEffects(input.sheetId, pivotId, internalRenderedRange)
      : []),
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
  const internalRenderedRange = renderedRangeFor(input.sheetId, input.config, input.result);
  const renderedRange = toWorksheetRangeOrNull(internalRenderedRange);
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
    ...(materialized
      ? pivotMaterializationEffects(input.sheetId, pivotId, internalRenderedRange)
      : []),
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
  const internalRenderedRange = renderedRangeFor(input.sheetId, input.config, input.result);
  const renderedRange = toWorksheetRangeOrNull(internalRenderedRange);
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
      ? pivotMaterializationEffects(input.sheetId, input.pivotId, internalRenderedRange)
      : [],
    diagnostics,
    pivotId: input.pivotId,
    config: input.config ?? null,
    materialized,
    renderedRange,
    result: input.result ?? null,
  };
}

export function buildPivotMutationReceipt(input: {
  kind: PivotWorksheetMutationReceipt['kind'];
  sheetId: SheetId;
  pivotId?: string;
  pivotName?: string;
  config?: DataPivotTableConfig | null;
  status: 'applied' | 'noOp' | 'failed';
  updateReason?: string;
  kernelReceipt?: PivotKernelMutationReceipt;
  effects?: OperationEffect[];
  diagnostics?: OperationDiagnostic[];
  error?: unknown;
  noOpReason?: string;
  extra?: Record<string, unknown>;
}): PivotWorksheetMutationReceipt {
  const pivotId = input.pivotId ?? input.kernelReceipt?.pivotId;
  const kernelFailed = input.kernelReceipt?.status === 'failed';
  const status = kernelFailed ? 'failed' : input.status;
  const diagnostics =
    input.diagnostics ??
    (status === 'failed'
      ? [
          input.kernelReceipt && kernelFailed
            ? kernelReceiptFailureDiagnostic({
                sheetId: input.sheetId,
                kind: input.kind,
                receipt: input.kernelReceipt,
              })
            : pivotMutationFailureDiagnostic({
                sheetId: input.sheetId,
                pivotId,
                pivotName: input.pivotName,
                kind: input.kind,
                error: input.error,
                stage: input.error ? 'mutate' : undefined,
              }),
        ]
      : []);
  const effects =
    input.effects ??
    (status === 'applied' && pivotId
      ? pivotConfigMutationEffects({
          sheetId: input.sheetId,
          pivotId,
          kind: input.kind,
          updateReason: input.updateReason ?? input.kernelReceipt?.updateReason,
          kernelEffects: input.kernelReceipt?.effects,
        })
      : status === 'noOp'
        ? pivotUnchangedEffects({
            sheetId: input.sheetId,
            pivotId,
            kind: input.kind,
            reason: input.noOpReason,
          })
        : []);

  return {
    kind: input.kind,
    status,
    effects,
    diagnostics,
    sheetId: input.sheetId,
    ...(pivotId ? { pivotId } : {}),
    ...(input.pivotName ? { pivotName: input.pivotName } : {}),
    ...(input.config !== undefined ? { config: input.config } : {}),
    ...(input.kernelReceipt ? { kernelReceipt: input.kernelReceipt } : {}),
    ...(input.extra ?? {}),
  } as PivotWorksheetMutationReceipt;
}

export function buildPivotRemoveReceipt(input: {
  sheetId: SheetId;
  pivotName: string;
  pivotId?: string;
  removedConfig?: DataPivotTableConfig | null;
  status: 'applied' | 'noOp' | 'failed';
  error?: unknown;
  noOpReason?: string;
}): PivotRemoveReceipt {
  const effects: OperationEffect[] =
    input.status === 'applied' && input.pivotId
      ? [
          {
            type: 'removedObject',
            sheetId: input.sheetId,
            objectId: input.pivotId,
            details: { objectType: 'pivotTable', operation: 'pivot.remove' },
          },
          {
            type: 'invalidatedCache',
            sheetId: input.sheetId,
            objectId: input.pivotId,
            details: { objectType: 'pivotTable' },
          },
        ]
      : input.status === 'noOp'
        ? pivotUnchangedEffects({
            sheetId: input.sheetId,
            pivotId: input.pivotId,
            kind: 'pivot.remove',
            reason: input.noOpReason,
          })
        : [];
  const diagnostics =
    input.status === 'failed'
      ? [
          pivotMutationFailureDiagnostic({
            sheetId: input.sheetId,
            pivotId: input.pivotId,
            pivotName: input.pivotName,
            kind: 'pivot.remove',
            error: input.error,
            stage: 'mutate',
          }),
        ]
      : [];

  return {
    kind: 'pivot.remove',
    status: input.status,
    effects,
    diagnostics,
    sheetId: input.sheetId,
    ...(input.pivotId ? { pivotId: input.pivotId } : {}),
    pivotName: input.pivotName,
    ...(input.removedConfig !== undefined ? { removedConfig: input.removedConfig } : {}),
  };
}

export function buildPivotClearReceipt(input: {
  sheetId: SheetId;
  receipts: readonly PivotRemoveReceipt[];
  listError?: unknown;
}): PivotClearReceipt {
  const removedCount = input.receipts.filter((receipt) => receipt.status === 'applied').length;
  const failedCount = input.receipts.filter((receipt) => receipt.status === 'failed').length;
  const pivotIds = input.receipts.flatMap((receipt) => (receipt.pivotId ? [receipt.pivotId] : []));
  const diagnostics = [
    ...(input.listError
      ? [
          pivotMutationFailureDiagnostic({
            sheetId: input.sheetId,
            kind: 'pivot.clear',
            error: input.listError,
            stage: 'list',
          }),
        ]
      : []),
    ...input.receipts.flatMap((receipt) => [...receipt.diagnostics]),
  ];
  const status: PivotClearReceipt['status'] = input.listError
    ? 'failed'
    : input.receipts.length === 0
      ? 'noOp'
      : failedCount === 0
        ? 'applied'
        : removedCount > 0
          ? 'partial'
          : 'failed';
  const effects: OperationEffect[] = input.listError
    ? []
    : input.receipts.length === 0
      ? pivotUnchangedEffects({
          sheetId: input.sheetId,
          kind: 'pivot.clear',
          reason: 'noPivots',
        })
      : input.receipts.flatMap((receipt) => [...receipt.effects]);

  return {
    kind: 'pivot.clear',
    status,
    effects,
    diagnostics,
    sheetId: input.sheetId,
    pivotIds,
    removedCount,
    failedCount,
    receipts: input.receipts,
  };
}
