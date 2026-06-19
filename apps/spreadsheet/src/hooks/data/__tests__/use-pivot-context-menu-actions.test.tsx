import { jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';

import type {
  PlacementId,
  PivotFieldPlacementFlat,
  PivotTableConfig,
} from '@mog-sdk/contracts/pivot';

const mockUsePivotTables = jest.fn();
const mockUiStore = {
  closeContextMenu: jest.fn(),
  startEditingPivot: jest.fn(),
};

jest.unstable_mockModule('../../../infra/context', () => ({
  useActiveSheetId: () => 'sheet-1',
  useUIStore: (selector: (state: typeof mockUiStore) => unknown) => selector(mockUiStore),
}));

jest.unstable_mockModule('../use-pivot-tables', () => ({
  usePivotTables: mockUsePivotTables,
}));

const { usePivotContextMenuActions } = await import('../use-pivot-context-menu-actions');

function pid(id: string): PlacementId {
  return id as PlacementId;
}

function placement(
  partial: Omit<PivotFieldPlacementFlat, 'placementId'> & { placementId: string },
): PivotFieldPlacementFlat {
  return { ...partial, placementId: pid(partial.placementId) };
}

const nativeCapabilities = {
  canEditFields: true,
  canMove: true,
  canReorderFields: true,
  canRemove: true,
  canRemoveFields: true,
  canChangeAggregate: true,
  canSortLabels: true,
  canSortByValue: true,
  canRename: true,
  canShowValuesAs: true,
  canRefresh: true,
  canDelete: true,
  canExport: true,
};

function config(placements: PivotFieldPlacementFlat[]): PivotTableConfig {
  return {
    schemaVersion: 2,
    id: 'pivot-1',
    name: 'PivotTable1',
    sourceSheetName: 'Data',
    sourceRange: { startRow: 0, startCol: 0, endRow: 5, endCol: 2 },
    outputSheetName: 'Sheet1',
    outputLocation: { row: 0, col: 5 },
    fields: [
      { id: 'Month', name: 'Month', sourceColumn: 0, dataType: 'string' },
      { id: 'Vendor', name: 'Vendor', sourceColumn: 1, dataType: 'string' },
      { id: 'Amount', name: 'Amount', sourceColumn: 2, dataType: 'number' },
    ],
    placements,
    filters: [],
  };
}

function setup() {
  const fns = {
    deletePivotTable: jest.fn(),
    refreshPivotTable: jest.fn(),
    toggleRowExpanded: jest.fn(),
    setAllExpanded: jest.fn(),
    setSortOrder: jest.fn(),
    setPlacementSortOrder: jest.fn(),
    setAggregateFunction: jest.fn(),
    setShowValuesAs: jest.fn(),
    setLayout: jest.fn(),
    setFilter: jest.fn(),
    removeFieldFromArea: jest.fn(),
    removePlacement: jest.fn(),
  };
  const pivotConfig = config([
    placement({ placementId: 'row:Month:0', fieldId: 'Month', area: 'row', position: 0 }),
    placement({ placementId: 'row:Vendor:1', fieldId: 'Vendor', area: 'row', position: 1 }),
    placement({
      placementId: 'value:Amount:0',
      fieldId: 'Amount',
      area: 'value',
      position: 0,
      aggregateFunction: 'sum',
    }),
  ]);

  mockUsePivotTables.mockReturnValue({
    pivotTables: [
      {
        config: pivotConfig,
        result: null,
        sourceKind: 'native',
        capabilities: nativeCapabilities,
      },
    ],
    ...fns,
  });

  return fns;
}

describe('usePivotContextMenuActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('routes row/column label sort through the placement-aware sort API', () => {
    const fns = setup();
    const { result } = renderHook(() =>
      usePivotContextMenuActions({
        pivotId: 'pivot-1',
        fieldId: 'Vendor',
        placementId: pid('row:Vendor:1'),
      }),
    );

    expect(result.current.hasSortContext).toBe(true);

    act(() => {
      result.current.sortAscending();
    });

    expect(fns.setPlacementSortOrder).toHaveBeenCalledWith('pivot-1', 'row:Vendor:1', 'asc');
    expect(fns.setSortOrder).not.toHaveBeenCalled();
    expect(mockUiStore.closeContextMenu).toHaveBeenCalled();
  });

  it('does not expose label sort for value placement context', () => {
    const fns = setup();
    const { result } = renderHook(() =>
      usePivotContextMenuActions({
        pivotId: 'pivot-1',
        fieldId: 'Amount',
        placementId: pid('value:Amount:0'),
      }),
    );

    expect(result.current.hasSortContext).toBe(false);

    act(() => {
      result.current.sortAscending();
    });

    expect(fns.setPlacementSortOrder).not.toHaveBeenCalled();
    expect(fns.setSortOrder).not.toHaveBeenCalled();
  });
});
