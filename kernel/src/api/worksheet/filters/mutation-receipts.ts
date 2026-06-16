import type { SheetId } from '@mog-sdk/contracts/core';
import type { ColumnFilterCriteria, DynamicFilterRule } from '@mog-sdk/contracts/filter';
import type {
  FilterMutationKind,
  FilterMutationReceipt,
  OperationDiagnostic,
  OperationEffect,
} from '@mog-sdk/contracts/api';

import type {
  FilterChange,
  FilterState,
  MutationResult,
  RuntimeOperationDiagnostic,
} from '../../../bridges/compute/compute-types.gen';
import { columnFilterCriteriaToCompute } from '../../../bridges/compute/compute-wire-converters';
import type { DocumentContext } from '../../../context';
import { toA1 } from '../../internal/utils';
import { resolveFilterRange, type ResolvedFilterRange } from '../filter-range-resolution';
import { assertFilterMutationAllowed } from '../protected-table-operations';

interface BuildFilterMutationReceiptOptions {
  readonly kind: FilterMutationKind;
  readonly sheetId: SheetId;
  readonly filterId?: string;
  readonly column?: number;
  readonly filter?: FilterState | null;
  readonly range?: ResolvedFilterRange | string | null;
  readonly result?: MutationResult | null;
  readonly status?: FilterMutationReceipt['status'];
  readonly diagnostics?: readonly OperationDiagnostic[];
}

function rangeToA1(range: ResolvedFilterRange | string | null | undefined): string | undefined {
  if (typeof range === 'string') return range;
  if (!range) return undefined;
  return `${toA1(range.startRow, range.startCol)}:${toA1(range.endRow, range.endCol)}`;
}

function filterChangeForReceipt(
  result: MutationResult | null | undefined,
  sheetId: SheetId,
  filterId: string | undefined,
): FilterChange | undefined {
  const changes = result?.filterChanges ?? [];
  if (filterId) {
    const exact = changes.find(
      (change) => change.sheetId === sheetId && change.filterId === filterId,
    );
    if (exact) return exact;
  }
  return changes.find((change) => change.sheetId === sheetId);
}

function diagnosticIsUnsupported(diagnostic: RuntimeOperationDiagnostic): boolean {
  return (
    diagnostic.recoverability === 'unsupported_preserved' ||
    diagnostic.code.includes('unsupported') ||
    diagnostic.code.includes('materialization') ||
    Boolean(diagnostic.reason || diagnostic.reasons?.length)
  );
}

function runtimeDiagnosticToOperationDiagnostic(
  diagnostic: RuntimeOperationDiagnostic,
): OperationDiagnostic {
  const reasons = diagnostic.reasons?.length ? diagnostic.reasons.join(', ') : diagnostic.reason;
  return {
    severity:
      diagnostic.severity === 'error'
        ? 'error'
        : diagnostic.severity === 'info'
          ? 'info'
          : 'warning',
    code: diagnostic.code,
    message: reasons
      ? `${diagnostic.operation} reported ${diagnostic.code}: ${reasons}`
      : `${diagnostic.operation} reported ${diagnostic.code}`,
    target: {
      sheetId: diagnostic.sheetId,
      stage: diagnostic.operation,
      ...(diagnostic.filterId ? { objectId: diagnostic.filterId } : {}),
    },
    recoverable: diagnostic.recoverability !== 'fatal',
    details: {
      id: diagnostic.id,
      sequence: diagnostic.sequence,
      recoverability: diagnostic.recoverability,
      filterKind: diagnostic.filterKind,
      tableId: diagnostic.tableId,
      reason: diagnostic.reason,
      reasons: diagnostic.reasons,
      details: diagnostic.details,
      location: diagnostic.location,
    },
  };
}

function fallbackUnsupportedDiagnostic(
  sheetId: SheetId,
  filterId: string | undefined,
  reasons: readonly string[],
): OperationDiagnostic {
  return {
    severity: 'warning',
    code: 'filter.unsupportedPreservedCriteria',
    message:
      reasons.length > 0
        ? `Filter contains unsupported preserved criteria: ${reasons.join(', ')}`
        : 'Filter contains unsupported preserved criteria',
    target: {
      sheetId,
      stage: 'filterMutation',
      ...(filterId ? { objectId: filterId } : {}),
    },
    recoverable: true,
    details: {
      filterId,
      reasons,
    },
  };
}

