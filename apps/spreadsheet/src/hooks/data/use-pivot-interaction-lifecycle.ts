import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';

import type { PivotConfigEntry } from '../../pivot/pivot-view-records';
import { awaitPivotMaterialization } from './pivot-receipt-utils';

function pivotEntryMatchesId(entry: PivotConfigEntry, pivotId: string): boolean {
  return entry.config.id === pivotId || entry.alternateIds?.includes(pivotId) === true;
}

export interface UsePivotInteractionLifecycleOptions {
  sheetId: string;
  wb: Parameters<typeof awaitPivotMaterialization>[0];
  selectedPivotId: string | null;
  editingPivotId: string | null;
  pivotEntries: PivotConfigEntry[];
  hasLoadedPivotEntries: boolean;
  loadPivotEntries: () => Promise<PivotConfigEntry[]>;
  setPivotEntries: Dispatch<SetStateAction<PivotConfigEntry[]>>;
  selectPivot: (pivotId: string | null) => void;
  stopEditingPivot: () => void;
}

export function usePivotInteractionLifecycle({
  sheetId,
  wb,
  selectedPivotId,
  editingPivotId,
  pivotEntries,
  hasLoadedPivotEntries,
  loadPivotEntries,
  setPivotEntries,
  selectPivot,
  stopEditingPivot,
}: UsePivotInteractionLifecycleOptions): void {
  const selectedOrEditingMissReloadKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const targetPivotId = editingPivotId ?? selectedPivotId;
    if (!targetPivotId) {
      selectedOrEditingMissReloadKeyRef.current = null;
      return;
    }

    if (pivotEntries.some((entry) => pivotEntryMatchesId(entry, targetPivotId))) {
      selectedOrEditingMissReloadKeyRef.current = null;
      return;
    }

    const reloadKey = `${sheetId}:${targetPivotId}`;
    if (selectedOrEditingMissReloadKeyRef.current === reloadKey) return;
    selectedOrEditingMissReloadKeyRef.current = reloadKey;

    let cancelled = false;
    const refreshMaterializedConfigs = async () => {
      try {
        const entries = await loadPivotEntries();
        if (cancelled) return;
        setPivotEntries(entries);
        if (entries.some((entry) => pivotEntryMatchesId(entry, targetPivotId))) return;
      } catch {
        // Fall through to the materialization-backed retry below.
      }

      try {
        await awaitPivotMaterialization(wb);
      } catch {
        // Materialization failures should not hide any already-available sidecar
        // or persisted imported pivot records.
      }

      try {
        const entries = await loadPivotEntries();
        if (!cancelled) setPivotEntries(entries);
      } catch {
        if (!cancelled) setPivotEntries([]);
      }
    };

    void refreshMaterializedConfigs();

    return () => {
      cancelled = true;
    };
  }, [
    editingPivotId,
    loadPivotEntries,
    pivotEntries,
    selectedPivotId,
    setPivotEntries,
    sheetId,
    wb,
  ]);

  useEffect(() => {
    if (!hasLoadedPivotEntries) return;

    const selectedMissing =
      selectedPivotId != null &&
      !selectedPivotId.startsWith('imported:') &&
      !pivotEntries.some((entry) => pivotEntryMatchesId(entry, selectedPivotId));
    const editingMissing =
      editingPivotId != null &&
      !editingPivotId.startsWith('imported:') &&
      !pivotEntries.some((entry) => pivotEntryMatchesId(entry, editingPivotId));

    if (selectedMissing) {
      selectPivot(null);
      return;
    }
    if (editingMissing) {
      stopEditingPivot();
    }
  }, [
    editingPivotId,
    hasLoadedPivotEntries,
    pivotEntries,
    selectPivot,
    selectedPivotId,
    stopEditingPivot,
  ]);
}
