import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import { getSlicerSelectedValues, setSlicerSelection } from '../selection';

const SHEET_ID = sheetId('sheet-1');

function createHarness(source: 'table' | 'pivot' = 'table') {
  const order: string[] = [];
  const stored = {
    id: 'slicer-1',
    sheetId: String(SHEET_ID),
    source:
      source === 'table'
        ? { type: 'table', tableId: 'table-1', columnCellId: 'col-region' }
        : { type: 'pivot', pivotId: 'pivot-1', fieldName: 'Region', fieldArea: 'row' },
    style: { showItemsWithNoData: true, sortOrder: 'ascending' },
    multiSelect: true,
    selectedValues: ['stale-native-value'],
  };
  const filter = {
    id: 'filter-1',
    tableId: 'table-1',
    type: 'tableFilter',
    columnFilters: {} as Record<string, { values?: unknown[] }>,
  };
  const table = {
    id: 'table-1',
    name: 'Sales',
    displayName: 'Sales',
    sheetId: String(SHEET_ID),
    range: { startRow: 0, startCol: 0, endRow: 5, endCol: 0 },
    columns: [{ id: 'col-region', name: 'Region', index: 0 }],
    hasHeaderRow: true,
    hasTotalsRow: false,
    style: 'TableStyleMedium2',
    bandedRows: true,
    bandedColumns: false,
    emphasizeFirstColumn: false,
    emphasizeLastColumn: false,
    showFilterButtons: true,
    autoExpand: true,
    autoCalculatedColumns: true,
  };
  const computeBridge = {
    getSlicerState: jest.fn().mockResolvedValue(stored),
    getAllSheetIds: jest.fn().mockResolvedValue([String(SHEET_ID)]),
    getAllTablesInSheet: jest.fn().mockResolvedValue([table]),
    getFiltersInSheet: jest.fn().mockImplementation(async () => [filter]),
    getCellPosition: jest.fn().mockResolvedValue({ row: 0, col: 0 }),
    setColumnFilter: jest
      .fn()
      .mockImplementation(async (_sheetId, _filterId, _col, criterion: { values?: unknown[] }) => {
        order.push('filter');
        filter.columnFilters['col-region'] = criterion;
      }),
    clearColumnFilter: jest.fn().mockImplementation(async () => {
      order.push('filter');
      delete filter.columnFilters['col-region'];
    }),
    createFilter: jest.fn(),
    setSlicerSelection: jest.fn().mockResolvedValue({}),
  };
  const eventBus = {
    emit: jest.fn().mockImplementation(() => order.push('event')),
  };
  return {
    ctx: { computeBridge, eventBus } as any,
    computeBridge,
    eventBus,
    filter,
    order,
    stored,
  };
}

describe('table slicer selection authority', () => {
  it('does not persist or emit a table selection when the filter write fails', async () => {
    const { ctx, computeBridge, eventBus } = createHarness();
    computeBridge.setColumnFilter.mockRejectedValue(new Error('filter failed'));

    await expect(setSlicerSelection(ctx, SHEET_ID, 'slicer-1', ['West'])).rejects.toThrow(
      'filter failed',
    );

    expect(computeBridge.setSlicerSelection).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('publishes the committed filter selection only after the filter write succeeds', async () => {
    const { ctx, computeBridge, eventBus, order } = createHarness();

    await setSlicerSelection(ctx, SHEET_ID, 'slicer-1', ['West']);

    expect(order).toEqual(['filter', 'event']);
    expect(computeBridge.setSlicerSelection).not.toHaveBeenCalled();
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ selectedValues: ['West'], changeType: 'select' }),
    );
  });

  it('reads subsequent external filter changes instead of stored selectedValues', async () => {
    const { ctx, filter, stored } = createHarness();
    const slicer = {
      id: stored.id,
      sourceType: 'table' as const,
      sourceId: 'table-1',
      sourceColumnId: 'col-region',
    } as any;
    filter.columnFilters['col-region'] = { values: ['East'] };

    await expect(getSlicerSelectedValues(ctx, slicer)).resolves.toEqual(['East']);
    filter.columnFilters['col-region'] = { values: ['West'] };
    await expect(getSlicerSelectedValues(ctx, slicer)).resolves.toEqual(['West']);
  });

  it('continues to persist pivot selections natively', async () => {
    const { ctx, computeBridge, eventBus } = createHarness('pivot');

    await setSlicerSelection(ctx, SHEET_ID, 'slicer-1', ['West']);

    expect(computeBridge.setSlicerSelection).toHaveBeenCalledWith(SHEET_ID, 'slicer-1', ['West']);
    expect(eventBus.emit).not.toHaveBeenCalled();
  });
});
