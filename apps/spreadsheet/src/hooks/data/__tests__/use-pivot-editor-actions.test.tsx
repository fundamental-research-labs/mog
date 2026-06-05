import { jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';

import type { PivotFieldPlacementFlat, PivotTableConfig } from '@mog-sdk/contracts/pivot';

const mockUsePivotTables = jest.fn();

jest.unstable_mockModule('../../../infra/context', () => ({
  useActiveSheetId: () => 'sheet-1',
}));

jest.unstable_mockModule('../use-pivot-tables', () => ({
  usePivotTables: mockUsePivotTables,
}));

const { usePivotEditorActions } = await import('../use-pivot-editor-actions');

function pid(id: string): PivotFieldPlacementFlat['placementId'] {
  return id as PivotFieldPlacementFlat['placementId'];
}

function placement(
  partial: Omit<PivotFieldPlacementFlat, 'placementId'> & { placementId: string },
): PivotFieldPlacementFlat {
  return {
    ...partial,
    placementId: pid(partial.placementId),
  };
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
    outputSheetName: 'Data',
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

function setup(options: {
  placements?: PivotFieldPlacementFlat[];
  capabilities?: typeof nativeCapabilities;
  editingPivotId?: string;
  alternateIds?: string[];
} = {}) {
  const fns = {
    createPivotTable: jest.fn(),
    detectFields: jest.fn(),
    deletePivotTable: jest.fn(),
    addFieldToArea: jest.fn(),
    addPlacement: jest.fn(),
    removeFieldFromArea: jest.fn(),
    removePlacement: jest.fn(),
    moveField: jest.fn(),
    movePlacement: jest.fn(),
    setAggregateFunction: jest.fn(),
    setPlacementAggregateFunction: jest.fn(),
    setPlacementSortOrder: jest.fn(),
    setSortByValue: jest.fn(),
    refreshPivotTable: jest.fn(),
    startEditingPivot: jest.fn(),
    stopEditingPivot: jest.fn(),
  };
  const pivotConfig = config(
    options.placements ?? [
      placement({ placementId: 'row:Month:0', fieldId: 'Month', area: 'row', position: 0 }),
      placement({ placementId: 'row:Vendor:1', fieldId: 'Vendor', area: 'row', position: 1 }),
      placement({
        placementId: 'value:Amount:0',
        fieldId: 'Amount',
        area: 'value',
        position: 0,
        aggregateFunction: 'sum',
      }),
    ],
  );

  mockUsePivotTables.mockReturnValue({
    pivotTables: [
      {
        config: pivotConfig,
        result: null,
        sourceKind: 'native',
        alternateIds: options.alternateIds,
        capabilities: options.capabilities ?? nativeCapabilities,
      },
    ],
    editingPivotId: options.editingPivotId ?? 'pivot-1',
    selectedPivotId: options.editingPivotId ?? 'pivot-1',
    updatePivotTable: jest.fn(),
    setShowValuesAs: jest.fn(),
    setSortOrder: jest.fn(),
    setFilter: jest.fn(),
    removeFilter: jest.fn(),
    setLayout: jest.fn(),
    setStyle: jest.fn(),
    toggleRowExpanded: jest.fn(),
    toggleColumnExpanded: jest.fn(),
    setAllExpanded: jest.fn(),
    getDrillDownData: jest.fn(),
    selectPivot: jest.fn(),
    ...fns,
  });

  return fns;
}

describe('usePivotEditorActions placement mapping', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('adds source fields as positioned placements', () => {
    const fns = setup();
    const { result } = renderHook(() => usePivotEditorActions());

    act(() => {
      result.current.handlePivotAddPlacement('Vendor', 'row', 1);
    });

    expect(fns.addPlacement).toHaveBeenCalledWith('pivot-1', {
      fieldId: 'Vendor',
      area: 'row',
      position: 1,
    });
  });

  it('resolves the editing pivot by imported sidecar alias', () => {
    setup({
      editingPivotId: 'imported:Pivot:xl/pivotTables/pivotTable1.xml',
      alternateIds: ['imported:Pivot:xl/pivotTables/pivotTable1.xml'],
    });
    const { result } = renderHook(() => usePivotEditorActions());

    expect(result.current.editingPivot?.config.id).toBe('pivot-1');
  });

  it('maps row and column sort changes to placement-level sort mutations', () => {
    const fns = setup();
    const { result } = renderHook(() => usePivotEditorActions());

    act(() => {
      result.current.handlePivotPlacementSortOrderChange('row:Month:0', 'desc');
    });

    expect(fns.setPlacementSortOrder).toHaveBeenCalledWith('pivot-1', 'row:Month:0', 'desc');
  });

  it('maps value sort to the first row axis placement deterministically', () => {
    const fns = setup({
      placements: [
        placement({ placementId: 'column:Vendor:0', fieldId: 'Vendor', area: 'column', position: 0 }),
        placement({ placementId: 'row:Month:0', fieldId: 'Month', area: 'row', position: 0 }),
        placement({
          placementId: 'value:Amount:0',
          fieldId: 'Amount',
          area: 'value',
          position: 0,
          aggregateFunction: 'sum',
        }),
      ],
    });
    const { result } = renderHook(() => usePivotEditorActions());

    act(() => {
      result.current.handlePivotValueSortChange('value:Amount:0', 'desc');
    });

    expect(fns.setSortByValue).toHaveBeenCalledWith('pivot-1', 'row:Month:0', 'value:Amount:0', {
      order: 'desc',
    });
  });

  it('uses the first column placement for value sort when no row axis exists', () => {
    const fns = setup({
      placements: [
        placement({ placementId: 'column:Vendor:0', fieldId: 'Vendor', area: 'column', position: 0 }),
        placement({
          placementId: 'value:Amount:0',
          fieldId: 'Amount',
          area: 'value',
          position: 0,
          aggregateFunction: 'sum',
        }),
      ],
    });
    const { result } = renderHook(() => usePivotEditorActions());

    act(() => {
      result.current.handlePivotValueSortChange('value:Amount:0', 'asc');
    });

    expect(fns.setSortByValue).toHaveBeenCalledWith('pivot-1', 'column:Vendor:0', 'value:Amount:0', {
      order: 'asc',
    });
  });

  it('clears value sort only when the default axis targets that value placement', () => {
    const fns = setup({
      placements: [
        placement({
          placementId: 'row:Month:0',
          fieldId: 'Month',
          area: 'row',
          position: 0,
          sortByValue: {
            valueFieldId: 'Amount',
            valuePlacementId: pid('value:Amount:0'),
            order: 'desc',
          },
        }),
        placement({
          placementId: 'value:Amount:0',
          fieldId: 'Amount',
          area: 'value',
          position: 0,
          aggregateFunction: 'sum',
        }),
      ],
    });
    const { result } = renderHook(() => usePivotEditorActions());

    act(() => {
      result.current.handlePivotValueSortChange('value:Amount:0', 'none');
    });

    expect(fns.setSortByValue).toHaveBeenCalledWith(
      'pivot-1',
      'row:Month:0',
      'value:Amount:0',
      null,
    );
  });

  it('does not clear value sort when the default axis targets another value placement', () => {
    const fns = setup({
      placements: [
        placement({
          placementId: 'row:Month:0',
          fieldId: 'Month',
          area: 'row',
          position: 0,
          sortByValue: {
            valueFieldId: 'Amount',
            valuePlacementId: pid('value:Amount:1'),
            order: 'desc',
          },
        }),
        placement({
          placementId: 'value:Amount:0',
          fieldId: 'Amount',
          area: 'value',
          position: 0,
          aggregateFunction: 'sum',
        }),
      ],
    });
    const { result } = renderHook(() => usePivotEditorActions());

    act(() => {
      result.current.handlePivotValueSortChange('value:Amount:0', 'none');
    });

    expect(fns.setSortByValue).not.toHaveBeenCalled();
  });

  it('respects read-only capabilities for placement mutations', () => {
    const fns = setup({
      capabilities: {
        ...nativeCapabilities,
        canEditFields: false,
        canMove: false,
        canReorderFields: false,
        canRemove: false,
        canRemoveFields: false,
        canChangeAggregate: false,
        canSortLabels: false,
        canSortByValue: false,
      },
    });
    const { result } = renderHook(() => usePivotEditorActions());

    act(() => {
      result.current.handlePivotAddPlacement('Vendor', 'row', 1);
      result.current.handlePivotMovePlacement('row:Vendor:1', 'column', 0);
      result.current.handlePivotRemovePlacement('row:Vendor:1');
      result.current.handlePivotPlacementAggregateChange('value:Amount:0', 'max');
      result.current.handlePivotPlacementSortOrderChange('row:Month:0', 'asc');
      result.current.handlePivotValueSortChange('value:Amount:0', 'desc');
    });

    expect(fns.addPlacement).not.toHaveBeenCalled();
    expect(fns.movePlacement).not.toHaveBeenCalled();
    expect(fns.removePlacement).not.toHaveBeenCalled();
    expect(fns.setPlacementAggregateFunction).not.toHaveBeenCalled();
    expect(fns.setPlacementSortOrder).not.toHaveBeenCalled();
    expect(fns.setSortByValue).not.toHaveBeenCalled();
  });
});
