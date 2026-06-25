import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';

import type { PivotConfigEntry } from '../../pivot/pivot-view-records';
import { awaitPivotMaterialization } from './pivot-receipt-utils';

function pivotEntryMatchesId(entry: PivotConfigEntry, pivotId: string): boolean {
  return entry.config.id === pivotId || entry.alternateIds?.includes(pivotId) === true;
}

function findPivotEntryById(entries: PivotConfigEntry[], pivotId: string): PivotConfigEntry | null {
  return entries.find((entry) => pivotEntryMatchesId(entry, pivotId)) ?? null;
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
  startEditingPivot: (pivotId: string) => void;
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
  startEditingPivot,
  stopEditingPivot,
}: UsePivotInteractionLifecycleOptions): void {
  const selectedOrEditingMissReloadKeyRef = useRef<string | null>(null);
  const selectedOrEditingMissRecoveryKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const targetPivotId = editingPivotId ?? selectedPivotId;
    if (!targetPivotId) {
      selectedOrEditingMissReloadKeyRef.current = null;
      selectedOrEditingMissRecoveryKeyRef.current = null;
      return;
    }

    if (!hasLoadedPivotEntries) {
      selectedOrEditingMissReloadKeyRef.current = null;
      return;
    }

    if (findPivotEntryById(pivotEntries, targetPivotId)) {
      selectedOrEditingMissReloadKeyRef.current = null;
      selectedOrEditingMissRecoveryKeyRef.current = null;
      return;
    }

    const reloadKey = `${sheetId}:${targetPivotId}`;
    if (selectedOrEditingMissReloadKeyRef.current === reloadKey) return;
    selectedOrEditingMissReloadKeyRef.current = reloadKey;
    selectedOrEditingMissRecoveryKeyRef.current = reloadKey;

    let cancelled = false;
    const refreshMaterializedConfigs = async () => {
      try {
        const entries = await loadPivotEntries();
        if (cancelled) return;
        if (findPivotEntryById(entries, targetPivotId)) {
          selectedOrEditingMissRecoveryKeyRef.current = null;
          setPivotEntries(entries);
          return;
        }
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
        if (!cancelled) {
          selectedOrEditingMissRecoveryKeyRef.current = null;
          setPivotEntries(entries);
        }
      } catch {
        if (!cancelled) {
          selectedOrEditingMissRecoveryKeyRef.current = null;
          setPivotEntries([]);
        }
      }
    };

    void refreshMaterializedConfigs();

    return () => {
      cancelled = true;
      if (selectedOrEditingMissRecoveryKeyRef.current === reloadKey) {
        selectedOrEditingMissRecoveryKeyRef.current = null;
      }
    };
  }, [
    editingPivotId,
    hasLoadedPivotEntries,
    loadPivotEntries,
    pivotEntries,
    selectedPivotId,
    setPivotEntries,
    sheetId,
    wb,
  ]);

  useEffect(() => {
    if (!hasLoadedPivotEntries) return;

    const selectedEntry =
      selectedPivotId != null ? findPivotEntryById(pivotEntries, selectedPivotId) : null;
    const editingEntry =
      editingPivotId != null ? findPivotEntryById(pivotEntries, editingPivotId) : null;

    if (editingEntry && editingPivotId !== editingEntry.config.id) {
      startEditingPivot(editingEntry.config.id);
      return;
    }
    if (selectedEntry && selectedPivotId !== selectedEntry.config.id) {
      selectPivot(selectedEntry.config.id);
      return;
    }

    const isRecoveringMissingPivot = (pivotId: string): boolean =>
      selectedOrEditingMissRecoveryKeyRef.current === `${sheetId}:${pivotId}`;
    if (
      (selectedPivotId != null && isRecoveringMissingPivot(selectedPivotId)) ||
      (editingPivotId != null && isRecoveringMissingPivot(editingPivotId))
    ) {
      return;
    }

    const selectedMissing =
      selectedPivotId != null && !selectedPivotId.startsWith('imported:') && !selectedEntry;
    const editingMissing =
      editingPivotId != null && !editingPivotId.startsWith('imported:') && !editingEntry;

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
    startEditingPivot,
    stopEditingPivot,
    sheetId,
  ]);
}
