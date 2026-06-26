/**
 * Filter Action Handlers
 *
 * Pure handler functions for filter-related actions.
 * These handlers are called by the unified action dispatcher.
 *
 * ARCHITECTURE:
 * - All filter operations delegate to Worksheet API (ws.*)
 * - Rust evaluates filter criteria and updates row visibility in the same mutation
 * - No direct kernel/store imports — fully migrated to ws.filters.* API
 */

import type {
  ActionDependencies,
  ActionHandler,
  ActionResult,
  AsyncActionHandler,
} from '@mog-sdk/contracts/actions';

import { recordFilterReadinessError } from '../../infra/diagnostics/filter-readiness-errors';
import { guardBridgeMutation } from './bridge-error-guard';
import { getUIStore, handled, notHandled } from './handler-utils';

function getWs(deps: ActionDependencies) {
  return deps.workbook.getSheetById(deps.getActiveSheetId());
}

type WorksheetApi = ReturnType<typeof getWs>;
type WorksheetFilterInfo = {
  readonly id: string;
  readonly filterKind: 'autoFilter' | 'tableFilter' | 'advancedFilter';
};

type FilterOperationReceipt = {
  readonly status: string;
  readonly effects: readonly unknown[];
  readonly diagnostics: readonly { severity?: string; message?: string }[];
  readonly filterId?: string;
};

function isAdvancedFilterInfo(filter: { filterKind?: string } | null | undefined): boolean {
  return filter?.filterKind === 'advancedFilter';
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function asFilterReceipt(value: unknown): FilterOperationReceipt | null {
  if (!isRecord(value)) return null;
  return typeof value.status === 'string' &&
    Array.isArray(value.effects) &&
    Array.isArray(value.diagnostics)
    ? (value as FilterOperationReceipt)
    : null;
}

function filterReceiptOverrides(
  receipts: readonly unknown[],
): Omit<Partial<ActionResult>, 'handled'> {
  const operationReceipts = receipts.map(asFilterReceipt).filter((r) => r !== null);
  if (operationReceipts.length === 0) return {};
  return { receipts: operationReceipts as NonNullable<ActionResult['receipts']> };
}

function filterReceiptError(receipt: unknown, fallback: string): string | null {
  const r = asFilterReceipt(receipt);
  if (!r) return null;
  if (r.status !== 'failed' && r.status !== 'unsupported' && r.status !== 'noOp') return null;
  return (
    r.diagnostics.find((diagnostic) => diagnostic.severity === 'error')?.message ??
    r.diagnostics[0]?.message ??
    fallback
  );
}

function handledFilterReceiptError(
  receipt: unknown,
  fallback: string,
  receipts: readonly unknown[] = [receipt],
): ActionResult | null {
  const error = filterReceiptError(receipt, fallback);
  if (!error) return null;
  return handled({ ...filterReceiptOverrides(receipts), error });
}

function filterIdFromReceipt(receipt: unknown): string | null {
  if (!isRecord(receipt)) return null;
  if (typeof receipt.filterId === 'string') return receipt.filterId;

  const effects = Array.isArray(receipt.effects) ? receipt.effects : [];
  for (const effect of effects) {
    if (!isRecord(effect)) continue;
    if (typeof effect.objectId === 'string') return effect.objectId;
    const details = isRecord(effect.details) ? effect.details : null;
    if (details && typeof details.filterId === 'string') return details.filterId;
    if (details && typeof details.objectId === 'string') return details.objectId;
  }

  return null;
}

async function resolveCreatedFilter(
  ws: WorksheetApi,
  activeCell: { col: number },
  receipt: unknown,
): Promise<WorksheetFilterInfo | null> {
  const receiptFilterId = filterIdFromReceipt(receipt);
  if (receiptFilterId) {
    return { id: receiptFilterId, filterKind: 'autoFilter' };
  }
  return ws.filters.getForRange({
    startRow: 0,
    startCol: activeCell.col,
    endRow: 0,
    endCol: activeCell.col,
  });
}

export const FILTER_BY_SELECTED_VALUE: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const ws = getWs(deps);
  const activeCell = deps.accessors.selection.getActiveCell();

  if (!activeCell) {
    return notHandled('disabled');
  }

  // Get the value to filter by
  const cellData = await ws.getCell(activeCell.row, activeCell.col);
  const cellValue = cellData?.value;

  // Find or create a filter for this region
  let filter = await ws.filters.getForRange({
    startRow: 0,
    startCol: activeCell.col,
    endRow: 0,
    endCol: activeCell.col,
  });

  if (isAdvancedFilterInfo(filter)) {
    return notHandled('disabled');
  }

  const receipts: unknown[] = [];
  if (!filter) {
    const receipt = await ws.filters.setAutoFilter({
      startRow: 0,
      startCol: 0,
      endRow: 1000,
      endCol: activeCell.col + 1,
    });
    receipts.push(receipt);
    const receiptError = handledFilterReceiptError(
      receipt,
      'Filter creation did not apply.',
      receipts,
    );
    if (receiptError) return receiptError;
    filter = await resolveCreatedFilter(ws, activeCell, receipt);
  }

  if (!filter || isAdvancedFilterInfo(filter)) {
    return notHandled('disabled');
  }

  const receipt = await ws.filters.setColumnFilter(
    activeCell.col,
    {
      type: 'value',
      values: cellValue !== undefined ? [cellValue] : [],
    },
    filter.id,
  );
  receipts.push(receipt);
  const receiptError = handledFilterReceiptError(
    receipt,
    'Selected-value filter did not apply.',
    receipts,
  );
  if (receiptError) return receiptError;

  return handled(filterReceiptOverrides(receipts));
};

