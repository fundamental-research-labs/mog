/**
 * Range Operations Unit Tests
 *
 * Tests for range read/write/clear operations.
 */

import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';

import * as RangeOps from '../range-operations';

// ---------------------------------------------------------------------------
// Mock compute bridge
// ---------------------------------------------------------------------------

function createMockCtx(overrides: Record<string, jest.Mock> = {}): any {
  const order: string[] = [];
  return {
    order,
    userTimezone: 'UTC',
    awaitMaterialized: jest.fn().mockImplementation(async (scope: string) => {
      order.push(`await:${scope}`);
    }),
    computeBridge: {
      queryRange: jest.fn().mockResolvedValue({ cells: [], merges: [] }),
      setCellsByPosition: jest.fn().mockImplementation(async () => {
        order.push('setCellsByPosition');
      }),
      setDateValue: jest.fn().mockImplementation(async () => {
        order.push('setDateValue');
      }),
      clearRangeByPosition: jest.fn().mockImplementation(async () => {
        order.push('clearRangeByPosition');
      }),
      ...overrides,
    },
  };
}

const SHEET_ID = sheetId('sheet-1');

// ---------------------------------------------------------------------------
// clearRange
// ---------------------------------------------------------------------------

describe('clearRange', () => {
  it('calls clearRangeByPosition with correct bounds', async () => {
    const ctx = createMockCtx();
    const result = await RangeOps.clearRange(ctx, SHEET_ID, {
      sheetId: SHEET_ID,
      startRow: 0,
      startCol: 0,
      endRow: 2,
      endCol: 3,
    });

    expect(result.cellCount).toBe(12);
    expect(ctx.computeBridge.clearRangeByPosition).toHaveBeenCalledWith(SHEET_ID, 0, 0, 2, 3);
    expect(ctx.order).toEqual(['await:allSheets', 'clearRangeByPosition']);
  });

  it('passes mutation admission options to clearRangeByPosition', async () => {
    const ctx = createMockCtx();
    const options = {
      operationContext: {
        operationId: 'worksheet.clearData:1',
        kind: 'mutation',
        author: { authorId: 'user-1', actorKind: 'user' },
        createdAt: '2026-06-20T00:00:00.000Z',
        sheetIds: [SHEET_ID],
        domainIds: ['cells'],
        capturePolicy: 'commitEligible',
        writeAdmissionMode: 'capture',
      },
    };

    await RangeOps.clearRange(
      ctx,
      SHEET_ID,
      { sheetId: SHEET_ID, startRow: 0, startCol: 0, endRow: 1, endCol: 1 },
      options as any,
    );

    const captureOptions = {
      ...options,
      directEditRanges: [{ sheetId: SHEET_ID, startRow: 0, startCol: 0, endRow: 1, endCol: 1 }],
    };
    expect(ctx.computeBridge.clearRangeByPosition).toHaveBeenCalledWith(
      SHEET_ID,
      0,
      0,
      1,
      1,
      captureOptions,
    );
  });

  it('throws on swapped range bounds (startRow > endRow)', async () => {
    const ctx = createMockCtx();
    await expect(
      RangeOps.clearRange(ctx, SHEET_ID, {
        sheetId: SHEET_ID,
        startRow: 5,
        startCol: 3,
        endRow: 2,
        endCol: 1,
      }),
    ).rejects.toThrow();

    expect(ctx.computeBridge.clearRangeByPosition).not.toHaveBeenCalled();
  });

  it('throws on invalid range (negative indices)', async () => {
    const ctx = createMockCtx();
    await expect(
      RangeOps.clearRange(ctx, SHEET_ID, {
        sheetId: SHEET_ID,
        startRow: -1,
        startCol: 0,
        endRow: 2,
        endCol: 2,
      }),
    ).rejects.toThrow();

    expect(ctx.computeBridge.clearRangeByPosition).not.toHaveBeenCalled();
  });

  it('propagates bridge errors', async () => {
    const ctx = createMockCtx({
      clearRangeByPosition: jest.fn().mockRejectedValue(new Error('bridge error')),
    });
    await expect(
      RangeOps.clearRange(ctx, SHEET_ID, {
        sheetId: SHEET_ID,
        startRow: 0,
        startCol: 0,
        endRow: 1,
        endCol: 1,
      }),
    ).rejects.toThrow('bridge error');
  });

  it('returns correct cell count', async () => {
    const ctx = createMockCtx();
    const result = await RangeOps.clearRange(ctx, SHEET_ID, {
      sheetId: SHEET_ID,
      startRow: 0,
      startCol: 0,
      endRow: 1,
      endCol: 1,
    });

    // 2x2 = 4 cells
    expect(result.cellCount).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// setRange
// ---------------------------------------------------------------------------

describe('setRange', () => {
  it('converts 2D array to typed CellInput edits and calls setCellsByPosition', async () => {
    const ctx = createMockCtx();
    await RangeOps.setRange(ctx, SHEET_ID, 0, 0, [
      ['hello', 42],
      [true, null],
    ]);

    // value goes through `toCellInput` — no \x00 sentinel.
    expect(ctx.computeBridge.setCellsByPosition).toHaveBeenCalledWith(SHEET_ID, [
      { row: 0, col: 0, input: { kind: 'parse', text: 'hello' } },
      { row: 0, col: 1, input: { kind: 'value', value: 42 } },
      { row: 1, col: 0, input: { kind: 'value', value: true } },
      { row: 1, col: 1, input: { kind: 'clear' } },
    ]);
    expect(ctx.order).toEqual(['await:allSheets', 'setCellsByPosition']);
  });

  it('empty-string and null both clear (Excel convention via ergonomic helper)', async () => {
    // `setRange` is the ergonomic / primitive-accepting surface. Both `''`
    // and `null` map to Clear to match Excel / Google Sheets. The rare
    // "store empty text" intent is available via the typed-SDK path —
    // callers use `computeBridge.setCellsByPosition` with an explicit
    // `{ kind: 'literal', text: '' }` instead of this helper.
    const ctx = createMockCtx();
    await RangeOps.setRange(ctx, SHEET_ID, 0, 0, [['', null]]);
    expect(ctx.computeBridge.setCellsByPosition).toHaveBeenCalledWith(SHEET_ID, [
      { row: 0, col: 0, input: { kind: 'clear' } },
      { row: 0, col: 1, input: { kind: 'clear' } },
    ]);
  });

  it('preserves formulas starting with =', async () => {
    const ctx = createMockCtx();
    await RangeOps.setRange(ctx, SHEET_ID, 0, 0, [['=SUM(A1:A10)']]);

    expect(ctx.computeBridge.setCellsByPosition).toHaveBeenCalledWith(SHEET_ID, [
      { row: 0, col: 0, input: { kind: 'parse', text: '=SUM(A1:A10)' } },
    ]);
  });

  it('routes Date values through setDateValue instead of string coercion', async () => {
    const ctx = createMockCtx();
    await RangeOps.setRange(ctx, SHEET_ID, 0, 0, [
      ['start', new Date('2026-01-01T00:00:00.000Z')],
      [new Date('2026-02-01T00:00:00.000Z'), null],
    ]);

    expect(ctx.computeBridge.setCellsByPosition).toHaveBeenCalledWith(SHEET_ID, [
      { row: 0, col: 0, input: { kind: 'parse', text: 'start' } },
      { row: 1, col: 1, input: { kind: 'clear' } },
    ]);
    expect(ctx.computeBridge.setDateValue).toHaveBeenNthCalledWith(1, SHEET_ID, 0, 1, 2026, 1, 1);
    expect(ctx.computeBridge.setDateValue).toHaveBeenNthCalledWith(2, SHEET_ID, 1, 0, 2026, 2, 1);
    expect(ctx.order).toEqual([
      'await:allSheets',
      'setCellsByPosition',
      'setDateValue',
      'setDateValue',
    ]);
  });

  it('passes mutation admission options to setCellsByPosition', async () => {
    const ctx = createMockCtx();
    const options = {
      operationContext: {
        operationId: 'worksheet.setRange:1',
        kind: 'mutation',
        author: { authorId: 'user-1', actorKind: 'user' },
        createdAt: '2026-06-20T00:00:00.000Z',
        sheetIds: [SHEET_ID],
        domainIds: ['cells'],
        capturePolicy: 'commitEligible',
        writeAdmissionMode: 'capture',
      },
    };

    await RangeOps.setRange(ctx, SHEET_ID, 0, 0, [['hello']], options as any);

    expect(ctx.computeBridge.setCellsByPosition).toHaveBeenCalledWith(
      SHEET_ID,
      [{ row: 0, col: 0, input: { kind: 'parse', text: 'hello' } }],
      options,
    );
  });

  it('throws on invalid start address', async () => {
    const ctx = createMockCtx();
    await expect(RangeOps.setRange(ctx, SHEET_ID, -1, 0, [['x']])).rejects.toThrow();
  });

  it('skips empty values array', async () => {
    const ctx = createMockCtx();
    await RangeOps.setRange(ctx, SHEET_ID, 0, 0, []);
    expect(ctx.computeBridge.setCellsByPosition).not.toHaveBeenCalled();
    expect(ctx.awaitMaterialized).not.toHaveBeenCalled();
  });
});
