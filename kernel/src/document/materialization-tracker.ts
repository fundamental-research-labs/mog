import type { SheetId } from '@mog-sdk/contracts/core';

export function materializedSheetIdsForDeferredImport(
  sheetIds: readonly SheetId[],
  selectedSheetIds: readonly SheetId[],
): readonly SheetId[] {
  const sheetIdSet = new Set(sheetIds);
  const selectedImportedSheetIds = selectedSheetIds.filter((sheetId) => sheetIdSet.has(sheetId));
  return selectedImportedSheetIds.length > 0 ? selectedImportedSheetIds : sheetIds.slice(0, 1);
}

/**
 * Tracks only deferred-import materialization scope.
 *
 * This is deliberately not a sheet registry. Sheet existence belongs to the
 * workbook/compute layer that dereferences sheets. The lifecycle only needs to
 * know whether a requested scope is part of the imported workbook state that
 * has not completed deferred hydration yet.
 */
export class DocumentMaterializationTracker {
  private deferredSheetIds = new Set<SheetId>();

  reset(): void {
    this.deferredSheetIds.clear();
  }

  markDeferredImport(
    sheetIds: readonly SheetId[],
    materializedSheetIds: readonly SheetId[],
  ): void {
    this.deferredSheetIds.clear();
    const materialized = new Set(materializedSheetIds);
    for (const sheetId of sheetIds) {
      if (!materialized.has(sheetId)) {
        this.deferredSheetIds.add(sheetId);
      }
    }
  }

  markAllMaterialized(): void {
    this.deferredSheetIds.clear();
  }

  requiresDeferredHydration(scope: SheetId | 'allSheets'): boolean {
    if (scope === 'allSheets') return this.deferredSheetIds.size > 0;
    return this.deferredSheetIds.has(scope);
  }
}
