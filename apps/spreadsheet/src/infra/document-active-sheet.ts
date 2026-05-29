import type { WorkbookInternal } from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';

export const ACTIVE_SHEET_CUSTOM_SETTING_KEY = 'mog.activeSheetId';

interface ActiveSheetStoreState {
  activeSheetId: SheetId;
}

interface ActiveSheetStore<TState extends ActiveSheetStoreState> {
  getState(): TState;
  subscribe(listener: (state: TState, previousState: TState) => void): () => void;
}

function isVisibleSheet(workbook: WorkbookInternal, candidate: string | null | undefined): boolean {
  if (!candidate) return false;

  const id = toSheetId(candidate);
  if (!workbook.mirror.getSheetIds().includes(id)) return false;

  try {
    return !workbook.mirror.getSheetMeta(id).hidden;
  } catch {
    return false;
  }
}

function firstVisibleSheetId(workbook: WorkbookInternal): SheetId | null {
  for (const id of workbook.mirror.getSheetIds()) {
    if (isVisibleSheet(workbook, id)) return id;
  }
  return null;
}

export async function resolveInitialActiveSheetId({
  workbook,
  initialSheetId,
}: {
  workbook: WorkbookInternal;
  initialSheetId: SheetId;
}): Promise<SheetId> {
  let storedActiveSheetId: string | null = null;
  try {
    storedActiveSheetId = await workbook.getCustomSetting(ACTIVE_SHEET_CUSTOM_SETTING_KEY);
  } catch (error) {
    console.warn('[SpreadsheetApp] Failed to restore active sheet:', error);
  }

  if (storedActiveSheetId && isVisibleSheet(workbook, storedActiveSheetId)) {
    return toSheetId(storedActiveSheetId);
  }

  const selectedSheetIds = workbook.mirror.getSelectedSheetIds();
  if (selectedSheetIds.length === 1 && isVisibleSheet(workbook, selectedSheetIds[0])) {
    return selectedSheetIds[0];
  }

  if (isVisibleSheet(workbook, initialSheetId)) {
    return initialSheetId;
  }

  return firstVisibleSheetId(workbook) ?? initialSheetId;
}

export function persistActiveSheetId(workbook: WorkbookInternal, activeSheetId: SheetId): void {
  if (!isVisibleSheet(workbook, activeSheetId)) return;

  void workbook
    .setCustomSetting(ACTIVE_SHEET_CUSTOM_SETTING_KEY, String(activeSheetId))
    .catch((error) => {
      console.warn('[SpreadsheetApp] Failed to persist active sheet:', error);
    });
}

export function subscribeActiveSheetPersistence<TState extends ActiveSheetStoreState>({
  workbook,
  uiStore,
}: {
  workbook: WorkbookInternal;
  uiStore: ActiveSheetStore<TState>;
}): () => void {
  return uiStore.subscribe((state, previousState) => {
    if (state.activeSheetId === previousState.activeSheetId) return;
    persistActiveSheetId(workbook, state.activeSheetId);
  });
}