function statusForFilterReceipt(
  explicitStatus: FilterMutationReceipt['status'] | undefined,
  change: FilterChange | undefined,
  diagnostics: readonly RuntimeOperationDiagnostic[],
): FilterMutationReceipt['status'] {
  if (explicitStatus) return explicitStatus;
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) return 'failed';
  if (
    change?.capability === 'unsupported' ||
    Boolean(change?.unsupportedReasons?.length) ||
    diagnostics.some(diagnosticIsUnsupported)
  ) {
    return 'unsupported';
  }
  return 'applied';
}

function changedProjectionEffect(
  sheetId: SheetId,
  range: string | undefined,
  column: number | undefined,
  change: FilterChange | undefined,
): OperationEffect | null {
  if (!change) return null;
  const hasCounts =
    typeof change.hiddenRowCount === 'number' || typeof change.visibleRowCount === 'number';
  const hasProjectionAction = change.action === 'applied' || change.action === 'cleared';
  if (!hasCounts && !hasProjectionAction) return null;
  return {
    type: 'changedFilterProjection',
    sheetId,
    ...(range ? { range } : {}),
    details: {
      filterId: change.filterId,
      filterKind: change.filterKind,
      tableId: change.tableId,
      action: change.action,
      column,
      hiddenRowCount: change.hiddenRowCount,
      visibleRowCount: change.visibleRowCount,
      unsupportedReasons: change.unsupportedReasons,
    },
  };
}

export function buildFilterMutationReceipt(
  options: BuildFilterMutationReceiptOptions,
): FilterMutationReceipt {
  const change = filterChangeForReceipt(options.result, options.sheetId, options.filterId);
  const runtimeDiagnostics = [
    ...(options.result?.diagnostics ?? []),
    ...(change?.diagnostics ?? []),
  ];
  const dedupedRuntimeDiagnostics = runtimeDiagnostics.filter(
    (diagnostic, index, diagnostics) =>
      diagnostics.findIndex(
        (candidate) =>
          candidate.id === diagnostic.id && candidate.sequence === diagnostic.sequence,
      ) === index,
  );
  const unsupportedReasons = change?.unsupportedReasons;
  const diagnostics = [
    ...dedupedRuntimeDiagnostics.map(runtimeDiagnosticToOperationDiagnostic),
    ...(options.diagnostics ?? []),
  ];
  const status = statusForFilterReceipt(options.status, change, dedupedRuntimeDiagnostics);
  const range = rangeToA1(options.range);
  const projectionEffect =
    status === 'noOp'
      ? null
      : changedProjectionEffect(options.sheetId, range, options.column, change);
  const effects: OperationEffect[] = projectionEffect ? [projectionEffect] : [];
  const filterId = change?.filterId ?? options.filterId ?? options.filter?.id;
  const filterKind = change?.filterKind ?? options.filter?.type;
  const tableId = change?.tableId ?? options.filter?.tableId;
  if (status === 'unsupported' && diagnostics.length === 0) {
    diagnostics.push(
      fallbackUnsupportedDiagnostic(options.sheetId, filterId, unsupportedReasons ?? []),
    );
  }

  return {
    kind: options.kind,
    status,
    sheetId: options.sheetId,
    effects,
    diagnostics,
    ...(filterId ? { filterId } : {}),
    ...(filterKind ? { filterKind } : {}),
    ...(tableId ? { tableId } : {}),
    ...(range ? { range } : {}),
    ...(options.column !== undefined ? { column: options.column } : {}),
    ...(typeof change?.hiddenRowCount === 'number'
      ? { hiddenRowCount: change.hiddenRowCount }
      : {}),
    ...(typeof change?.visibleRowCount === 'number'
      ? { visibleRowCount: change.visibleRowCount }
      : {}),
    ...(unsupportedReasons?.length ? { unsupportedReasons } : {}),
    ...(change?.hasActiveFilter !== undefined ? { hasActiveFilter: change.hasActiveFilter } : {}),
    ...(change?.clearable !== undefined ? { clearable: change.clearable } : {}),
  };
}

