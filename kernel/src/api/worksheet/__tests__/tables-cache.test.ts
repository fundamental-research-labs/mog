import { jest } from '@jest/globals';

import { sheetId, type SheetId } from '@mog-sdk/contracts/core';

import { WorksheetTablesImpl } from '../tables';

const SHEET_ID = sheetId('sheet-1');

function createRawTable(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'tbl_stable_1',
    name: 'Sales',
    displayName: 'Sales',
    sheetId: SHEET_ID,
    range: { startRow: 0, startCol: 0, endRow: 2, endCol: 1 },
    columns: [
      { id: 'col_1', name: 'Region', index: 0 },
      { id: 'col_2', name: 'Amount', index: 1 },
    ],
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
    ...overrides,
  };
}

function createEventBus() {
  const handlers = new Map<string, Set<(event: any) => void>>();

  return {
    on: jest.fn((type: string, handler: (event: any) => void) => {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(handler);
      return () => handlers.get(type)?.delete(handler);
    }),
    emit: jest.fn((event: any) => {
      for (const handler of handlers.get(event.type) ?? []) {
        void handler(event);
      }
    }),
  };
}

function createContext() {
  return {
    eventBus: createEventBus(),
    computeBridge: {
      getAllTablesInSheet: jest.fn(),
      getTableAtCell: jest.fn(),
    },
  } as any;
}

describe('WorksheetTablesImpl table list cache', () => {
  it('uses a cached empty sheet table list for getAtCell', async () => {
    const ctx = createContext();
    const tables = new WorksheetTablesImpl(ctx, SHEET_ID as SheetId);
    ctx.computeBridge.getAllTablesInSheet.mockResolvedValueOnce([]);

    await expect(tables.list()).resolves.toEqual([]);

    ctx.computeBridge.getTableAtCell.mockClear();
    await expect(tables.getAtCell(1, 1)).resolves.toBeNull();
    expect(ctx.computeBridge.getTableAtCell).not.toHaveBeenCalled();

    tables.dispose();
  });

  it('invalidates the cached list on same-sheet table changes', async () => {
    const ctx = createContext();
    const tables = new WorksheetTablesImpl(ctx, SHEET_ID as SheetId);
    ctx.computeBridge.getAllTablesInSheet.mockResolvedValueOnce([]);

    await tables.list();
    ctx.eventBus.emit({
      type: 'table:created',
      timestamp: Date.now(),
      sheetId: SHEET_ID,
      tableId: 'tbl_stable_1',
      config: {},
      source: 'api',
    });

    ctx.computeBridge.getTableAtCell.mockResolvedValueOnce(createRawTable());
    const result = await tables.getAtCell(0, 0);

    expect(ctx.computeBridge.getTableAtCell).toHaveBeenCalledWith(SHEET_ID, 0, 0);
    expect(result?.name).toBe('Sales');

    tables.dispose();
  });

  it('resolves getAtCell from a cached table list when possible', async () => {
    const ctx = createContext();
    const tables = new WorksheetTablesImpl(ctx, SHEET_ID as SheetId);
    ctx.computeBridge.getAllTablesInSheet.mockResolvedValueOnce([createRawTable()]);

    await tables.list();

    ctx.computeBridge.getTableAtCell.mockClear();
    const result = await tables.getAtCell(2, 1);

    expect(result?.name).toBe('Sales');
    expect(ctx.computeBridge.getTableAtCell).not.toHaveBeenCalled();

    tables.dispose();
  });
});
