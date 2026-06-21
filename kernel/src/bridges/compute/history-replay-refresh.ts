import { sheetId as toSheetId, type SheetId } from '@mog-sdk/contracts/core';

import type { MutationResult } from './compute-types.gen';
import type { ViewportFetchManager } from './viewport-fetch-manager';

function historyReplayNeedsFullViewportRefresh(result: MutationResult): boolean {
  return Boolean(
    result.commentChanges?.length ||
    result.filterChanges?.length ||
    result.tableChanges?.length ||
    result.slicerChanges?.length ||
    result.sheetChanges?.length ||
    result.settingsChanges?.length ||
    result.pageBreakChanges?.length ||
    result.printAreaChanges?.length ||
    result.printTitlesChanges?.length ||
    result.printSettingsChanges?.length ||
    result.splitConfigChanges?.length ||
    result.scrollPositionChanges?.length ||
    result.viewSelectionChanges?.length ||
    result.workbookSettingsChanges?.length ||
    result.cfChanges?.length ||
    result.namedRangeChanges?.length ||
    result.groupingChanges?.length ||
    result.sparklineChanges?.length ||
    result.sortingChanges?.length ||
    result.structureChanges?.length ||
    result.floatingObjectChanges?.length ||
    result.floatingObjectGroupChanges?.length ||
    result.pivotChanges?.length ||
    result.rangeChanges?.length,
  );
}

function historyReplayCellValueSheetIds(result: MutationResult): SheetId[] {
  const sheetIds = new Set<SheetId>();
  for (const change of result.recalc?.changedCells ?? []) {
    sheetIds.add(toSheetId(change.sheetId));
  }
  for (const change of result.recalc?.projectionChanges ?? []) {
    sheetIds.add(toSheetId(change.sheetId));
  }
  for (const change of result.dimensionChanges ?? []) {
    sheetIds.add(toSheetId(change.sheetId));
  }
  for (const change of result.mergeChanges ?? []) {
    sheetIds.add(toSheetId(change.sheetId));
  }
  for (const change of result.visibilityChanges ?? []) {
    sheetIds.add(toSheetId(change.sheetId));
  }
  return [...sheetIds];
}

export async function refreshViewportsAfterHistoryReplay(
  fetchManager: ViewportFetchManager | null | undefined,
  result: MutationResult,
): Promise<void> {
  if (!fetchManager) return;

  if (historyReplayNeedsFullViewportRefresh(result)) {
    await fetchManager.forceRefreshAllViewports();
    return;
  }

  const sheetIds = historyReplayCellValueSheetIds(result);
  if (sheetIds.length === 0) return;

  await Promise.all(sheetIds.map((sheetId) => fetchManager.forceRefreshSheetViewports(sheetId)));
}