export async function getFilterById(
  ctx: DocumentContext,
  sheetId: SheetId,
  filterId: string,
): Promise<FilterState | null> {
  const filters = await ctx.computeBridge.getFiltersInSheet(sheetId);
  return filters.find((filter) => filter.id === filterId) ?? null;
}

export async function resolveFilterForMutation(
  ctx: DocumentContext,
  sheetId: SheetId,
  filterId?: string,
): Promise<FilterState | null> {
  const filters = await ctx.computeBridge.getFiltersInSheet(sheetId);
  return filterId
    ? (filters.find((filter) => filter.id === filterId) ?? null)
    : (filters[0] ?? null);
}

export async function resolveHeaderCellIdForFilterColumn(
  ctx: DocumentContext,
  sheetId: SheetId,
  filter: FilterState,
  headerRow: number,
  col: number,
): Promise<string | null> {
  const directCellId = await ctx.computeBridge.getCellIdAt(sheetId, headerRow, col);
  if (directCellId) return directCellId;

  for (const headerCellId of Object.keys(filter.columnFilters ?? {})) {
    const headerPos = await ctx.computeBridge.getCellPosition(sheetId, headerCellId);
    if (headerPos?.row === headerRow && headerPos.col === col) return headerCellId;
  }
  return null;
}

export async function columnFilterIsClear(
  ctx: DocumentContext,
  sheetId: SheetId,
  filter: FilterState,
  range: ResolvedFilterRange,
  col: number,
): Promise<boolean> {
  if (Object.keys(filter.columnFilters ?? {}).length === 0) return true;
  const headerCellId = await resolveHeaderCellIdForFilterColumn(
    ctx,
    sheetId,
    filter,
    range.startRow,
    col,
  );
  return !headerCellId || !filter.columnFilters?.[headerCellId];
}

export async function setColumnFilterWithReceipt(
  ctx: DocumentContext,
  sheetId: SheetId,
  col: number,
  criteria: ColumnFilterCriteria,
  filterId?: string,
): Promise<FilterMutationReceipt> {
  await ctx.awaitMaterialized?.('allSheets');
  const filter = await resolveFilterForMutation(ctx, sheetId, filterId);
  if (!filter) {
    return buildFilterMutationReceipt({
      kind: 'filter.columnFilter.set',
      status: 'noOp',
      sheetId,
      filterId,
      column: col,
    });
  }
  await assertFilterMutationAllowed(ctx, sheetId, 'filters.setColumnFilter', filter.id);
  const range = await resolveFilterRange(ctx, sheetId, filter);
  const result = await ctx.computeBridge.setColumnFilter(
    sheetId,
    filter.id,
    col,
    columnFilterCriteriaToCompute(criteria),
  );
  return buildFilterMutationReceipt({
    kind: 'filter.columnFilter.set',
    sheetId,
    filterId: filter.id,
    column: col,
    filter,
    range,
    result,
  });
}

export async function applyDynamicFilterWithReceipt(
  ctx: DocumentContext,
  sheetId: SheetId,
  col: number,
  rule: DynamicFilterRule,
  filterId?: string,
): Promise<FilterMutationReceipt> {
  await ctx.awaitMaterialized?.('allSheets');
  const filter = await resolveFilterForMutation(ctx, sheetId, filterId);
  if (!filter) {
    return buildFilterMutationReceipt({
      kind: 'filter.dynamicFilter.apply',
      status: 'noOp',
      sheetId,
      filterId,
      column: col,
    });
  }
  await assertFilterMutationAllowed(ctx, sheetId, 'filters.setColumnFilter', filter.id);

  const serialRange = await ctx.computeBridge.computeDynamicFilterSerialRange(rule);
  const criteria: ColumnFilterCriteria =
    serialRange !== null
      ? {
          type: 'condition',
          conditions: [
            {
              operator: 'between',
              value: serialRange[0],
              value2: serialRange[1],
            },
          ],
          conditionLogic: 'and',
        }
      : {
          type: 'dynamic',
          dynamicFilter: { rule },
        };

  const range = await resolveFilterRange(ctx, sheetId, filter);
  const result = await ctx.computeBridge.setColumnFilter(
    sheetId,
    filter.id,
    col,
    columnFilterCriteriaToCompute(criteria),
  );
  return buildFilterMutationReceipt({
    kind: 'filter.dynamicFilter.apply',
    sheetId,
    filterId: filter.id,
    column: col,
    filter,
    range,
    result,
  });
}

