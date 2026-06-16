/**
 * Query Operations Tests — findByValue type coercion
 *
 * Verifies that findByValue handles type coercion between numbers and
 * numeric strings, while preserving strict matching for other types.
 */

import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';

import * as QueryOps from '../query-operations';

// =============================================================================
// Mock Helpers
// =============================================================================

const SHEET_ID = sheetId('sheet-1');

/**
 * Create a mock DocumentContext whose queryRange returns cells with the given values.
 * Each value becomes a cell at (0, index).
 */
function createMockCtx(cellValues: Array<string | number | boolean | null>) {
  const cells = cellValues.map((v, i) => ({
    cellId: `cell-${i}`,
    row: 0,
    col: i,
    value: v,
    formula: undefined,
    formatted: undefined,
  }));
  const matchesSearch = (cellValue: string | number | boolean | null, search: string): boolean => {
    if (search === 'true') return cellValue === true;
    if (search === 'false') return cellValue === false;

    if (typeof cellValue === 'number') {
      return search.trim() !== '' && Number(search) === cellValue;
    }

    if (typeof cellValue === 'string') {
      if (cellValue === search) return true;
      if (cellValue.trim() === '' || search.trim() === '') return false;
      const searchNumber = Number(search);
      const cellNumber = Number(cellValue);
      return (
        Number.isFinite(searchNumber) && Number.isFinite(cellNumber) && searchNumber === cellNumber
      );
    }

    return false;
  };

  return {
    computeBridge: {
      findCellsByValue: jest
        .fn()
        .mockImplementation((_sheetId, value: string) =>
          Promise.resolve(
            cells
              .filter((cell) => matchesSearch(cell.value, value))
              .map((cell) => [cell.row, cell.col]),
          ),
        ),
      getDataBounds: jest.fn().mockResolvedValue({
        minRow: 0,
        minCol: 0,
        maxRow: 0,
        maxCol: Math.max(cellValues.length - 1, 0),
      }),
      queryRange: jest.fn().mockResolvedValue({ cells }),
    },
  } as any;
}

// =============================================================================
// Tests
// =============================================================================

describe('findByValue type coercion', () => {
  it('exact number match: findByValue(42) matches cell with number 42', async () => {
    const ctx = createMockCtx([42, 100, 0]);
    const results = await QueryOps.findByValue(ctx, SHEET_ID, 42);
    expect(results).toEqual([{ sheetId: SHEET_ID, row: 0, col: 0 }]);
  });

  it('exact string match: findByValue("hello") matches cell with string "hello"', async () => {
    const ctx = createMockCtx(['hello', 'world']);
    const results = await QueryOps.findByValue(ctx, SHEET_ID, 'hello');
    expect(results).toEqual([{ sheetId: SHEET_ID, row: 0, col: 0 }]);
  });

  it('string-to-number coercion: findByValue("42") matches cell with number 42', async () => {
    const ctx = createMockCtx([42, 100]);
    const results = await QueryOps.findByValue(ctx, SHEET_ID, '42');
    expect(results).toEqual([{ sheetId: SHEET_ID, row: 0, col: 0 }]);
  });

  it('number-to-string coercion: findByValue(42) matches cell with string "42"', async () => {
    const ctx = createMockCtx(['42', 'abc']);
    const results = await QueryOps.findByValue(ctx, SHEET_ID, 42);
    expect(results).toEqual([{ sheetId: SHEET_ID, row: 0, col: 0 }]);
  });

  it('non-numeric strings do NOT match numbers: findByValue("hello") does not match 0', async () => {
    const ctx = createMockCtx([0, 1]);
    const results = await QueryOps.findByValue(ctx, SHEET_ID, 'hello');
    expect(results).toEqual([]);
  });

  it('boolean strict match: findByValue(true) does NOT match string "true" or number 1', async () => {
    const ctx = createMockCtx(['true', 1, true]);
    const results = await QueryOps.findByValue(ctx, SHEET_ID, true);
    // Only the actual boolean true (index 2) should match
    expect(results).toEqual([{ sheetId: SHEET_ID, row: 0, col: 2 }]);
  });

  it('findByValue(0) does NOT match empty string or "false"', async () => {
    const ctx = createMockCtx(['', 'false', 0]);
    const results = await QueryOps.findByValue(ctx, SHEET_ID, 0);
    // Only the exact number 0 (index 2) should match — blank strings and "false" are excluded
    expect(results).toEqual([{ sheetId: SHEET_ID, row: 0, col: 2 }]);
  });
});

describe('findCells(query)', () => {
  it('finds blank cells inside an explicit bounded range with pagination', async () => {
    const ctx = {
      computeBridge: {
        queryRange: jest.fn().mockResolvedValue({
          cells: [
            { row: 0, col: 0, value: 1, formula: undefined },
            { row: 0, col: 2, value: 2, formula: '=A1' },
          ],
        }),
      },
    } as any;

    const result = await QueryOps.findCellsByQuery(
      ctx,
      SHEET_ID,
      { blank: true, hasFormula: false, pageSize: 2 },
      { startRow: 0, startCol: 0, endRow: 1, endCol: 2 },
    );

    expect(ctx.computeBridge.queryRange).toHaveBeenCalledWith(SHEET_ID, 0, 0, 1, 2);
    expect(result).toEqual({
      addresses: ['B1', 'A2'],
      cells: [
        { address: 'B1', row: 0, col: 1 },
        { address: 'A2', row: 1, col: 0 },
      ],
      ranges: ['B1', 'A2'],
      truncated: true,
      nextCursor: '4',
    });
  });

  it('filters blank formatted cells with fillColor alias and returns requested metadata', async () => {
    const ctx = {
      computeBridge: {
        queryRange: jest.fn().mockResolvedValue({
          cells: [
            {
              row: 0,
              col: 0,
              value: null,
              formula: undefined,
              format: { backgroundColor: '#FFF2CC' },
            },
            {
              row: 0,
              col: 1,
              value: null,
              formula: undefined,
              format: { backgroundColor: '#ffffff' },
            },
            {
              row: 0,
              col: 2,
              value: 1,
              formula: undefined,
              format: { backgroundColor: '#FFF2CC' },
            },
          ],
        }),
      },
    } as any;

    const result = await QueryOps.findCellsByQuery(
      ctx,
      SHEET_ID,
      {
        blank: true,
        format: { fillColor: ['#fff2cc'] },
        include: ['value', 'format'],
      },
      { startRow: 0, startCol: 0, endRow: 0, endCol: 2 },
    );

    expect(result).toEqual({
      addresses: ['A1'],
      cells: [
        {
          address: 'A1',
          row: 0,
          col: 0,
          value: null,
          format: { backgroundColor: '#FFF2CC' },
        },
      ],
      ranges: ['A1'],
      truncated: false,
    });
  });
});
