import { jest } from '@jest/globals';

import type { Worksheet } from '@mog-sdk/contracts/api';
import type { CellRange } from '@mog-sdk/contracts/core';

import { resolveChartSourceRange } from '../chart-source-range';

function createWorksheet(opts: {
  expandedRegion?: CellRange;
  hiddenRows?: number[];
  hiddenCols?: number[];
  pointHiddenRows?: number[];
  pointHiddenCols?: number[];
  cellValues?: Record<string, unknown>;
}): Worksheet {
  return {
    getCurrentRegion: jest.fn().mockImplementation(async (row: number, col: number) => {
      return opts.expandedRegion ?? { startRow: row, startCol: col, endRow: row, endCol: col };
    }),
    getValue: jest.fn().mockImplementation(async (row: number, col: number) => {
      return opts.cellValues?.[`${row},${col}`] ?? null;
    }),
    layout: {
      getHiddenRowsBitmap: jest.fn(async () => new Set(opts.hiddenRows ?? [])),
      getHiddenColumnsBitmap: jest.fn(async () => new Set(opts.hiddenCols ?? [])),
      isRowHidden: jest.fn(async (row: number) => (opts.pointHiddenRows ?? []).includes(row)),
      isColumnHidden: jest.fn(async (col: number) => (opts.pointHiddenCols ?? []).includes(col)),
    },
  } as unknown as Worksheet;
}

describe('resolveChartSourceRange', () => {
  it('expands a single-cell chart source to the full current region when no hidden detail splits it', async () => {
    const ws = createWorksheet({
      expandedRegion: { startRow: 0, startCol: 0, endRow: 9, endCol: 3 },
    });

    await expect(
      resolveChartSourceRange(ws, { startRow: 1, startCol: 1, endRow: 1, endCol: 1 }),
    ).resolves.toEqual({ startRow: 0, startCol: 0, endRow: 9, endCol: 3 });
  });

  it('uses the leading visible summary span when hidden detail columns split an expanded single-cell region', async () => {
    const ws = createWorksheet({
      expandedRegion: { startRow: 20, startCol: 11, endRow: 20, endCol: 27 },
      hiddenCols: [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26],
      cellValues: {
        '20,11': 'Total',
        '20,12': 34500,
        '20,13': 45000,
        '20,14': null,
        '20,27': 6732,
      },
    });

    await expect(
      resolveChartSourceRange(
        ws,
        { startRow: 20, startCol: 27, endRow: 20, endCol: 27 },
        { trimHiddenDetail: true },
      ),
    ).resolves.toEqual({ startRow: 20, startCol: 11, endRow: 20, endCol: 13 });
  });

  it('preserves explicit single-row chart sources by default for wizard-driven creation', async () => {
    const range = { startRow: 20, startCol: 11, endRow: 20, endCol: 27 };
    const ws = createWorksheet({
      expandedRegion: range,
      hiddenCols: [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26],
      cellValues: {
        '20,11': 'Total',
        '20,12': 34500,
        '20,13': 45000,
        '20,27': 6732,
      },
    });

    await expect(resolveChartSourceRange(ws, range)).resolves.toEqual(range);
  });

  it('preserves explicit multi-row chart sources even when hidden detail columns split the range', async () => {
    const range = { startRow: 2, startCol: 11, endRow: 6, endCol: 27 };
    const ws = createWorksheet({
      expandedRegion: range,
      hiddenCols: [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26],
      cellValues: {
        '6,11': 'Total',
        '6,12': 505000,
        '6,13': 600000,
        '6,27': 100536,
      },
    });

    await expect(resolveChartSourceRange(ws, range)).resolves.toEqual(range);
  });

  it('falls back to point visibility checks when the bulk hidden-column bitmap is stale', async () => {
    const ws = createWorksheet({
      expandedRegion: { startRow: 20, startCol: 11, endRow: 20, endCol: 27 },
      hiddenCols: [],
      pointHiddenCols: [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26],
      cellValues: {
        '20,11': 'Total',
        '20,12': 34500,
        '20,13': 45000,
        '20,14': null,
        '20,27': 6732,
      },
    });

    await expect(
      resolveChartSourceRange(
        ws,
        { startRow: 20, startCol: 27, endRow: 20, endCol: 27 },
        { trimHiddenDetail: true },
      ),
    ).resolves.toEqual({ startRow: 20, startCol: 11, endRow: 20, endCol: 13 });
  });
});
