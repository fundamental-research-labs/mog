import type { PivotTableHandle, WorkbookInternal } from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { PivotTableConfig, PivotTableResult } from '@mog-sdk/contracts/pivot';

import type { WorkbookWithImportedPivots } from './imported-pivot-runtime';
import {
  createPivotCapabilitiesForSource,
  type PivotCapabilities,
  type PivotSourceKind,
} from './pivot-capabilities';
import {
  pivotBoundsContain,
  pivotBoundsForConfig,
  pivotBoundsForImportedRecord,
  pivotBoundsOverlap,
  type PivotBounds,
} from './pivot-view-geometry';

export interface PivotConfigEntry {
  config: PivotTableConfig;
  sourceKind: PivotSourceKind;
  importIdentity?: string;
  capabilities: PivotCapabilities;
  handle?: PivotTableHandle;
  result?: PivotTableResult | null;
}

export async function loadPivotConfigEntries(
  workbook: WorkbookInternal,
  sheetId: SheetId,
): Promise<PivotConfigEntry[]> {
  const worksheet = workbook.getSheetById(sheetId);
  const allConfigs = await worksheet.pivots.getAll();
  const importedViewRecords = await worksheet.pivots.getImportedViewRecords();
  const promotedRecordsByPivotId = new Map(
    importedViewRecords
      .filter((record) => record.sourceKind === 'promotedImport')
      .map((record) => [record.nativePivotId ?? record.config.id, record]),
  );

  const nativeEntries: PivotConfigEntry[] = await Promise.all(
    allConfigs.map(async (config) => {
      const importedRecord = promotedRecordsByPivotId.get(config.id);
      return {
        config,
        sourceKind: importedRecord ? 'promotedImport' : 'native',
        importIdentity: importedRecord?.importIdentity,
        capabilities: importedRecord
          ? {
              ...createPivotCapabilitiesForSource(
                importedRecord.sourceKind,
                importedRecord.unsupportedReason,
              ),
              ...importedRecord.capabilities,
            }
          : createPivotCapabilitiesForSource('native'),
        handle: (await worksheet.pivots.get(config)) ?? undefined,
      };
    }),
  );

  const persistedUnsupportedEntries: PivotConfigEntry[] = importedViewRecords
    .filter((record) => record.sourceKind === 'unsupportedImport')
    .map((record) => ({
      config: record.config,
      sourceKind: record.sourceKind,
      importIdentity: record.importIdentity,
      capabilities: {
        ...createPivotCapabilitiesForSource(record.sourceKind, record.unsupportedReason),
        ...record.capabilities,
      },
      result: record.result ?? null,
    }));

  const nativeIds = new Set(nativeEntries.map((entry) => entry.config.id));
  const persistedConfigIds = new Set(
    importedViewRecords.flatMap((record) =>
      [record.config.id, record.nativePivotId].filter((id): id is string => Boolean(id)),
    ),
  );
  const persistedImportIdentities = new Set(
    importedViewRecords.map((record) => record.importIdentity),
  );
  const persistedRanges = [...nativeEntries, ...persistedUnsupportedEntries].map((entry) =>
    pivotBoundsForConfig(entry.config),
  );

  const importedPivotRuntime = (workbook as WorkbookWithImportedPivots).importedPivots;
  const sidecarEntries: Array<PivotConfigEntry | null> = importedPivotRuntime
    ? await Promise.all(
        (await importedPivotRuntime.getRenderedImportedPivots(sheetId)).map(
          async (pivot): Promise<PivotConfigEntry | null> => {
            const config = await importedPivotRuntime.getRenderedImportedPivotConfig(
              sheetId,
              pivot.id,
            );
            if (
              !config ||
              nativeIds.has(config.id) ||
              persistedConfigIds.has(config.id) ||
              persistedImportIdentities.has(pivot.importIdentity) ||
              persistedRanges.some((range) => pivotBoundsOverlap(range, pivot.range))
            ) {
              return null;
            }
            return {
              config,
              sourceKind: 'unsupportedImport',
              importIdentity: pivot.importIdentity,
              capabilities: createPivotCapabilitiesForSource('unsupportedImport'),
            };
          },
        ),
      )
    : [];

  return [
    ...nativeEntries,
    ...persistedUnsupportedEntries,
    ...sidecarEntries.filter((entry): entry is PivotConfigEntry => entry != null),
  ];
}

export async function findEditablePivotAtCell(
  workbook: WorkbookInternal,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<string | null> {
  try {
    const worksheet = workbook.getSheetById(sheetId);
    const editablePivots = await worksheet.pivots.getAll();
    for (const pivot of editablePivots) {
      const handle = await worksheet.pivots.get(pivot);
      const range = handle ? await handle.getRange().catch(() => null) : null;
      const bounds = range ?? pivotBoundsForConfig(pivot);
      if (pivotBoundsContain(bounds, row, col)) {
        return pivot.id;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export async function findImportedPivotAtCell(
  workbook: WorkbookInternal,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<string | null> {
  try {
    const worksheet = workbook.getSheetById(sheetId);
    const knownPivotIds = new Set<string>();
    const knownImportIdentities = new Set<string>();
    const knownRanges: PivotBounds[] = [];

    const editablePivots = await worksheet.pivots.getAll().catch(() => []);
    for (const pivot of editablePivots) {
      knownPivotIds.add(pivot.id);
      const handle = await worksheet.pivots.get(pivot);
      const range = handle ? await handle.getRange().catch(() => null) : null;
      knownRanges.push(range ?? pivotBoundsForConfig(pivot));
    }

    const persistedRecords = await worksheet.pivots.getImportedViewRecords();
    for (const record of persistedRecords) {
      knownPivotIds.add(record.config.id);
      if (record.nativePivotId) knownPivotIds.add(record.nativePivotId);
      knownImportIdentities.add(record.importIdentity);
      const bounds = pivotBoundsForImportedRecord(record);
      knownRanges.push(bounds);
      if (pivotBoundsContain(bounds, row, col)) {
        return record.sourceKind === 'promotedImport'
          ? (record.nativePivotId ?? record.config.id)
          : record.config.id;
      }
    }

    const sidecarPivot = await (
      workbook as WorkbookWithImportedPivots
    ).importedPivots?.findRenderedImportedPivotAt(sheetId, row, col);
    if (!sidecarPivot) {
      return null;
    }

    const isDuplicate =
      knownPivotIds.has(sidecarPivot.id) ||
      knownImportIdentities.has(sidecarPivot.importIdentity) ||
      knownRanges.some((range) => pivotBoundsOverlap(range, sidecarPivot.range));
    return isDuplicate ? null : sidecarPivot.id;
  } catch {
    return null;
  }
}

export async function findPivotAtCell(
  workbook: WorkbookInternal,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<string | null> {
  return (
    (await findEditablePivotAtCell(workbook, sheetId, row, col)) ??
    (await findImportedPivotAtCell(workbook, sheetId, row, col))
  );
}