export const FILTER_BY_COLOR: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const ws = getWs(deps);
  const activeCell = deps.accessors.selection.getActiveCell();

  if (!activeCell) {
    return notHandled('disabled');
  }

  // Get cell colors via format
  const format = await ws.formats.get(activeCell.row, activeCell.col);
  const backgroundColor = format?.backgroundColor;
  const fontColor = format?.fontColor;

  if (!backgroundColor && !fontColor) {
    return notHandled('disabled');
  }

  // Find or create a filter for this region
  let filter = await ws.filters.getForRange({
    startRow: 0,
    startCol: activeCell.col,
    endRow: 0,
    endCol: activeCell.col,
  });

  if (isAdvancedFilterInfo(filter)) {
    return notHandled('disabled');
  }

  const receipts: unknown[] = [];
  if (!filter) {
    const receipt = await ws.filters.setAutoFilter({
      startRow: 0,
      startCol: 0,
      endRow: 1000,
      endCol: activeCell.col + 1,
    });
    receipts.push(receipt);
    const receiptError = handledFilterReceiptError(
      receipt,
      'Filter creation did not apply.',
      receipts,
    );
    if (receiptError) return receiptError;
    filter = await resolveCreatedFilter(ws, activeCell, receipt);
  }

  if (!filter || isAdvancedFilterInfo(filter)) {
    return notHandled('disabled');
  }

  const colorType: 'fill' | 'font' = backgroundColor ? 'fill' : 'font';
  const color = backgroundColor || fontColor;

  const receipt = await ws.filters.setColumnFilter(
    activeCell.col,
    {
      type: 'color',
      colorFilter: { type: colorType, color: color! },
    },
    filter.id,
  );
  receipts.push(receipt);
  const receiptError = handledFilterReceiptError(receipt, 'Color filter did not apply.', receipts);
  if (receiptError) return receiptError;

  return handled(filterReceiptOverrides(receipts));
};

export const FILTER_BY_FONT_COLOR: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const ws = getWs(deps);
  const activeCell = deps.accessors.selection.getActiveCell();

  if (!activeCell) {
    return notHandled('disabled');
  }

  const format = await ws.formats.get(activeCell.row, activeCell.col);
  const fontColor = format?.fontColor;

  if (!fontColor) {
    return notHandled('disabled');
  }

  let filter = await ws.filters.getForRange({
    startRow: 0,
    startCol: activeCell.col,
    endRow: 0,
    endCol: activeCell.col,
  });

  if (isAdvancedFilterInfo(filter)) {
    return notHandled('disabled');
  }

  const receipts: unknown[] = [];
  if (!filter) {
    const receipt = await ws.filters.setAutoFilter({
      startRow: 0,
      startCol: 0,
      endRow: 1000,
      endCol: activeCell.col + 1,
    });
    receipts.push(receipt);
    const receiptError = handledFilterReceiptError(
      receipt,
      'Filter creation did not apply.',
      receipts,
    );
    if (receiptError) return receiptError;
    filter = await resolveCreatedFilter(ws, activeCell, receipt);
  }

  if (!filter || isAdvancedFilterInfo(filter)) {
    return notHandled('disabled');
  }

  const receipt = await ws.filters.setColumnFilter(
    activeCell.col,
    {
      type: 'color',
      colorFilter: { type: 'font', color: fontColor },
    },
    filter.id,
  );
  receipts.push(receipt);
  const receiptError = handledFilterReceiptError(
    receipt,
    'Font color filter did not apply.',
    receipts,
  );
  if (receiptError) return receiptError;

  return handled(filterReceiptOverrides(receipts));
};

