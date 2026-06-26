import { jest } from '@jest/globals';

import type { SheetId } from '@mog-sdk/contracts/core';
import { sheetId } from '@mog-sdk/contracts/core';
import { WorksheetTablesImpl } from '../tables';

jest.mock('../../../domain/sheets/structures', () => ({
  insertRows: jest.fn().mockResolvedValue(undefined),
  deleteRows: jest.fn().mockResolvedValue(undefined),
  insertColumns: jest.fn().mockResolvedValue(undefined),
  deleteColumns: jest.fn().mockResolvedValue(undefined),
}));

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
      setTableBoolOption: jest.fn().mockResolvedValue(undefined),
      setTableAutoExpand: jest.fn().mockResolvedValue(undefined),
      setTableAutoCalculatedColumns: jest.fn().mockResolvedValue(undefined),
      resizeTable: jest.fn().mockResolvedValue(undefined),
      beginUndoGroup: jest.fn().mockResolvedValue(undefined),
      endUndoGroup: jest.fn().mockResolvedValue(undefined),
      addTableColumn: jest.fn().mockResolvedValue(undefined),
      removeTableColumn: jest.fn().mockResolvedValue(undefined),
      addTableDataRow: jest
        .fn()
        .mockResolvedValue({ data: { insertRow: 3, needsRangeExpand: true } }),
      removeTableDataRow: jest.fn().mockResolvedValue({ data: 1 }),
      setCellsByPosition: jest.fn().mockResolvedValue(undefined),
      structureChange: jest.fn().mockResolvedValue(undefined),
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

function expectTableMutationOptions(operationIdPrefix: string) {
  return expect.objectContaining({
    operationContext: expect.objectContaining({
      operationId: expect.stringMatching(
        new RegExp(`^${operationIdPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`),
      ),
      kind: 'mutation',
      sheetIds: [SHEET_ID],
      domainIds: ['tables'],
      capturePolicy: 'commitEligible',
      writeAdmissionMode: 'capture',
    }),
  });
}

