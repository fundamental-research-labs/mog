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

export interface ImportDurabilityGate {
  readonly isImportDurabilityPending: boolean;
  scheduleDeferredHydration?(): Promise<void>;
  awaitMaterialized?(scope?: SheetId | 'allSheets'): Promise<void>;
  awaitImportDurability(): Promise<void>;
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
    .setRuntimeCustomSetting(ACTIVE_SHEET_CUSTOM_SETTING_KEY, String(activeSheetId))
    .catch((error) => {
      console.warn('[SpreadsheetApp] Failed to persist active sheet:', error);
    });
}

export function subscribeActiveSheetPersistence<TState extends ActiveSheetStoreState>({
  workbook,
  uiStore,
  importDurability,
}: {
  workbook: WorkbookInternal;
  uiStore: ActiveSheetStore<TState>;
  importDurability?: ImportDurabilityGate;
}): () => void {
  let disposed = false;
  let pendingActiveSheetId: SheetId | null = null;
  let pendingPersist: Promise<void> | null = null;

  const schedulePostImportPersist = (): void => {
    if (!importDurability || pendingPersist) return;

    const waitForBackgroundDurability =
      importDurability.scheduleDeferredHydration?.bind(importDurability) ??
      importDurability.awaitImportDurability.bind(importDurability);

    pendingPersist = waitForBackgroundDurability()
      .then(() => {
        const activeSheetId = pendingActiveSheetId;
        pendingActiveSheetId = null;
        if (!disposed && activeSheetId) {
          persistActiveSheetId(workbook, activeSheetId);
        }
      })
      .catch((error) => {
        pendingActiveSheetId = null;
        console.warn('[SpreadsheetApp] Failed to persist active sheet after import:', error);
      })
      .finally(() => {
        pendingPersist = null;
      });
  };

  const unsubscribe = uiStore.subscribe((state, previousState) => {
    if (state.activeSheetId === previousState.activeSheetId) return;
    if (importDurability?.isImportDurabilityPending) {
      pendingActiveSheetId = state.activeSheetId;
      schedulePostImportPersist();
      return;
    }
    persistActiveSheetId(workbook, state.activeSheetId);
  });

  return () => {
    disposed = true;
    pendingActiveSheetId = null;
    unsubscribe();
  };
}
