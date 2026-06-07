import type { WorkbookInternal } from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';
import type {
  AggregateFunction,
  PivotFieldArea,
  PivotFieldPlacementFlat,
  PivotTableConfig,
  PivotTableWithResult,
} from '@mog-sdk/contracts/pivot';
import type { ImportedPivotMetadataSet, ImportedPivotTableMetadata } from '@mog/shell';
import { parseCellRange } from '@mog/spreadsheet-utils/a1';

export interface ImportedPivotRuntime {
  getRenderedImportedPivots(sheetId: SheetId): Promise<ImportedPivotTableMetadata[]>;
  findRenderedImportedPivotAt(
    sheetId: SheetId,
    row: number,
    col: number,
  ): Promise<ImportedPivotTableMetadata | null>;
  getRenderedImportedPivotConfig(
    sheetId: SheetId,
    pivotId: string,
  ): Promise<PivotTableConfig | null>;
  getRenderedImportedPivotWithResult(
    sheetId: SheetId,
    pivotId: string,
  ): Promise<PivotTableWithResult | null>;
}

export interface WorkbookWithImportedPivots extends WorkbookInternal {
  readonly importedPivots?: ImportedPivotRuntime;
}

function toSyntheticPivotConfig(
  pivot: ImportedPivotTableMetadata,
  outputSheetId: SheetId,
): PivotTableConfig {
  const parsedSourceRange = pivot.sourceRange ? parseCellRange(pivot.sourceRange) : null;
  const fields = pivot.fields.map((field, index) => ({
    id: field.id,
    name: field.name,
    sourceColumn: index,
    dataType: 'string' as const,
  }));

  // Reconstruct the layout wells from the imported definition so the field
  // panel reflects the active pivot (Rows/Columns/Values) instead of showing
  // every field as unplaced.
  const placements: PivotFieldPlacementFlat[] = pivot.placements.map((placement) => ({
    placementId:
      `${pivot.id}:${placement.area}:${placement.fieldId}:${placement.position}` as PivotFieldPlacementFlat['placementId'],
    fieldId: placement.fieldId,
    area: placement.area as PivotFieldArea,
    position: placement.position,
    ...(placement.aggregateFunction
      ? { aggregateFunction: placement.aggregateFunction as AggregateFunction }
      : {}),
    ...(placement.displayName ? { displayName: placement.displayName } : {}),
  }));

  return {
    schemaVersion: 1,
    id: pivot.id,
    name: pivot.name,
    sourceSheetName: parsedSourceRange?.sheetName ?? pivot.sheetName,
    sourceRange: parsedSourceRange
      ? {
          startRow: parsedSourceRange.startRow,
          startCol: parsedSourceRange.startCol,
          endRow: parsedSourceRange.endRow,
          endCol: parsedSourceRange.endCol,
        }
      : {
          startRow: 0,
          startCol: 0,
          endRow: 0,
          endCol: Math.max(0, fields.length - 1),
        },
    outputSheetName: pivot.sheetName,
    outputSheetId,
    outputLocation: { row: pivot.range.startRow, col: pivot.range.startCol },
    fields,
    placements,
    filters: [],
    refRange: pivot.range.ref,
    cacheId: pivot.cacheId,
  };
}

function toSyntheticPivotWithResult(
  pivot: ImportedPivotTableMetadata,
  outputSheetId: SheetId,
): PivotTableWithResult {
  const totalRows = pivot.range.endRow - pivot.range.startRow + 1;
  const totalCols = pivot.range.endCol - pivot.range.startCol + 1;
  return {
    config: toSyntheticPivotConfig(pivot, outputSheetId),
    result: {
      columnHeaders: [],
      rows: [],
      grandTotals: {},
      sourceRowCount: 0,
      renderedBounds: {
        totalRows,
        totalCols,
        firstDataRow: 0,
        firstDataCol: 0,
        numDataCols: totalCols,
      },
    },
  };
}

export function installImportedPivotRuntime(
  workbook: WorkbookInternal,
  metadata: ImportedPivotMetadataSet | null,
): WorkbookInternal {
  const sheetIdsByImportedName = new Map<string, SheetId>();
  const bySheetId = new Map<SheetId, ImportedPivotTableMetadata[]>();
  let hydratePromise: Promise<void> | null = null;

  const hydrateSheetMap = async (): Promise<void> => {
    if (!hydratePromise) {
      hydratePromise = (async () => {
        for (const sheet of await workbook.getSheets()) {
          sheetIdsByImportedName.set(sheet.name, sheet.sheetId);
        }
        for (const pivot of metadata?.pivots ?? []) {
          const sheetId = sheetIdsByImportedName.get(pivot.sheetName);
          if (!sheetId) continue;
          const existing = bySheetId.get(sheetId) ?? [];
          existing.push(pivot);
          bySheetId.set(sheetId, existing);
        }
      })();
    }
    return hydratePromise;
  };

  const runtime: ImportedPivotRuntime = {
    async getRenderedImportedPivots(sheetId) {
      await hydrateSheetMap();
      return bySheetId.get(sheetId) ?? [];
    },
    async findRenderedImportedPivotAt(sheetId, row, col) {
      await hydrateSheetMap();
      const pivots = bySheetId.get(sheetId) ?? [];
      return (
        pivots.find(
          (pivot) =>
            row >= pivot.range.startRow &&
            row <= pivot.range.endRow &&
            col >= pivot.range.startCol &&
            col <= pivot.range.endCol,
        ) ?? null
      );
    },
    async getRenderedImportedPivotConfig(sheetId, pivotId) {
      await hydrateSheetMap();
      const pivot = (bySheetId.get(sheetId) ?? []).find((candidate) => candidate.id === pivotId);
      return pivot ? toSyntheticPivotConfig(pivot, sheetId) : null;
    },
    async getRenderedImportedPivotWithResult(sheetId, pivotId) {
      await hydrateSheetMap();
      const pivot = (bySheetId.get(sheetId) ?? []).find((candidate) => candidate.id === pivotId);
      return pivot ? toSyntheticPivotWithResult(pivot, sheetId) : null;
    },
  };

  Object.defineProperty(workbook, 'importedPivots', {
    configurable: true,
    enumerable: false,
    value: runtime,
  });

  return workbook;
}