describe('WorksheetTablesImpl table event identity', () => {
  let ctx: ReturnType<typeof createContext>;
  let tables: WorksheetTablesImpl;

  beforeEach(() => {
    ctx = createContext();
    tables = new WorksheetTablesImpl(ctx, SHEET_ID as SheetId);
  });

  it('emits table:created with the stable table id', async () => {
    const receipt = await tables.add('A1:B3', { name: 'Sales' });

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
      expectTableMutationOptions('tables.add'),
    );
    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'tableAdd',
        status: 'applied',
        tableId: 'tbl_stable_1',
        name: 'Sales',
        range: 'A1:B3',
        table: expect.objectContaining({ id: 'tbl_stable_1', name: 'Sales' }),
        diagnostics: [],
      }),
    );
    expect(receipt.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'createdObject', objectId: 'tbl_stable_1' }),
        expect.objectContaining({ type: 'storedMetadata', objectId: 'tbl_stable_1' }),
      ]),
    );
  });

  it('decorates listed tables with containsCell based on the current range', async () => {
    ctx.computeBridge.getAllTablesInSheet.mockResolvedValueOnce([
      createRawTable({ range: { startRow: 0, startCol: 0, endRow: 4, endCol: 1 } }),
    ]);

    const [table] = (await tables.list()) as Array<{
      range: string;
      containsCell?: (row: number, col: number) => boolean;
    }>;

    expect(table.range).toBe('A1:B5');
    expect(table.containsCell?.(4, 1)).toBe(true);
    expect(table.containsCell?.(4, 2)).toBe(false);
  });

  it('lists tables without waiting for app clipboard paste globals', async () => {
    const global = globalThis as typeof globalThis & {
      __MOG_ACTIVE_CLIPBOARD_PASTE__?: Promise<unknown>;
      __MOG_PENDING_CLIPBOARD_PASTE__?: Promise<unknown>;
    };
    const never = new Promise<never>(() => undefined);
    global.__MOG_PENDING_CLIPBOARD_PASTE__ = never;
    global.__MOG_ACTIVE_CLIPBOARD_PASTE__ = never;

    try {
      const listPromise = tables.list();
      await flushPromises();

      expect(ctx.computeBridge.getAllTablesInSheet).toHaveBeenCalledWith(SHEET_ID);
      await expect(listPromise).resolves.toHaveLength(1);
    } finally {
      delete global.__MOG_PENDING_CLIPBOARD_PASTE__;
      delete global.__MOG_ACTIVE_CLIPBOARD_PASTE__;
    }
  });

  it('emits table:updated with the stable table id while preserving name-based update input', async () => {
    const receipt = await tables.update('Sales', { style: 'TableStyleMedium4' });

    const event = getOnlyEvent(ctx, 'table:updated');
    expect(event.tableId).toBe('tbl_stable_1');
    expect(event.changes).toEqual({
      style: expect.objectContaining({ preset: 'medium4' }),
    });
    expect(ctx.computeBridge.setTableStyle).toHaveBeenCalledWith(
      'Sales',
      'TableStyleMedium4',
      expectTableMutationOptions('tables.update'),
    );
    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'tableUpdate',
        status: 'applied',
        tableId: 'tbl_stable_1',
        tableName: 'Sales',
        updates: { style: 'TableStyleMedium4' },
      }),
    );
    expect(receipt.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'updatedObject', objectId: 'tbl_stable_1' }),
        expect.objectContaining({ type: 'storedMetadata', objectId: 'tbl_stable_1' }),
      ]),
    );
  });

  it('emits rename updates with the pre-rename stable table id', async () => {
    const receipt = await tables.rename('Sales', 'Revenue');

    const event = getOnlyEvent(ctx, 'table:updated');
    expect(event.tableId).toBe('tbl_stable_1');
    expect(event.changes).toEqual({ name: 'Revenue' });
    expect(ctx.computeBridge.renameTable).toHaveBeenCalledWith(
      'Sales',
      'Revenue',
      expectTableMutationOptions('tables.rename'),
    );
    expect(ctx.computeBridge.tableValidateTableName).toHaveBeenCalledWith('Revenue', []);
    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'tableRename',
        status: 'applied',
        tableId: 'tbl_stable_1',
        oldName: 'Sales',
        newName: 'Revenue',
        name: 'Revenue',
      }),
    );
    expect(receipt.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'renamedObject', objectId: 'tbl_stable_1' }),
        expect.objectContaining({ type: 'storedMetadata', objectId: 'tbl_stable_1' }),
      ]),
    );
  });

  it('emits removal with the stable table id while deleting by public table name', async () => {
    const receipt = await tables.remove('Sales');

    const event = getOnlyEvent(ctx, 'table:deleted');
    expect(event.tableId).toBe('tbl_stable_1');
    expect(ctx.computeBridge.deleteTable).toHaveBeenCalledWith(
      'Sales',
      expectTableMutationOptions('tables.remove'),
    );
    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'tableRemove',
        status: 'applied',
        tableId: 'tbl_stable_1',
        tableName: 'Sales',
        range: 'A1:B3',
      }),
    );
    expect(receipt.effects).toEqual([
      expect.objectContaining({ type: 'removedObject', objectId: 'tbl_stable_1' }),
    ]);
  });

  it('emits convert-to-range and follow-up deletion with stable table ids', async () => {
    const receipt = await tables.convertToRange('Sales');

    expect(receipt.affectedFormulaCount).toBe(3);
    expect(ctx.computeBridge.convertTableToRange).toHaveBeenCalledWith(
      'Sales',
      expectTableMutationOptions('tables.convertToRange'),
    );

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
    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'tableConvertToRange',
        status: 'applied',
        tableId: 'tbl_stable_1',
        tableName: 'Sales',
        range: 'A1:B3',
      }),
    );
    expect(receipt.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'removedObject', objectId: 'tbl_stable_1' }),
        expect.objectContaining({ type: 'changedRange', count: 3 }),
      ]),
    );
  });

  it('passes commit-eligible table mutation contexts with one group for multi-step update', async () => {
    await tables.update('Sales', {
      style: 'TableStyleMedium4',
      bandedRows: false,
      autoExpand: false,
    });

    const styleOptions = ctx.computeBridge.setTableStyle.mock.calls[0][2];
    const boolOptions = ctx.computeBridge.setTableBoolOption.mock.calls[0][3];
    const autoExpandOptions = ctx.computeBridge.setTableAutoExpand.mock.calls[0][2];

    expect(styleOptions).toEqual(expectTableMutationOptions('tables.update'));
    expect(boolOptions).toEqual(expectTableMutationOptions('tables.update'));
    expect(autoExpandOptions).toEqual(expectTableMutationOptions('tables.update'));
    expect(styleOptions.operationContext.groupId).toBe(styleOptions.operationContext.operationId);
    expect(boolOptions.operationContext.groupId).toBe(styleOptions.operationContext.groupId);
    expect(autoExpandOptions.operationContext.groupId).toBe(styleOptions.operationContext.groupId);
    expect(boolOptions.operationContext.operationId).not.toBe(
      styleOptions.operationContext.operationId,
    );
    expect(autoExpandOptions.operationContext.operationId).not.toBe(
      styleOptions.operationContext.operationId,
    );
  });

  it('returns no-op receipts for valid table requests that change nothing', async () => {
    const renameReceipt = await tables.rename('Sales', 'Sales');
    const styleReceipt = await tables.setStylePreset('Sales', 'TableStyleMedium2');

    expect(renameReceipt).toEqual(
      expect.objectContaining({
        kind: 'tableRename',
        status: 'noOp',
        tableId: 'tbl_stable_1',
      }),
    );
    expect(styleReceipt).toEqual(
      expect.objectContaining({
        kind: 'tableUpdate',
        status: 'noOp',
        tableId: 'tbl_stable_1',
        updates: {},
      }),
    );
    expect(renameReceipt.effects).toEqual([
      { type: 'worksheetUnchanged', sheetId: SHEET_ID, range: 'A1:B3' },
    ]);
    expect(styleReceipt.effects).toEqual([
      { type: 'worksheetUnchanged', sheetId: SHEET_ID, range: 'A1:B3' },
    ]);
    expect(ctx.computeBridge.renameTable).not.toHaveBeenCalled();
    expect(ctx.computeBridge.setTableStyle).not.toHaveBeenCalled();
  });

  it('returns base receipt fields for table resize, column, and row mutations', async () => {
    const resizeReceipt = await tables.resize('Sales', 'A1:C3');
    const addColumnReceipt = await tables.addColumn('Sales', 'Margin');
    const removeColumnReceipt = await tables.removeColumn('Sales', 1);
    const addRowReceipt = await tables.addRow('Sales', undefined, ['West', 10]);
    const deleteRowReceipt = await tables.deleteRow('Sales', 0);

    expect(resizeReceipt).toEqual(
      expect.objectContaining({
        kind: 'tableResize',
        status: 'applied',
        tableId: 'tbl_stable_1',
        oldRange: 'A1:B3',
        newRange: 'A1:C3',
      }),
    );
    expect(addColumnReceipt).toEqual(
      expect.objectContaining({
        kind: 'tableAddColumn',
        status: 'applied',
        tableId: 'tbl_stable_1',
        columnName: 'Margin',
        position: 2,
        range: 'C1:C3',
      }),
    );
    expect(removeColumnReceipt).toEqual(
      expect.objectContaining({
        kind: 'tableRemoveColumn',
        status: 'applied',
        tableId: 'tbl_stable_1',
        columnIndex: 1,
        columnName: 'Amount',
        range: 'B1:B3',
      }),
    );
    expect(addRowReceipt).toEqual(
      expect.objectContaining({
        kind: 'tableAddRow',
        status: 'applied',
        tableId: 'tbl_stable_1',
        index: 2,
        range: 'A4:B4',
      }),
    );
    expect(deleteRowReceipt).toEqual(
      expect.objectContaining({
        kind: 'tableDeleteRow',
        status: 'applied',
        tableId: 'tbl_stable_1',
        index: 0,
        range: 'A2:B2',
      }),
    );
    for (const receipt of [
      resizeReceipt,
      addColumnReceipt,
      removeColumnReceipt,
      addRowReceipt,
      deleteRowReceipt,
    ]) {
      expect(receipt.diagnostics).toEqual([]);
      expect(receipt.effects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'changedRange' }),
          expect.objectContaining({ type: 'updatedObject', objectId: 'tbl_stable_1' }),
        ]),
      );
    }
  });

  it('returns no-op receipt when clearing a worksheet with no tables', async () => {
    ctx.computeBridge.getAllTablesInSheet.mockResolvedValueOnce([]);

    const receipt = await tables.clear();

    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'tableClear',
        status: 'noOp',
        sheetId: SHEET_ID,
        removedCount: 0,
        tableIds: [],
        tables: [],
        diagnostics: [],
        effects: [{ type: 'worksheetUnchanged', sheetId: SHEET_ID }],
      }),
    );
    expect(ctx.computeBridge.deleteTable).not.toHaveBeenCalled();
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
