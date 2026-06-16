import type {
  ImportedPivotViewRecord,
  OperationDiagnostic,
  OperationEffect,
  PivotComputeReceipt,
  PivotQueryReceipt,
  PivotQueryResult,
} from '@mog-sdk/contracts/api';
import type { CellValue, SheetId } from '@mog-sdk/contracts/core';
import type {
  PivotTableConfig as DataPivotTableConfig,
  PivotTableResult,
} from '@mog-sdk/contracts/pivot';
import type { DocumentContext } from '../../../context';
import { queryPivotByName } from '../../../domain/pivots/query';
import { errorMessage, pivotIdFor } from './receipts';

type PivotReadReceiptFailureReason = 'failed' | 'notFound' | 'unsupported';
type PivotReadTarget =
  | { readonly status: 'found'; readonly pivotId: string }
  | {
      readonly status: PivotReadReceiptFailureReason;
      readonly pivotId: string;
      readonly message?: string;
      readonly error?: unknown;
    };

function pivotReadDiagnostic(input: {
  operation: 'compute' | 'query';
  sheetId: SheetId;
  pivotId: string;
  reason: PivotReadReceiptFailureReason;
  message?: string;
  error?: unknown;
}): OperationDiagnostic {
  const operationLabel = input.operation === 'compute' ? 'compute' : 'query';
  const methodName = input.operation === 'compute' ? 'compute' : 'queryPivot';
  const codePrefix = input.operation === 'compute' ? 'PIVOT_COMPUTE' : 'PIVOT_QUERY';
  const failureMessage = errorMessage(input.error);
  const message =
    input.message ??
    failureMessage ??
    (input.reason === 'notFound'
      ? `Pivot table "${input.pivotId}" was not found on this worksheet.`
      : input.reason === 'unsupported'
        ? `Pivot table "${input.pivotId}" is not supported by the ${operationLabel} operation.`
        : `Pivot ${operationLabel} did not produce a result.`);
  const code =
    input.reason === 'notFound'
      ? `${codePrefix}_PIVOT_NOT_FOUND`
      : input.reason === 'unsupported'
        ? `${codePrefix}_UNSUPPORTED_PIVOT`
        : `${codePrefix}_FAILED`;

  return {
    severity: 'error',
    code,
    message,
    target: {
      sheetId: input.sheetId,
      pivotId: input.pivotId,
      stage: operationLabel,
    },
    recoverable: true,
    nextAction:
      input.reason === 'notFound'
        ? 'Check the pivot name and call ws.pivots.list() to inspect available pivots.'
        : input.reason === 'unsupported'
          ? 'Inspect ws.pivots.getImportedViewRecords() for the imported pivot capabilities.'
          : `Fix the pivot source/configuration and retry ws.pivots.${methodName}().`,
  };
}

function pivotComputeEffects(
  sheetId: SheetId,
  pivotId: string,
  result: PivotTableResult,
): OperationEffect[] {
  const bounds = result.renderedBounds;
  const renderedCellCount =
    bounds && bounds.totalRows > 0 && bounds.totalCols > 0
      ? bounds.totalRows * bounds.totalCols
      : undefined;
  return [
    {
      type: 'computedGrid',
      sheetId,
      objectId: pivotId,
      ...(renderedCellCount != null ? { count: renderedCellCount } : {}),
    },
    {
      type: 'worksheetUnchanged',
      sheetId,
      objectId: pivotId,
    },
  ];
}

function pivotQueryEffects(sheetId: SheetId, pivotId: string): OperationEffect[] {
  return [
    {
      type: 'worksheetUnchanged',
      sheetId,
      objectId: pivotId,
    },
  ];
}

function pivotIdForRecord(config: { id?: string; name?: string }): string {
  return config.id ?? config.name ?? '';
}

async function findUnsupportedImportedPivot(input: {
  ctx: DocumentContext;
  sheetId: SheetId;
  name: string;
}): Promise<ImportedPivotViewRecord | null> {
  let records: ImportedPivotViewRecord[];
  try {
    records = await input.ctx.pivot.getImportedPivotViewRecords(input.sheetId);
  } catch {
    return null;
  }

  return (
    records.find((record) => {
      const recordName = record.config.name ?? record.config.id;
      const isUnsupported =
        record.sourceKind === 'unsupportedImport' || record.status === 'unsupported';
      return isUnsupported && recordName === input.name;
    }) ?? null
  );
}

