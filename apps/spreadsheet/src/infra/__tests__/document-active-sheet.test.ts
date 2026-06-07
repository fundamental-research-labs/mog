import { jest } from '@jest/globals';
import type { WorkbookInternal } from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';
import { sheetId } from '@mog-sdk/contracts/core';

import {
  ACTIVE_SHEET_CUSTOM_SETTING_KEY,
  type ImportDurabilityGate,
  subscribeActiveSheetPersistence,
} from '../document-active-sheet';

type Listener = (
  state: { activeSheetId: SheetId },
  previousState: { activeSheetId: SheetId },
) => void;

function createStore(initial: SheetId) {
  let state = { activeSheetId: initial };
  const listeners = new Set<Listener>();

  return {
    getState: () => state,
    subscribe: (listener: Listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setActiveSheet: (activeSheetId: SheetId) => {
      const previousState = state;
      state = { activeSheetId };
      for (const listener of listeners) listener(state, previousState);
    },
  };
}

function createWorkbook(sheetIds: SheetId[]) {
  return {
    mirror: {
      getSheetIds: () => sheetIds,
      getSheetMeta: (id: SheetId) => ({
        name: String(id),
        hidden: false,
        tabColor: null,
      }),
    },
    setCustomSetting: jest.fn(async () => undefined),
  } as unknown as WorkbookInternal & {
    setCustomSetting: jest.Mock<Promise<void>, [string, string]>;
  };
}

describe('subscribeActiveSheetPersistence', () => {
  it('persists active sheet changes immediately when import durability is not pending', () => {
    const first = sheetId('sheet-1');
    const second = sheetId('sheet-2');
    const workbook = createWorkbook([first, second]);
    const store = createStore(first);

    const unsubscribe = subscribeActiveSheetPersistence({ workbook, uiStore: store });
    store.setActiveSheet(second);
    unsubscribe();

    expect(workbook.setCustomSetting).toHaveBeenCalledWith(ACTIVE_SHEET_CUSTOM_SETTING_KEY, second);
  });

  it('waits for scheduled background hydration and then persists only the latest active sheet', async () => {
    const first = sheetId('sheet-1');
    const second = sheetId('sheet-2');
    const third = sheetId('sheet-3');
    const workbook = createWorkbook([first, second, third]);
    const store = createStore(first);
    let resolveDurability!: () => void;
    const durabilityPromise = new Promise<void>((resolve) => {
      resolveDurability = resolve;
    });
    let pending = true;
    const importDurability: ImportDurabilityGate = {
      get isImportDurabilityPending() {
        return pending;
      },
      scheduleDeferredHydration: jest.fn(() => durabilityPromise),
      awaitImportDurability: jest.fn(() => durabilityPromise),
    };

    const unsubscribe = subscribeActiveSheetPersistence({
      workbook,
      uiStore: store,
      importDurability,
    });
    store.setActiveSheet(second);
    store.setActiveSheet(third);

    expect(workbook.setCustomSetting).not.toHaveBeenCalled();
    expect(importDurability.scheduleDeferredHydration).toHaveBeenCalledTimes(1);
    expect(importDurability.awaitImportDurability).not.toHaveBeenCalled();

    pending = false;
    resolveDurability();
    await durabilityPromise;
    await Promise.resolve();
    unsubscribe();

    expect(workbook.setCustomSetting).toHaveBeenCalledTimes(1);
    expect(workbook.setCustomSetting).toHaveBeenCalledWith(ACTIVE_SHEET_CUSTOM_SETTING_KEY, third);
  });

  it('does not persist a deferred active sheet after unsubscribe', async () => {
    const first = sheetId('sheet-1');
    const second = sheetId('sheet-2');
    const workbook = createWorkbook([first, second]);
    const store = createStore(first);
    let resolveDurability!: () => void;
    const durabilityPromise = new Promise<void>((resolve) => {
      resolveDurability = resolve;
    });
    const importDurability: ImportDurabilityGate = {
      isImportDurabilityPending: true,
      scheduleDeferredHydration: jest.fn(() => durabilityPromise),
      awaitImportDurability: jest.fn(() => durabilityPromise),
    };

    const unsubscribe = subscribeActiveSheetPersistence({
      workbook,
      uiStore: store,
      importDurability,
    });
    store.setActiveSheet(second);
    unsubscribe();

    resolveDurability();
    await durabilityPromise;
    await Promise.resolve();

    expect(workbook.setCustomSetting).not.toHaveBeenCalled();
  });
});
