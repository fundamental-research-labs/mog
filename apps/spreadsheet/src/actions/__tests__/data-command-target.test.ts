import { jest } from '@jest/globals';

import type { Worksheet } from '@mog-sdk/contracts/api';
import type { CellRange } from '@mog-sdk/contracts/core';
import { resolveDataCommandTarget, resolveDataDialogTarget } from '../data-command-target';

function makeWorksheet(opts: {
  currentRegion?: CellRange;
  values?: Record<string, unknown>;
}): Pick<Worksheet, 'getCurrentRegion' | 'getCell'> {
  return {
    getCurrentRegion: jest.fn().mockResolvedValue(opts.currentRegion as never),
    getCell: jest.fn((row: number, col: number) =>
      Promise.resolve({ value: opts.values?.[`${row},${col}`] ?? null }),
    ),
  } as Pick<Worksheet, 'getCurrentRegion' | 'getCell'>;
}

describe('resolveDataCommandTarget', () => {
  test('explicit multi-row selection is unchanged and infers headerless when no header signal exists', async () => {
    const ws = makeWorksheet({});
    const range = { startRow: 1, startCol: 0, endRow: 5, endCol: 1 };

    await expect(resolveDataCommandTarget(ws as Worksheet, range)).resolves.toEqual({
      range,
      hasHeaders: false,
      wasExpanded: false,
    });
    expect(ws.getCurrentRegion).not.toHaveBeenCalled();
  });

  test('explicit multi-row command selection infers headers from first row', async () => {
    const ws = makeWorksheet({
      values: {
        '0,0': 'Name',
        '0,1': 'Score',
        '1,0': 'Alice',
        '1,1': '90',
      },
    });
    const range = { startRow: 0, startCol: 0, endRow: 3, endCol: 1 };

    await expect(resolveDataCommandTarget(ws as Worksheet, range)).resolves.toEqual({
      range,
      hasHeaders: true,
      wasExpanded: false,
    });
    expect(ws.getCurrentRegion).not.toHaveBeenCalled();
  });

  test('explicit multi-row command selection tolerates blank spacer rows before body values', async () => {
    const ws = makeWorksheet({
      values: {
        '2,27': '1Q',
        '3,27': '',
        '4,27': null,
        '5,27': 100536,
      },
    });
    const range = { startRow: 2, startCol: 27, endRow: 20, endCol: 27 };

    await expect(resolveDataCommandTarget(ws as Worksheet, range)).resolves.toEqual({
      range,
      hasHeaders: true,
      wasExpanded: false,
    });
    expect(ws.getCurrentRegion).not.toHaveBeenCalled();
  });

  test('explicit multi-row command selection trims a blank leading title row over body values', async () => {
    const ws = makeWorksheet({
      values: {
        '458,6': 167726,
        '459,6': 57825,
      },
    });
    const range = { startRow: 457, startCol: 6, endRow: 479, endCol: 6 };

    await expect(resolveDataCommandTarget(ws as Worksheet, range)).resolves.toEqual({
      range: { startRow: 458, startCol: 6, endRow: 479, endCol: 6 },
      hasHeaders: false,
      wasExpanded: false,
    });
    expect(ws.getCurrentRegion).not.toHaveBeenCalled();
  });

  test('explicit multi-row dialog target infers headers from first row without expanding', async () => {
    const ws = makeWorksheet({
      values: {
        '0,0': 'Name',
        '0,1': 'Score',
        '1,0': 'Alice',
        '1,1': '90',
      },
    });
    const range = { startRow: 0, startCol: 0, endRow: 3, endCol: 1 };

    await expect(resolveDataDialogTarget(ws as Worksheet, range)).resolves.toEqual({
      range,
      hasHeaders: true,
      wasExpanded: false,
    });
    expect(ws.getCurrentRegion).not.toHaveBeenCalled();
  });

  test('explicit multi-row dialog target preserves a blank leading row', async () => {
    const ws = makeWorksheet({
      values: {
        '458,6': 167726,
      },
    });
    const range = { startRow: 457, startCol: 6, endRow: 479, endCol: 6 };

    await expect(resolveDataDialogTarget(ws as Worksheet, range)).resolves.toEqual({
      range,
      hasHeaders: false,
      wasExpanded: false,
    });
    expect(ws.getCurrentRegion).not.toHaveBeenCalled();
  });

  test('single-cell selection expands through getCurrentRegion', async () => {
    const expanded = { startRow: 0, startCol: 0, endRow: 9, endCol: 3 };
    const ws = makeWorksheet({ currentRegion: expanded });

    await expect(
      resolveDataCommandTarget(ws as Worksheet, {
        startRow: 4,
        startCol: 2,
        endRow: 4,
        endCol: 2,
      }),
    ).resolves.toMatchObject({ range: expanded, wasExpanded: true });
    expect(ws.getCurrentRegion).toHaveBeenCalledWith(4, 2);
  });

  test('single-row selection expands through getCurrentRegion', async () => {
    const expanded = { startRow: 0, startCol: 0, endRow: 9, endCol: 3 };
    const ws = makeWorksheet({ currentRegion: expanded });

    await expect(
      resolveDataCommandTarget(ws as Worksheet, {
        startRow: 0,
        startCol: 0,
        endRow: 0,
        endCol: 3,
      }),
    ).resolves.toMatchObject({ range: expanded, wasExpanded: true });
    expect(ws.getCurrentRegion).toHaveBeenCalledWith(0, 0);
  });

  test('empty single-cell region returns null', async () => {
    const single = { startRow: 4, startCol: 4, endRow: 4, endCol: 4 };
    const ws = makeWorksheet({ currentRegion: single });

    await expect(resolveDataCommandTarget(ws as Worksheet, single)).resolves.toBeNull();
  });

  test('dialog target falls back to the selected range for an empty single-cell region', async () => {
    const single = { startRow: 4, startCol: 4, endRow: 4, endCol: 4 };
    const ws = makeWorksheet({ currentRegion: single });

    await expect(resolveDataDialogTarget(ws as Worksheet, single)).resolves.toEqual({
      range: single,
      hasHeaders: false,
      wasExpanded: false,
    });
  });

  test('non-empty single-cell region resolves as a headerless target', async () => {
    const single = { startRow: 0, startCol: 0, endRow: 0, endCol: 0 };
    const ws = makeWorksheet({
      currentRegion: single,
      values: { '0,0': 'Apple,Banana,Cherry' },
    });

    await expect(resolveDataCommandTarget(ws as Worksheet, single)).resolves.toEqual({
      range: single,
      hasHeaders: false,
      wasExpanded: true,
    });
  });

  test('expanded text first row and numeric second row infers headers', async () => {
    const ws = makeWorksheet({
      currentRegion: { startRow: 0, startCol: 0, endRow: 2, endCol: 1 },
      values: {
        '0,0': 'Name',
        '0,1': 'Score',
        '1,0': 'Ada',
        '1,1': 10,
      },
    });

    await expect(
      resolveDataCommandTarget(ws as Worksheet, {
        startRow: 1,
        startCol: 1,
        endRow: 1,
        endCol: 1,
      }),
    ).resolves.toMatchObject({ hasHeaders: true });
  });

  test('expanded text first row and numeric-string second row infers headers', async () => {
    const ws = makeWorksheet({
      currentRegion: { startRow: 0, startCol: 0, endRow: 3, endCol: 1 },
      values: {
        '0,0': 'Name',
        '0,1': 'Score',
        '1,0': 'Charlie',
        '1,1': '3',
      },
    });

    await expect(
      resolveDataCommandTarget(ws as Worksheet, {
        startRow: 1,
        startCol: 0,
        endRow: 1,
        endCol: 0,
      }),
    ).resolves.toMatchObject({ hasHeaders: true });
  });

  test('expanded numeric first and second rows are headerless', async () => {
    const ws = makeWorksheet({
      currentRegion: { startRow: 0, startCol: 0, endRow: 2, endCol: 1 },
      values: {
        '0,0': 1,
        '0,1': 2,
        '1,0': 3,
        '1,1': 4,
      },
    });

    await expect(
      resolveDataCommandTarget(ws as Worksheet, {
        startRow: 0,
        startCol: 0,
        endRow: 0,
        endCol: 0,
      }),
    ).resolves.toMatchObject({ hasHeaders: false });
  });

  test('single-column all-text expanded region does not infer headers', async () => {
    const ws = makeWorksheet({
      currentRegion: { startRow: 0, startCol: 0, endRow: 2, endCol: 0 },
      values: {
        '0,0': 'Banana',
        '1,0': 'Apple',
      },
    });

    await expect(
      resolveDataCommandTarget(ws as Worksheet, {
        startRow: 0,
        startCol: 0,
        endRow: 0,
        endCol: 0,
      }),
    ).resolves.toMatchObject({ hasHeaders: false });
  });
});
