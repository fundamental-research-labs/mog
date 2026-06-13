import { jest } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react';

import type { SheetId } from '@mog-sdk/contracts/core';
import type { PivotFieldPlacementFlat, PivotTableConfig } from '@mog-sdk/contracts/pivot';
import type { PivotConfigEntry } from '../../../pivot/pivot-view-records';

const mockLoadPivotConfigEntries = jest.fn();
const mockEventBus = {
  on: jest.fn(() => jest.fn()),
};
const mockAwaitMaterialized = jest.fn(async () => {});
const mockWorksheet = {
  getName: jest.fn(async () => 'Pivot'),
  getSheetId: jest.fn(() => 'sheet-1'),
  pivots: {
    add: jest.fn(),
    addWithSheet: jest.fn(),
    detectFields: jest.fn(),
    get: jest.fn(),
  },
};
const mockWorkbook = {
  ctx: {
    awaitMaterialized: mockAwaitMaterialized,
  },
  getSheetById: jest.fn(() => mockWorksheet),
  getSheets: jest.fn(async () => [mockWorksheet]),
  sheetNames: ['Pivot'],
};
const mockUiStore = {
  selectPivot: jest.fn(),
  startEditingPivot: jest.fn(),
  stopEditingPivot: jest.fn(),
};

let mockEditingPivotId: string | null = null;
let mockSelectedPivotId: string | null = null;

jest.unstable_mockModule('../../../infra/context', () => ({
  useEditingPivotId: () => mockEditingPivotId,
  useEventBus: () => mockEventBus,
  useSelectedPivotId: () => mockSelectedPivotId,
  useUIStore: (selector: (state: typeof mockUiStore) => unknown) => selector(mockUiStore),
  useWorkbook: () => mockWorkbook,
}));

jest.unstable_mockModule('../../../pivot/pivot-view-records', () => ({
  loadPivotConfigEntries: mockLoadPivotConfigEntries,
}));

const { usePivotTables } = await import('../use-pivot-tables');

const readOnlyCapabilities = {
  canChangeAggregate: false,
  canDelete: false,
  canEditFields: false,
  canExport: true,
  canMove: false,
  canRefresh: false,
  canRemove: false,
  canRemoveFields: false,
  canRename: false,
  canReorderFields: false,
  canShowValuesAs: false,
  canSortByValue: false,
  canSortLabels: false,
};

function placementId(id: string): PivotFieldPlacementFlat['placementId'] {
  return id as PivotFieldPlacementFlat['placementId'];
}

function pivotConfig(id: string): PivotTableConfig {
  return {
    schemaVersion: 2,
    id,
    name: 'PivotTable1',
    sourceSheetName: 'Data',
    sourceRange: { startRow: 0, startCol: 0, endRow: 3, endCol: 2 },
    outputSheetName: 'Pivot',
    outputLocation: { row: 0, col: 0 },
    fields: [
      { id: 'Category', name: 'Category', sourceColumn: 0, dataType: 'string' },
      { id: 'Amount', name: 'Amount', sourceColumn: 1, dataType: 'number' },
    ],
    placements: [
      {
        placementId: placementId('row:Category:0'),
        fieldId: 'Category',
        area: 'row',
        position: 0,
      },
      {
        placementId: placementId('value:Amount:0'),
        fieldId: 'Amount',
        area: 'value',
        position: 0,
        aggregateFunction: 'sum',
      },
    ],
    filters: [],
  };
}

function unsupportedEntry(id: string): PivotConfigEntry {
  return {
    config: pivotConfig(id),
    sourceKind: 'unsupportedImport',
    capabilities: readOnlyCapabilities,
    result: null,
  };
}

describe('usePivotTables imported materialization refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEditingPivotId = 'pivot-imported-materialized';
    mockSelectedPivotId = 'pivot-imported-materialized';
  });

  it('refreshes entries when the active editing pivot is absent from local state', async () => {
    const entry = unsupportedEntry('pivot-imported-materialized');
    mockLoadPivotConfigEntries.mockResolvedValueOnce([]);
    mockLoadPivotConfigEntries.mockResolvedValueOnce([entry]);

    const { result } = renderHook(() => usePivotTables({ sheetId: 'sheet-1' as SheetId }));

    await waitFor(() => expect(result.current.pivotTables).toHaveLength(1));

    expect(result.current.pivotTables[0]?.config.id).toBe('pivot-imported-materialized');
    expect(mockAwaitMaterialized).not.toHaveBeenCalled();
    expect(mockLoadPivotConfigEntries).toHaveBeenCalledWith(mockWorkbook, 'sheet-1');
  });

  it('waits for materialization and retries when an active editing pivot is still absent', async () => {
    const entry = unsupportedEntry('pivot-imported-materialized');
    mockLoadPivotConfigEntries.mockResolvedValueOnce([]);
    mockLoadPivotConfigEntries.mockResolvedValueOnce([]);
    mockLoadPivotConfigEntries.mockResolvedValueOnce([entry]);

    const { result } = renderHook(() => usePivotTables({ sheetId: 'sheet-1' as SheetId }));

    await waitFor(() => expect(result.current.pivotTables).toHaveLength(1));

    expect(mockAwaitMaterialized).toHaveBeenCalledWith('allSheets');
    expect(result.current.pivotTables[0]?.config.id).toBe('pivot-imported-materialized');
  });
});