export const CLEAR_FILTER: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const ws = getWs(deps);
  const activeCell = deps.accessors.selection.getActiveCell();

  if (!activeCell) {
    return notHandled('disabled');
  }

  const filter = await ws.filters.getForRange({
    startRow: activeCell.row,
    startCol: activeCell.col,
    endRow: activeCell.row,
    endCol: activeCell.col,
  });

  if (!filter) {
    return notHandled('disabled');
  }

  const receipt = await ws.filters.remove(filter.id);
  const receiptError = handledFilterReceiptError(receipt, 'Filter removal did not apply.');
  if (receiptError) return receiptError;

  return handled(filterReceiptOverrides([receipt]));
};

export const OPEN_ADVANCED_FILTER_DIALOG: ActionHandler = (
  deps: ActionDependencies,
): ActionResult => {
  const uiStore = getUIStore(deps);
  const sheetId = deps.getActiveSheetId();

  // Try to get the current selection to pre-populate the list range
  // Use getDataBoundedRanges to constrain full column/row selections to actual data bounds
  let initialListRange = '';
  const ranges = deps.accessors.selection.getDataBoundedRanges(sheetId);
  if (ranges && ranges.length > 0) {
    const range = ranges[0];
    // Convert range to A1 notation
    initialListRange = rangeToA1Notation(range);
  }

  uiStore.getState().openAdvancedFilterDialog(initialListRange);
  return handled();
};

export const CLOSE_ADVANCED_FILTER_DIALOG: ActionHandler = (
  deps: ActionDependencies,
): ActionResult => {
  const uiStore = getUIStore(deps);
  uiStore.getState().closeAdvancedFilterDialog();
  return handled();
};

export const APPLY_ADVANCED_FILTER: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const ws = getWs(deps);
  const uiStore = getUIStore(deps);

  // Read dialog state
  const dialogState = uiStore.getState().advancedFilterDialog;

  if (!dialogState.listRange.trim()) {
    uiStore.getState().setAdvancedFilterError('List range is required.');
    return handled();
  }

  if (!dialogState.filterInPlace) {
    if (!dialogState.copyToRange.trim()) {
      uiStore
        .getState()
        .setAdvancedFilterError('Copy to range is required when not filtering in place.');
      return handled();
    }
  }

  try {
    let receipt: unknown;
    const ok = await guardBridgeMutation(async () => {
      receipt = await ws.filters.applyAdvanced({
        listRange: dialogState.listRange,
        criteriaRange: dialogState.criteriaRange || undefined,
        mode: dialogState.filterInPlace ? 'inPlace' : 'copyTo',
        copyToRange: dialogState.filterInPlace ? undefined : dialogState.copyToRange,
        uniqueRecordsOnly: dialogState.uniqueRecordsOnly,
      } as Parameters<typeof ws.filters.applyAdvanced>[0]);
    });
    const receiptOverrides = filterReceiptOverrides([receipt]);
    if (!ok) return handled(receiptOverrides);
    const receiptError = filterReceiptError(receipt, 'Advanced Filter failed.');
    if (receiptError) {
      uiStore.getState().setAdvancedFilterError(receiptError);
      return handled({ ...receiptOverrides, error: receiptError });
    }
    uiStore.getState().closeAdvancedFilterDialog();
    return handled(receiptOverrides);
  } catch (err) {
    uiStore
      .getState()
      .setAdvancedFilterError(err instanceof Error ? err.message : 'Advanced Filter failed.');
  }

  return handled();
};

