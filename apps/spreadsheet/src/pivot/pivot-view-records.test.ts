import { jest } from '@jest/globals';

import type { SheetId } from '@mog-sdk/contracts/core';
import type { PivotTableConfig } from '@mog-sdk/contracts/pivot';

import { findPivotAtCell, loadPivotConfigEntries } from './pivot-view-records';

const importIdentity =
  'ooxml:outputWorksheetPartPath=xl/worksheets/sheet2.xml;worksheetRelationshipId=rIdPT1;definitionPartPath=xl/pivotTables/pivotTable1.xml;pivotCacheRelationshipId=;cacheId=1';

function pivotConfig(id: string): PivotTableConfig {
  return {
    schemaVersion: 2,
    id,
    name: 'PivotTable1',
    sourceSheetName: 'Data',
    sourceRange: { startRow: 0, startCol: 0, endRow: 3, endCol: 2 },
    outputSheetName: 'Pivot',
    outputLocation: { row: 0, col: 0 },
    fields: [],
    placements: [],
    filters: [],
  };
}

describe('loadPivotConfigEntries', () => {
  it('derives the original imported sidecar id as an alternate id for persisted imports', async () => {
    const record = {
      sourceKind: 'unsupportedImport',
      status: 'unsupported',
      importIdentity,
      outputSheetId: 'sheet-1',
      config: pivotConfig('pivot-imported-abc'),
      capabilities: {},
    };
    const pivots = {
      getAll: jest.fn(async () => []),
      getImportedViewRecords: jest.fn(async () => [record]),
      get: jest.fn(),
    };
    const workbook = {
      getSheetById: jest.fn(() => ({ pivots })),
    };

    const entries = await loadPivotConfigEntries(workbook as any, 'sheet-1' as SheetId);

    expect(entries).toHaveLength(1);
    expect(entries[0].alternateIds).toContain('imported:Pivot:xl/pivotTables/pivotTable1.xml');
  });

  it('keeps original imported ids as alternate ids after import promotion', async () => {
    const config = pivotConfig('pivot-imported-abc');
    const record = {
      sourceKind: 'promotedImport',
      status: 'promoted',
      importIdentity,
      outputSheetId: 'sheet-1',
      config,
      capabilities: {},
    };
    const handle = {};
    const pivots = {
      getAll: jest.fn(async () => [config]),
      getImportedViewRecords: jest.fn(async () => [record]),
      get: jest.fn(async () => handle),
    };
    const importedPivots = {
      getRenderedImportedPivots: jest.fn(async () => [
        {
          id: 'imported:Pivot:xl/pivotTables/pivotTable1.xml',
          importIdentity,
          range: { startRow: 0, startCol: 0, endRow: 4, endCol: 3 },
        },
      ]),
      getRenderedImportedPivotConfig: jest.fn(async () => null),
    };
    const workbook = {
      getSheetById: jest.fn(() => ({ pivots })),
      importedPivots,
    };

    const entries = await loadPivotConfigEntries(workbook as any, 'sheet-1' as SheetId);

    expect(entries).toHaveLength(1);
    expect(entries[0].sourceKind).toBe('promotedImport');
    expect(entries[0].handle).toBe(handle);
    expect(entries[0].alternateIds).toEqual(['imported:Pivot:xl/pivotTables/pivotTable1.xml']);
  });
});

describe('findPivotAtCell', () => {
  it('materializes a raw imported sidecar hit before returning an editable native pivot id', async () => {
    let materialized = false;
    const nativeConfig = {
      ...pivotConfig('pivot-imported-native'),
      refRange: 'B2:D4',
    };
    const getAll = jest.fn(async () => (materialized ? [nativeConfig] : []));
    const getImportedViewRecords = jest.fn(async () => []);
    const get = jest.fn(async () => ({ getRange: jest.fn(async () => null) }));
    const awaitMaterialized = jest.fn(async () => {
      materialized = true;
    });
    const workbook = {
      ctx: { awaitMaterialized },
      getSheetById: jest.fn(() => ({ pivots: { getAll, get, getImportedViewRecords } })),
      importedPivots: {
        findRenderedImportedPivotAt: jest.fn(async () => ({
          id: 'imported:Pivot:xl/pivotTables/pivotTable1.xml',
          importIdentity,
          range: { startRow: 1, startCol: 1, endRow: 3, endCol: 3 },
        })),
      },
    };

    const hit = await findPivotAtCell(workbook as any, 'sheet-1' as SheetId, 1, 1);

    expect(awaitMaterialized).toHaveBeenCalledWith('allSheets');
    expect(hit).toBe('pivot-imported-native');
  });

  it('falls back to the sidecar id when imported-pivot materialization fails', async () => {
    const getAll = jest.fn(async () => []);
    const getImportedViewRecords = jest.fn(async () => []);
    const get = jest.fn(async () => ({ getRange: jest.fn(async () => null) }));
    const awaitMaterialized = jest.fn(async () => {
      throw new Error('materialization failed');
    });
    const workbook = {
      ctx: { awaitMaterialized },
      getSheetById: jest.fn(() => ({ pivots: { getAll, get, getImportedViewRecords } })),
      importedPivots: {
        findRenderedImportedPivotAt: jest.fn(async () => ({
          id: 'imported:Pivot:xl/pivotTables/pivotTable1.xml',
          importIdentity,
          range: { startRow: 1, startCol: 1, endRow: 3, endCol: 3 },
        })),
      },
    };

    const hit = await findPivotAtCell(workbook as any, 'sheet-1' as SheetId, 1, 1);

    expect(awaitMaterialized).toHaveBeenCalledWith('allSheets');
    expect(hit).toBe('imported:Pivot:xl/pivotTables/pivotTable1.xml');
  });
});
