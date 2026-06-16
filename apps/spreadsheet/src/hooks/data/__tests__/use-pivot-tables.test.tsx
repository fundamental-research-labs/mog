import { jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react';

import type { SheetId } from '@mog-sdk/contracts/core';
import type {
  PivotFieldPlacementFlat,
  PivotKernelMutationReceipt,
  PivotTableConfig,
  PivotTableResult,
} from '@mog-sdk/contracts/pivot';
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

function pivotResult(): PivotTableResult {
  return {
    columnHeaders: [],
    rows: [],
    grandTotals: {},
    sourceRowCount: 0,
    renderedBounds: {
      totalRows: 1,
      totalCols: 1,
      firstDataRow: 0,
      firstDataCol: 0,
      numDataCols: 1,
    },
  };
}

function nativeEntry(id: string, handle: Record<string, unknown>): PivotConfigEntry {
  return {
    config: pivotConfig(id),
    sourceKind: 'native',
    capabilities: readOnlyCapabilities,
    handle: {
      subscribeResult: jest.fn(() => jest.fn()),
      compute: jest.fn(async () => null),
      ...handle,
    } as NonNullable<PivotConfigEntry['handle']>,
  };
}

function failedKernelReceipt(message: string): PivotKernelMutationReceipt {
  return {
    kernelReceiptId: 'receipt-1',
    pivotId: 'pivot-1',
    effects: [],
    mutationResult: null,
    updateReason: 'fieldPlacementChanged',
    refreshPolicy: 'refreshAndMaterialize',
    materialized: false,
    configRevision: 1,
    status: 'failed',
    error: { code: 'MATERIALIZATION_FAILED', stage: 'materialize', message },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadPivotConfigEntries.mockReset();
  mockWorksheet.pivots.add.mockReset();
  mockWorksheet.pivots.addWithSheet.mockReset();
  mockWorksheet.pivots.detectFields.mockReset();
  mockWorksheet.pivots.get.mockReset();
  mockLoadPivotConfigEntries.mockResolvedValue([]);
  mockAwaitMaterialized.mockResolvedValue(undefined);
  mockWorksheet.getName.mockResolvedValue('Pivot');
  mockWorksheet.getSheetId.mockReturnValue('sheet-1');
  mockWorksheet.pivots.detectFields.mockResolvedValue(pivotConfig('fields').fields);
  mockWorkbook.getSheetById.mockReturnValue(mockWorksheet);
  mockWorkbook.getSheets.mockResolvedValue([mockWorksheet]);
  mockWorkbook.sheetNames = ['Pivot'];
  mockEditingPivotId = null;
  mockSelectedPivotId = null;
});

describe('usePivotTables pivot receipts', () => {
  it('requests materialization and rejects creation receipts with diagnostics', async () => {
    const receiptConfig = pivotConfig('pivot-created');
    mockWorksheet.pivots.addWithSheet.mockResolvedValue({
      kind: 'pivot.addWithSheet',
      status: 'partial',
      effects: [],
      diagnostics: [
        {
          severity: 'error',
          code: 'PIVOT_MATERIALIZATION_FAILED',
          message: 'Rendered cells were not materialized.',
        },
      ],
      sheetId: 'sheet-created',
      pivotId: receiptConfig.id,
      config: receiptConfig,
      lifecycle: 'materialize',
      materialized: false,
      renderedRange: null,
      result: null,
    });

    const { result } = renderHook(() => usePivotTables({ sheetId: 'sheet-1' as SheetId }));

    await expect(
      result.current.createPivotTable(
        'Sales Pivot',
        { startRow: 0, startCol: 0, endRow: 3, endCol: 2 },
        'sheet-1' as SheetId,
        { mode: 'newWorksheet' },
      ),
    ).rejects.toThrow('Rendered cells were not materialized.');

    expect(mockWorksheet.pivots.addWithSheet).toHaveBeenCalledWith(
      'Sales Pivot',
      expect.any(Object),
      { lifecycle: 'materialize' },
    );
  });

  it('refreshes local result state from the refresh receipt payload', async () => {
    const refreshedResult = pivotResult();
    const compute = jest.fn(async () => null);
    const refresh = jest.fn(async () => ({
      kind: 'pivot.refresh',
      status: 'applied',
      effects: [],
      diagnostics: [],
      pivotId: 'pivot-1',
      config: null,
      materialized: true,
      renderedRange: null,
      result: refreshedResult,
    }));
    mockLoadPivotConfigEntries.mockResolvedValue([nativeEntry('pivot-1', { compute, refresh })]);

    const { result } = renderHook(() => usePivotTables({ sheetId: 'sheet-1' as SheetId }));

    await waitFor(() => expect(result.current.pivotTables).toHaveLength(1));
    await waitFor(() => expect(compute).toHaveBeenCalled());
    act(() => result.current.refreshPivotTable('pivot-1'));

    await waitFor(() => {
      expect(result.current.pivotTables[0]?.result).toBe(refreshedResult);
    });
  });

  it('warns when a placement mutation receipt does not apply', async () => {
    const failedReceipt = failedKernelReceipt('Placement materialization failed.');
    const addPlacement = jest.fn(async () => failedReceipt);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockLoadPivotConfigEntries.mockResolvedValue([nativeEntry('pivot-1', { addPlacement })]);

    const { result } = renderHook(() => usePivotTables({ sheetId: 'sheet-1' as SheetId }));

    await waitFor(() => expect(result.current.pivotTables).toHaveLength(1));
    act(() => {
      result.current.addPlacement('pivot-1', { fieldId: 'Amount', area: 'value' });
    });

    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith('Placement materialization failed.', failedReceipt),
    );
    warn.mockRestore();
  });
});

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
