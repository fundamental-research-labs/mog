import { jest } from '@jest/globals';

import type { SheetId } from '@mog-sdk/contracts/core';
import type { PivotTableConfig } from '@mog-sdk/contracts/pivot';

import { loadPivotConfigEntries } from './pivot-view-records';

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