export async function clearColumnFilterWithReceipt(
  ctx: DocumentContext,
  sheetId: SheetId,
  col: number,
  filterId?: string,
): Promise<FilterMutationReceipt> {
  await ctx.awaitMaterialized?.('allSheets');
  const filter = await resolveFilterForMutation(ctx, sheetId, filterId);
  if (!filter) {
    return buildFilterMutationReceipt({
      kind: 'filter.columnFilter.clear',
      status: 'noOp',
      sheetId,
      filterId,
      column: col,
    });
  }
  const range = await resolveFilterRange(ctx, sheetId, filter);
  if (await columnFilterIsClear(ctx, sheetId, filter, range, col)) {
    return buildFilterMutationReceipt({
      kind: 'filter.columnFilter.clear',
      status: 'noOp',
      sheetId,
      filterId: filter.id,
      column: col,
      filter,
      range,
    });
  }
  await assertFilterMutationAllowed(ctx, sheetId, 'filters.clearColumnFilter', filter.id);
  const result = await ctx.computeBridge.clearColumnFilter(sheetId, filter.id, col);
  return buildFilterMutationReceipt({
    kind: 'filter.columnFilter.clear',
    sheetId,
    filterId: filter.id,
    column: col,
    filter,
    range,
    result,
  });
}

export async function clearAllCriteriaWithReceipt(
  ctx: DocumentContext,
  sheetId: SheetId,
  filterId: string,
): Promise<FilterMutationReceipt> {
  await ctx.awaitMaterialized?.('allSheets');
  const filter = await resolveFilterForMutation(ctx, sheetId, filterId);
  if (!filter) {
    return buildFilterMutationReceipt({
      kind: 'filter.criteria.clearAll',
      status: 'noOp',
      sheetId,
      filterId,
    });
  }
  const range = await resolveFilterRange(ctx, sheetId, filter);
  if (Object.keys(filter.columnFilters ?? {}).length === 0) {
    return buildFilterMutationReceipt({
      kind: 'filter.criteria.clearAll',
      status: 'noOp',
      sheetId,
      filterId,
      filter,
      range,
    });
  }
  await assertFilterMutationAllowed(ctx, sheetId, 'filters.clearAllColumnFilters', filterId);
  const result = await ctx.computeBridge.clearAllColumnFilters(sheetId, filterId);
  return buildFilterMutationReceipt({
    kind: 'filter.criteria.clearAll',
    sheetId,
    filterId,
    filter,
    range,
    result,
  });
}

export async function applyFilterWithReceipt(
  ctx: DocumentContext,
  sheetId: SheetId,
  filterId: string,
): Promise<FilterMutationReceipt> {
  await ctx.awaitMaterialized?.('allSheets');
  const filter = await resolveFilterForMutation(ctx, sheetId, filterId);
  if (!filter) {
    return buildFilterMutationReceipt({
      kind: 'filter.apply',
      status: 'noOp',
      sheetId,
      filterId,
    });
  }
  await assertFilterMutationAllowed(ctx, sheetId, 'filters.apply', filterId);
  const range = await resolveFilterRange(ctx, sheetId, filter);
  const result = await ctx.computeBridge.applyFilter(sheetId, filterId);
  return buildFilterMutationReceipt({
    kind: 'filter.apply',
    sheetId,
    filterId,
    filter,
    range,
    result,
  });
}

export async function reapplyFilterWithReceipt(
  ctx: DocumentContext,
  sheetId: SheetId,
  filterId: string,
): Promise<FilterMutationReceipt> {
  await ctx.awaitMaterialized?.('allSheets');
  const filter = await resolveFilterForMutation(ctx, sheetId, filterId);
  if (!filter) {
    return buildFilterMutationReceipt({
      kind: 'filter.reapply',
      status: 'noOp',
      sheetId,
      filterId,
    });
  }
  await assertFilterMutationAllowed(ctx, sheetId, 'filters.reapply', filterId);
  const range = await resolveFilterRange(ctx, sheetId, filter);
  const result = await ctx.computeBridge.reapplyFilter(sheetId, filterId);
  return buildFilterMutationReceipt({
    kind: 'filter.reapply',
    sheetId,
    filterId,
    filter,
    range,
    result,
  });
}
