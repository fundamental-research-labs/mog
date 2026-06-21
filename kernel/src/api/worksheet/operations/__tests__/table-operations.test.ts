import { jest } from '@jest/globals';

import { bridgeTableToTableInfo } from '../table-operations';
import {
  clearCalculatedColumnFormula,
  setCalculatedColumnFormula,
} from '../table-calculated-columns';
import type { Table } from '../../../../bridges/compute/compute-types.gen';

function makeTable(style: string): Table {
  return {
    id: 'Table1',
    name: 'Table1',
    displayName: 'Table1',
    sheetId: 'sheet-1',
    range: { startRow: 0, startCol: 0, endRow: 1, endCol: 1 },
    columns: [
      {
        id: '1',
        name: 'Name',
        index: 0,
        totalsFunction: null,
        totalsLabel: null,
      },
    ],
    hasHeaderRow: true,
    hasTotalsRow: false,
    style,
    bandedRows: true,
    bandedColumns: false,
    emphasizeFirstColumn: false,
    emphasizeLastColumn: false,
    showFilterButtons: true,
    autoExpand: true,
    autoCalculatedColumns: true,
  };
}

function makeCalculatedTable(overrides: Partial<Table> = {}): Table {
  return {
    id: 'table-1',
    name: 'Sales',
    displayName: 'Sales',
    sheetId: 'sheet-1',
    range: { startRow: 0, startCol: 0, endRow: 3, endCol: 2 },
    columns: [
      { id: '1', name: 'Qty', index: 0, totalsFunction: null, totalsLabel: null },
      { id: '2', name: 'Price', index: 1, totalsFunction: null, totalsLabel: null },
      { id: '3', name: 'Total', index: 2, totalsFunction: null, totalsLabel: null },
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

function createReceiptCtx(table: Table | null, overrides: Record<string, jest.Mock> = {}): any {
  return {
    computeBridge: {
      getTableByName: jest.fn().mockResolvedValue(table),
      beginUndoGroup: jest.fn().mockResolvedValue(undefined),
      endUndoGroup: jest.fn().mockResolvedValue(undefined),
      updateCalculatedColumn: jest.fn().mockResolvedValue(undefined),
      removeCalculatedColumn: jest.fn().mockResolvedValue(undefined),
      setCellsByPosition: jest.fn().mockResolvedValue(undefined),
      autoFill: jest.fn().mockResolvedValue({
        data: {
          patternType: 'copy',
          filledCellCount: 2,
          warnings: [],
          changes: [],
        },
      }),
      ...overrides,
    },
  };
}

function expectTableMutationOptions(operationIdPrefix: string) {
  return expect.objectContaining({
    operationContext: expect.objectContaining({
      operationId: expect.stringMatching(
        new RegExp(`^${operationIdPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`),
      ),
      kind: 'mutation',
      sheetIds: ['sheet-1'],
      domainIds: ['tables'],
      capturePolicy: 'commitEligible',
      writeAdmissionMode: 'capture',
    }),
  });
}

describe('bridgeTableToTableInfo', () => {
  it('returns canonical built-in table style names for full compute IDs', () => {
    expect(bridgeTableToTableInfo(makeTable('TableStyleMedium4')).style).toBe('TableStyleMedium4');
  });

  it('canonicalizes short built-in table style IDs to public style names', () => {
    expect(bridgeTableToTableInfo(makeTable('medium4')).style).toBe('TableStyleMedium4');
  });

  it('preserves custom table style names', () => {
    expect(bridgeTableToTableInfo(makeTable('MyCustomStyle')).style).toBe('MyCustomStyle');
  });

  it('normalizes built-in table style casing and zero padding', () => {
    expect(bridgeTableToTableInfo(makeTable('tablestylemedium04')).style).toBe('TableStyleMedium4');
  });
});

describe('calculated column receipts', () => {
  it('sets calculated columns with metadata, seed write, autofill, and grouped undo effects', async () => {
    const ctx = createReceiptCtx(makeCalculatedTable());

    const result = await setCalculatedColumnFormula(ctx, 'sheet-1', 'Sales', 2, '=[@Qty]*[@Price]');

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(ctx.computeBridge.beginUndoGroup).toHaveBeenCalledTimes(1);
    expect(ctx.computeBridge.updateCalculatedColumn).toHaveBeenCalledWith(
      'Sales',
      2,
      '=[@Qty]*[@Price]',
      expectTableMutationOptions('tables.setCalculatedColumn'),
    );
    expect(ctx.computeBridge.setCellsByPosition).toHaveBeenCalledWith(
      'sheet-1',
      [{ row: 1, col: 2, input: { kind: 'parse', text: '=[@Qty]*[@Price]' } }],
      expectTableMutationOptions('tables.setCalculatedColumn'),
    );
    const beginOptions = ctx.computeBridge.beginUndoGroup.mock.calls[0][0];
    const updateOptions = ctx.computeBridge.updateCalculatedColumn.mock.calls[0][3];
    const seedOptions = ctx.computeBridge.setCellsByPosition.mock.calls[0][2];
    const endOptions = ctx.computeBridge.endUndoGroup.mock.calls[0][0];
    expect(beginOptions.operationContext.groupId).toBe(beginOptions.operationContext.operationId);
    expect(updateOptions.operationContext.groupId).toBe(beginOptions.operationContext.groupId);
    expect(seedOptions.operationContext.groupId).toBe(beginOptions.operationContext.groupId);
    expect(endOptions.operationContext.groupId).toBe(beginOptions.operationContext.groupId);
    expect(updateOptions.operationContext.operationId).not.toBe(
      beginOptions.operationContext.operationId,
    );
    expect(ctx.computeBridge.autoFill).toHaveBeenCalledWith(
      'sheet-1',
      expect.objectContaining({
        sourceRange: { startRow: 1, startCol: 2, endRow: 1, endCol: 2 },
        targetRange: { startRow: 2, startCol: 2, endRow: 3, endCol: 2 },
        mode: 'withoutFormats',
      }),
    );
    expect(ctx.computeBridge.endUndoGroup).toHaveBeenCalledTimes(1);
    expect(result.data).toMatchObject({
      kind: 'table.calculatedColumn.set',
      status: 'applied',
      tableName: 'Sales',
      tableId: 'table-1',
      columnIndex: 2,
      columnName: 'Total',
      formula: '=[@Qty]*[@Price]',
      tableRange: 'A1:C4',
      bodyRange: 'A2:C4',
      columnRange: 'C2:C4',
      cellsWritten: 3,
      metadataChanged: true,
      undoGroup: true,
    });
    expect(result.data.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'updatedConfig', range: 'A1:C4' }),
        expect.objectContaining({ type: 'storedMetadata', range: 'A1:C4' }),
        expect.objectContaining({ type: 'materializedCells', range: 'C2:C2', count: 1 }),
        expect.objectContaining({ type: 'changedRange', range: 'C2:C2', count: 1 }),
        expect.objectContaining({ type: 'materializedCells', range: 'C3:C4', count: 2 }),
        expect.objectContaining({ type: 'changedRange', range: 'C3:C4', count: 2 }),
        expect.objectContaining({
          type: 'createdUndoEntry',
          range: 'A1:C4',
          details: expect.objectContaining({ undoGroup: true }),
        }),
      ]),
    );
    expect(result.data.autofillReceipt).toMatchObject({
      kind: 'autofill.apply',
      status: 'applied',
      filledCellCount: 2,
    });
  });

  it('returns noOp when setting the same stored formula on an empty body column', async () => {
    const table = makeCalculatedTable({
      range: { startRow: 0, startCol: 0, endRow: 0, endCol: 2 },
      columns: [
        { id: '1', name: 'Qty', index: 0, totalsFunction: null, totalsLabel: null },
        { id: '2', name: 'Price', index: 1, totalsFunction: null, totalsLabel: null },
        {
          id: '3',
          name: 'Total',
          index: 2,
          totalsFunction: null,
          totalsLabel: null,
          calculatedFormula: '=[@Qty]*[@Price]',
        },
      ],
    });
    const ctx = createReceiptCtx(table);

    const result = await setCalculatedColumnFormula(ctx, 'sheet-1', 'Sales', 2, '=[@Qty]*[@Price]');

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(ctx.computeBridge.beginUndoGroup).not.toHaveBeenCalled();
    expect(ctx.computeBridge.updateCalculatedColumn).not.toHaveBeenCalled();
    expect(ctx.computeBridge.setCellsByPosition).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({
      kind: 'table.calculatedColumn.set',
      status: 'noOp',
      tableRange: 'A1:C1',
      bodyRange: null,
      columnRange: null,
      cellsWritten: 0,
      metadataChanged: false,
      effects: [expect.objectContaining({ type: 'worksheetUnchanged', range: 'A1:C1' })],
    });
  });

  it('returns a partial receipt when set metadata succeeds but formula write fails', async () => {
    const ctx = createReceiptCtx(makeCalculatedTable(), {
      setCellsByPosition: jest.fn().mockRejectedValue(new Error('write failed')),
    });

    const result = await setCalculatedColumnFormula(ctx, 'sheet-1', 'Sales', 2, '=1');

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(ctx.computeBridge.updateCalculatedColumn).toHaveBeenCalledWith(
      'Sales',
      2,
      '=1',
      expectTableMutationOptions('tables.setCalculatedColumn'),
    );
    expect(ctx.computeBridge.autoFill).not.toHaveBeenCalled();
    expect(ctx.computeBridge.endUndoGroup).toHaveBeenCalledTimes(1);
    expect(result.data).toMatchObject({
      kind: 'table.calculatedColumn.set',
      status: 'partial',
      metadataChanged: true,
      cellsWritten: 0,
      diagnostics: [
        expect.objectContaining({
          severity: 'error',
          code: 'TABLE_CALCULATED_COLUMN_SET_FAILED',
          target: expect.objectContaining({ stage: 'writeSeedCell' }),
        }),
      ],
    });
    expect(result.data.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'updatedConfig' }),
        expect.objectContaining({ type: 'storedMetadata' }),
        expect.objectContaining({ type: 'createdUndoEntry' }),
      ]),
    );
  });

  it('clears calculated columns with metadata and changed range effects', async () => {
    const ctx = createReceiptCtx(makeCalculatedTable());

    const result = await clearCalculatedColumnFormula(ctx, 'sheet-1', 'Sales', 2);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(ctx.computeBridge.removeCalculatedColumn).toHaveBeenCalledWith(
      'Sales',
      2,
      expectTableMutationOptions('tables.clearCalculatedColumn'),
    );
    expect(ctx.computeBridge.setCellsByPosition).toHaveBeenCalledWith(
      'sheet-1',
      [
        { row: 1, col: 2, input: { kind: 'clear' } },
        { row: 2, col: 2, input: { kind: 'clear' } },
        { row: 3, col: 2, input: { kind: 'clear' } },
      ],
      expectTableMutationOptions('tables.clearCalculatedColumn'),
    );
    expect(result.data).toMatchObject({
      kind: 'table.calculatedColumn.clear',
      status: 'applied',
      tableName: 'Sales',
      columnRange: 'C2:C4',
      cellsWritten: 3,
      metadataChanged: true,
      undoGroup: false,
    });
    expect(result.data.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'updatedConfig', range: 'A1:C4' }),
        expect.objectContaining({ type: 'storedMetadata', range: 'A1:C4' }),
        expect.objectContaining({ type: 'changedRange', range: 'C2:C4', count: 3 }),
        expect.objectContaining({
          type: 'createdUndoEntry',
          details: expect.objectContaining({ undoGroup: false }),
        }),
      ]),
    );
  });

  it('returns an operation failure when the table does not exist', async () => {
    const ctx = createReceiptCtx(null);

    const result = await clearCalculatedColumnFormula(ctx, 'sheet-1', 'Missing', 0);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(ctx.computeBridge.removeCalculatedColumn).not.toHaveBeenCalled();
    expect(result.error.message).toContain('Table not found');
  });
});
