import type { StoreApi } from 'zustand';

import { sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { IFloatingObjectManager } from '@mog-sdk/contracts/kernel';

import type { FloatingObjectCache } from '../cache/floating-object-cache';
import type { UIState } from '../ui-store';
import type { SheetSwitchImportDurabilityGate } from './types';

interface FloatingObjectSceneResync {
  resyncScene?: (opts: { force: true; sheetId: string }) => void;
}

export interface FloatingObjectSheetPopulationConfig {
  uiStore: StoreApi<UIState>;
  floatingObjects: IFloatingObjectManager;
  floatingObjectCache: FloatingObjectCache;
  getRendererObjects: () => FloatingObjectSceneResync | null;
  getActiveSheetId: () => string;
  importDurability?: SheetSwitchImportDurabilityGate;
  isDisposed: () => boolean;
  getGeneration: () => number;
  scheduleSceneResync?: (callback: () => void) => void;
}

export function setupFloatingObjectSheetPopulation({
  uiStore,
  floatingObjects,
  floatingObjectCache,
  getRendererObjects,
  getActiveSheetId,
  importDurability,
  isDisposed,
  getGeneration,
  scheduleSceneResync = (callback) => requestAnimationFrame(callback),
}: FloatingObjectSheetPopulationConfig): () => void {
  const isCurrent = (sheetId: string, generation: number): boolean =>
    !isDisposed() && getGeneration() === generation && getActiveSheetId() === sheetId;

  const populateAndResync = async (newSheetId: string): Promise<void> => {
    if (isDisposed()) return;
    const generation = getGeneration();

    if (importDurability?.isImportDurabilityPending) {
      const waitForBackgroundHydration = importDurability.scheduleDeferredHydration?.();
      if (!waitForBackgroundHydration) return;
      try {
        await waitForBackgroundHydration;
      } catch (err) {
        console.warn(
          '[SheetCoordinator] Failed to wait for import hydration before floating-object population:',
          err,
        );
      }
      if (!isCurrent(newSheetId, generation)) return;
    }

    const sheet = toSheetId(newSheetId);
    const [objects, bounds] = await Promise.all([
      floatingObjects.getObjectsInSheet(sheet),
      floatingObjects.computeAllObjectBounds(sheet),
    ]);
    if (!isCurrent(newSheetId, generation)) return;

    floatingObjectCache.getState().setObjectsForSheet(newSheetId, objects, bounds);

    scheduleSceneResync(() => {
      if (!isCurrent(newSheetId, generation)) return;
      getRendererObjects()?.resyncScene?.({ force: true, sheetId: newSheetId });
    });
  };

  return uiStore.subscribe((state, prevState) => {
    if (state.activeSheetId !== prevState.activeSheetId) {
      void populateAndResync(state.activeSheetId);
    }
  });
}