async function resolvePivotReadTarget(input: {
  ctx: DocumentContext;
  sheetId: SheetId;
  name: string;
}): Promise<PivotReadTarget> {
  let pivots: DataPivotTableConfig[];
  try {
    pivots = await input.ctx.pivot.getAllPivots(input.sheetId);
  } catch (error) {
    return { status: 'failed', pivotId: input.name, error };
  }

  const matches = pivots.filter((pivot) => (pivot.name ?? pivot.id) === input.name);
  if (matches.length > 1) {
    return {
      status: 'failed',
      pivotId: input.name,
      message: `Pivot table name "${input.name}" is ambiguous; matching pivot IDs: ${matches
        .map((pivot) => pivot.id)
        .join(', ')}`,
    };
  }

  const pivot = matches[0];
  if (pivot) {
    return { status: 'found', pivotId: pivotIdFor(pivot) };
  }

  const unsupported = await findUnsupportedImportedPivot(input);
  if (unsupported) {
    return {
      status: 'unsupported',
      pivotId: pivotIdForRecord(unsupported.config) || input.name,
      message:
        unsupported.unsupportedReason ??
        unsupported.capabilities.unsupportedReason ??
        `Pivot table "${input.name}" is an unsupported imported pivot.`,
    };
  }

  return { status: 'notFound', pivotId: input.name };
}

function buildPivotComputeReceipt(input: {
  sheetId: SheetId;
  pivotId: string;
  result?: PivotTableResult | null;
  failureReason?: PivotReadReceiptFailureReason;
  message?: string;
  computeError?: unknown;
}): PivotComputeReceipt {
  const status: PivotComputeReceipt['status'] = input.failureReason
    ? input.failureReason === 'unsupported'
      ? 'unsupported'
      : 'failed'
    : input.result
      ? 'completed'
      : 'failed';
  const diagnostics =
    status === 'completed'
      ? []
      : [
          pivotReadDiagnostic({
            operation: 'compute',
            sheetId: input.sheetId,
            pivotId: input.pivotId,
            reason: input.failureReason ?? 'failed',
            message: input.message,
            error: input.computeError,
          }),
        ];

  return {
    kind: 'pivot.compute',
    status,
    effects:
      status === 'completed' && input.result
        ? pivotComputeEffects(input.sheetId, input.pivotId, input.result)
        : [],
    diagnostics,
    sheetId: input.sheetId,
    pivotId: input.pivotId,
    result: status === 'completed' ? (input.result ?? null) : null,
  };
}

export async function computePivotForReceipt(input: {
  ctx: DocumentContext;
  sheetId: SheetId;
  name: string;
  forceRefresh?: boolean;
}): Promise<PivotComputeReceipt> {
  const target = await resolvePivotReadTarget(input);
  if (target.status !== 'found') {
    return buildPivotComputeReceipt({
      sheetId: input.sheetId,
      pivotId: target.pivotId,
      failureReason: target.status,
      message: target.message,
      computeError: target.error,
    });
  }

  let result: PivotTableResult | null = null;
  let error: unknown;
  try {
    result = await input.ctx.pivot.compute(input.sheetId, target.pivotId, input.forceRefresh);
  } catch (caught) {
    error = caught;
  }

  return buildPivotComputeReceipt({
    sheetId: input.sheetId,
    pivotId: target.pivotId,
    result,
    computeError: error,
  });
}

function buildPivotQueryReceipt(input: {
  sheetId: SheetId;
  pivotId: string;
  result?: PivotQueryResult | null;
  failureReason?: PivotReadReceiptFailureReason;
  message?: string;
  queryError?: unknown;
}): PivotQueryReceipt {
  const status: PivotQueryReceipt['status'] = input.failureReason
    ? input.failureReason === 'unsupported'
      ? 'unsupported'
      : 'failed'
    : input.result
      ? 'completed'
      : 'failed';
  const diagnostics =
    status === 'completed'
      ? []
      : [
          pivotReadDiagnostic({
            operation: 'query',
            sheetId: input.sheetId,
            pivotId: input.pivotId,
            reason: input.failureReason ?? 'failed',
            message: input.message,
            error: input.queryError,
          }),
        ];

  return {
    kind: 'pivot.query',
    status,
    effects: status === 'completed' ? pivotQueryEffects(input.sheetId, input.pivotId) : [],
    diagnostics,
    sheetId: input.sheetId,
    pivotId: input.pivotId,
    result: status === 'completed' ? (input.result ?? null) : null,
  };
}

export async function queryPivotForReceipt(input: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
  filters?: Record<string, CellValue | CellValue[]>;
}): Promise<PivotQueryReceipt> {
  const target = await resolvePivotReadTarget({
    ctx: input.ctx,
    sheetId: input.sheetId,
    name: input.pivotName,
  });
  if (target.status !== 'found') {
    return buildPivotQueryReceipt({
      sheetId: input.sheetId,
      pivotId: target.pivotId,
      failureReason: target.status,
      message: target.message,
      queryError: target.error,
    });
  }

  let result: PivotQueryResult | null = null;
  let error: unknown;
  try {
    result = await queryPivotByName({
      ctx: input.ctx,
      sheetId: input.sheetId,
      pivotName: input.pivotName,
      filters: input.filters,
    });
  } catch (caught) {
    error = caught;
  }

  return buildPivotQueryReceipt({
    sheetId: input.sheetId,
    pivotId: target.pivotId,
    result,
    queryError: error,
  });
}
