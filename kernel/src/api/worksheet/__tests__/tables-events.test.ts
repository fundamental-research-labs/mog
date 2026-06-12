import { jest } from '@jest/globals';

import type { SheetId } from '@mog-sdk/contracts/core';
import { sheetId } from '@mog-sdk/contracts/core';
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
  const emittedEvents: any[] = [];

  return {
    on: jest.fn((type: string, handler: (event: any) => void) => {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(handler);
      return () => handlers.get(type)?.delete(handler);
    }),
    emit: jest.fn((event: any) => {
      emittedEvents.push(event);
      for (const handler of handlers.get(event.type) ?? []) {
        void handler(event);
      }
    }),
    getEmittedEvents: () => emittedEvents,
  };
}

function createContext() {
  const eventBus = createEventBus();
  const table = createRawTable();

  return {
    eventBus,
    writeGate: {
      assertWritable: jest.fn(),
    },
    computeBridge: {
      getSheetProtectionOptions: jest.fn().mockResolvedValue(null),
      createTableLifecycle: jest.fn().mockResolvedValue(undefined),
      getTableAtCell: jest.fn().mockResolvedValue(table),
      getTableByName: jest.fn(async (name: string) => (name === 'Sales' ? table : null)),
      getAllTablesInSheet: jest.fn().mockResolvedValue([table]),
      tableValidateTableName: jest.fn().mockResolvedValue({ valid: true }),
      renameTable: jest.fn().mockResolvedValue(undefined),
      deleteTable: jest.fn().mockResolvedValue(undefined),
      convertTableToRange: jest.fn().mockResolvedValue({ data: 3 }),
      setTableStyle: jest.fn().mockResolvedValue(undefined),
    },
  } as any;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function getOnlyEvent(ctx: any, type: string): any {
  const events = ctx.eventBus.getEmittedEvents().filter((event: any) => event.type === type);
  expect(events).toHaveLength(1);
  return events[0];
}

describe('WorksheetTablesImpl table event identity', () => {
  let ctx: ReturnType<typeof createContext>;
  let tables: WorksheetTablesImpl;

  beforeEach(() => {
    ctx = createContext();
    tables = new WorksheetTablesImpl(ctx, SHEET_ID as SheetId);
  });

  it('emits table:created with the stable table id', async () => {
    await tables.add('A1:B3', { name: 'Sales' });

    const event = getOnlyEvent(ctx, 'table:created');
    expect(event.tableId).toBe('tbl_stable_1');
    expect(event.config).toEqual(
      expect.objectContaining({
        id: 'tbl_stable_1',
        name: 'Sales',
      }),
    );
    expect(ctx.computeBridge.createTableLifecycle).toHaveBeenCalledWith(
      SHEET_ID,
      'Sales',
      0,
      0,
      2,
      1,
      [],
      true,
      null,
    );
  });

  it('emits table:updated with the stable table id while preserving name-based update input', async () => {
    await tables.update('Sales', { style: 'TableStyleMedium4' });

    const event = getOnlyEvent(ctx, 'table:updated');
    expect(event.tableId).toBe('tbl_stable_1');
    expect(event.changes).toEqual({
      style: expect.objectContaining({ preset: 'medium4' }),
    });
    expect(ctx.computeBridge.setTableStyle).toHaveBeenCalledWith('Sales', 'TableStyleMedium4');
  });

  it('emits rename updates with the pre-rename stable table id', async () => {
    await tables.rename('Sales', 'Revenue');

    const event = getOnlyEvent(ctx, 'table:updated');
    expect(event.tableId).toBe('tbl_stable_1');
    expect(event.changes).toEqual({ name: 'Revenue' });
    expect(ctx.computeBridge.renameTable).toHaveBeenCalledWith('Sales', 'Revenue');
    expect(ctx.computeBridge.tableValidateTableName).toHaveBeenCalledWith('Revenue', []);
  });

  it('emits removal with the stable table id while deleting by public table name', async () => {
    await tables.remove('Sales');

    const event = getOnlyEvent(ctx, 'table:deleted');
    expect(event.tableId).toBe('tbl_stable_1');
    expect(ctx.computeBridge.deleteTable).toHaveBeenCalledWith('Sales');
  });

  it('emits convert-to-range and follow-up deletion with stable table ids', async () => {
    const affectedFormulaCount = await tables.convertToRange('Sales');

    expect(affectedFormulaCount).toBe(3);
    expect(ctx.computeBridge.convertTableToRange).toHaveBeenCalledWith('Sales');

    const converted = getOnlyEvent(ctx, 'table:converted-to-range');
    expect(converted).toEqual(
      expect.objectContaining({
        tableId: 'tbl_stable_1',
        tableName: 'Sales',
        affectedFormulaCount: 3,
      }),
    );

    const deleted = getOnlyEvent(ctx, 'table:deleted');
    expect(deleted.tableId).toBe('tbl_stable_1');
  });

  it('filters onTableChanged subscriptions by stable table id', async () => {
    const callback = jest.fn();
    tables.events.onTableChanged('Sales', callback);
    await flushPromises();

    ctx.eventBus.emit({
      type: 'table:updated',
      timestamp: Date.now(),
      sheetId: SHEET_ID,
      tableId: 'Sales',
      changes: {},
      source: 'api',
    });
    ctx.eventBus.emit({
      type: 'table:updated',
      timestamp: Date.now(),
      sheetId: SHEET_ID,
      tableId: 'tbl_stable_1',
      changes: {},
      source: 'api',
    });
    await flushPromises();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        tableId: 'tbl_stable_1',
      }),
    );
  });
});
