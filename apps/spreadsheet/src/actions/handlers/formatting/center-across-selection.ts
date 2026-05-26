import type { ActionDependencies, ActionResult } from '@mog-sdk/contracts/actions';
import type { MergedRegion } from '@mog-sdk/contracts/api';
import { MAX_COLS, MAX_ROWS, type CellFormat, type CellRange } from '@mog-sdk/contracts/core';

import { toA1 } from '@mog/spreadsheet-utils/a1';

import { callUIStoreAction, getSelectionContext, handled } from './shared';

export const CENTER_ACROSS_SELECTION_LABEL = 'Center Across Selection';

export type CenterAcrossDisabledReason =
  | 'No selection'
  | 'Whole-row selections are not supported for Center Across Selection'
  | 'Whole-column selections are not supported for Center Across Selection'
  | 'Formatting cells is disabled on this protected sheet';

export interface CenterAcrossAvailability {
  enabled: boolean;
  reason?: CenterAcrossDisabledReason;
}

export function normalizeCenterAcrossRange(range: CellRange): CellRange {
  return {
    ...range,
    startRow: Math.min(range.startRow, range.endRow),
    startCol: Math.min(range.startCol, range.endCol),
    endRow: Math.max(range.startRow, range.endRow),
    endCol: Math.max(range.startCol, range.endCol),
  };
}

export function getCenterAcrossSelectionAvailability(
  ranges: readonly CellRange[],
): CenterAcrossAvailability {
  if (ranges.length === 0) {
    return { enabled: false, reason: 'No selection' };
  }

  for (const range of ranges) {
    const normalized = normalizeCenterAcrossRange(range);
    const isFullRow =
      normalized.isFullRow === true ||
      (normalized.startCol === 0 && normalized.endCol === MAX_COLS - 1);
    if (isFullRow) {
      return {
        enabled: false,
        reason: 'Whole-row selections are not supported for Center Across Selection',
      };
    }

    const isFullColumn =
      normalized.isFullColumn === true ||
      (normalized.startRow === 0 && normalized.endRow === MAX_ROWS - 1);
    if (isFullColumn) {
      return {
        enabled: false,
        reason: 'Whole-column selections are not supported for Center Across Selection',
      };
    }
  }

  return { enabled: true };
}

export async function applyCenterAcrossSelectionFormat(
  deps: ActionDependencies,
  format: Partial<CellFormat>,
): Promise<ActionResult> {
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);
  const { ranges } = getSelectionContext(deps);
  const availability = getCenterAcrossSelectionAvailability(ranges);

  if (!availability.enabled) {
    notifyCenterAcrossBlocked(deps, availability.reason ?? 'No selection', 'invalid_range');
    return { handled: false, reason: 'disabled' };
  }

  const canFormat = await ws.protection.canDoStructureOp('formatCells');
  if (!canFormat) {
    const reason = 'Formatting cells is disabled on this protected sheet';
    notifyCenterAcrossBlocked(deps, reason, 'protection');
    return { handled: false, reason: 'disabled' };
  }

  const normalizedRanges = ranges.map(normalizeCenterAcrossRange);
  const mergeConflict = findIntersectingMerge(
    await ws.structure.getMergedRegions(),
    normalizedRanges,
  );
  if (mergeConflict) {
    const reason = `Cannot apply Center Across Selection through merged cells (${describeMerge(mergeConflict)}). Unmerge first.`;
    notifyCenterAcrossBlocked(deps, reason, 'merge_conflict');
    return { handled: true, error: reason };
  }

  deps.workbook.setPendingUndoDescription(CENTER_ACROSS_SELECTION_LABEL);
  await deps.workbook.undoGroup(async () => {
    await ws.formats.setRanges(normalizedRanges, format);
  });

  return handled();
}

function findIntersectingMerge(
  merges: readonly MergedRegion[],
  ranges: readonly CellRange[],
): MergedRegion | null {
  for (const range of ranges) {
    for (const merge of merges) {
      if (
        merge.startRow <= range.endRow &&
        merge.endRow >= range.startRow &&
        merge.startCol <= range.endCol &&
        merge.endCol >= range.startCol
      ) {
        return merge;
      }
    }
  }
  return null;
}

function describeMerge(merge: MergedRegion): string {
  if (merge.startRow === merge.endRow && merge.startCol === merge.endCol) {
    return toA1(merge.startRow, merge.startCol);
  }
  return `${toA1(merge.startRow, merge.startCol)}:${toA1(merge.endRow, merge.endCol)}`;
}

function notifyCenterAcrossBlocked(
  deps: ActionDependencies,
  message: string,
  type: 'merge_conflict' | 'protection' | 'invalid_range',
): void {
  callUIStoreAction(deps, (state) => {
    state.setSelectionError?.(type, message);
    state.showProtectionAlert?.(message);
  });
}