function rangeToA1Notation(range: {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}): string {
  const startCol = columnToLetter(range.startCol);
  const endCol = columnToLetter(range.endCol);
  const startRow = range.startRow + 1;
  const endRow = range.endRow + 1;

  if (range.startRow === range.endRow && range.startCol === range.endCol) {
    return `${startCol}${startRow}`;
  }
  return `${startCol}${startRow}:${endCol}${endRow}`;
}

function columnToLetter(col: number): string {
  let result = '';
  let c = col;
  while (c >= 0) {
    result = String.fromCharCode((c % 26) + 65) + result;
    c = Math.floor(c / 26) - 1;
  }
  return result;
}

export const CLEAR_ALL_FILTERS: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const ws = getWs(deps);
  const sheetId = deps.getActiveSheetId();
  let operation = 'filters.listSummaries';

  try {
    const allFilters = await ws.filters.listSummaries();
    const clearableFilters = allFilters.filter((filter) => {
      const hasActiveFilter = filter.hasActiveFilter ?? filter.hasActiveCriteria;
      return filter.clearable ?? hasActiveFilter;
    });

    if (clearableFilters.length === 0) {
      return handled(); // No filters to clear
    }

    operation = 'filters.clearAllCriteria';
    const receipts: unknown[] = [];
    for (const filter of clearableFilters) {
      const receipt = await ws.filters.clearAllCriteria(filter.id);
      receipts.push(receipt);
      const receiptError = filterReceiptError(receipt, 'Filter criteria did not clear.');
      if (receiptError) {
        recordFilterReadinessError({
          source: 'dataTabClear',
          sheetId,
          operation,
          error: new Error(receiptError),
        });
        return handled({ ...filterReceiptOverrides(receipts), error: receiptError });
      }
    }

    return handled(filterReceiptOverrides(receipts));
  } catch (error) {
    recordFilterReadinessError({
      source: 'dataTabClear',
      sheetId,
      operation,
      error,
    });
    throw error;
  }
};

export const REAPPLY_FILTERS: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const ws = getWs(deps);
  const sheetId = deps.getActiveSheetId();
  let operation = 'filters.listSummaries';

  try {
    const allFilters = await ws.filters.listSummaries();

    if (!allFilters || allFilters.length === 0) {
      return handled(); // No filters to reapply
    }

    operation = 'filters.apply';
    const receipts: unknown[] = [];
    for (const filter of allFilters) {
      if (filter.filterKind === 'advancedFilter') {
        const hasActiveFilter =
          filter.hasActiveFilter ?? filter.hasActiveCriteria ?? (filter.activeColumnCount ?? 0) > 0;
        if (!hasActiveFilter) continue;

        operation = 'filters.getInfo';
        const details = await ws.filters.getInfo(filter.id);
        if (!details?.advancedFilter?.active) continue;

        operation = 'filters.applyAdvanced';
        const receipt = await ws.filters.applyAdvanced({
          listRange: rangeToA1Notation(details.range),
          criteriaRange: details.advancedFilter.criteriaRange
            ? rangeToA1Notation(details.advancedFilter.criteriaRange)
            : undefined,
          mode: 'inPlace',
          uniqueRecordsOnly: details.advancedFilter.uniqueRecordsOnly,
          filterId: filter.id,
        });
        receipts.push(receipt);
        const receiptError = filterReceiptError(receipt, 'Advanced Filter did not reapply.');
        if (receiptError) {
          recordFilterReadinessError({
            source: 'dataTabReapply',
            sheetId,
            operation,
            error: new Error(receiptError),
          });
          return handled({ ...filterReceiptOverrides(receipts), error: receiptError });
        }
      } else {
        operation = 'filters.reapply';
        const receipt = await ws.filters.reapply(filter.id);
        receipts.push(receipt);
        const receiptError = filterReceiptError(receipt, 'Filter did not reapply.');
        if (receiptError) {
          recordFilterReadinessError({
            source: 'dataTabReapply',
            sheetId,
            operation,
            error: new Error(receiptError),
          });
          return handled({ ...filterReceiptOverrides(receipts), error: receiptError });
        }
      }
    }

    return handled(filterReceiptOverrides(receipts));
  } catch (error) {
    recordFilterReadinessError({
      source: 'dataTabReapply',
      sheetId,
      operation,
      error,
    });
    throw error;
  }
};
