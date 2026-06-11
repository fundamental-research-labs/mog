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

  test('explicit multi-row command selection infers headers when first row looks like headers', async () => {
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

  test('explicit single-column mixed-data command selection remains headerless', async () => {
    const ws = makeWorksheet({
      values: {
        '1,0': 'Banana',
        '2,0': 1,
      },
    });
    const range = { startRow: 1, startCol: 0, endRow: 5, endCol: 0 };

    await expect(resolveDataCommandTarget(ws as Worksheet, range)).resolves.toEqual({
      range,
      hasHeaders: false,
      wasExpanded: false,
    });
    expect(ws.getCurrentRegion).not.toHaveBeenCalled();
  });

  test('explicit fiscal single-column command selection infers a header before spacer rows', async () => {
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

  test('explicit multi-row dialog target tolerates dense text headers with blank separators', async () => {
    const range = { startRow: 2, startCol: 11, endRow: 20, endCol: 27 };
    const ws = makeWorksheet({
      values: {
        '2,11': 'FY11/25',
        '2,12': 'FY11/25',
        '2,13': 'FY11/28',
        '2,14': null,
        '2,15': '1Q',
        '2,16': '2Q',
        '2,17': '3Q',
        '2,18': '4Q',
        '2,19': '1Q',
        '2,20': '2Q',
        '2,21': '3Q',
        '2,22': '4Q',
        '2,23': '1Q',
        '2,24': '2Q',
        '2,25': '3Q',
        '2,26': '4Q',
        '2,27': '1Q',
        '6,12': 505000,
        '6,13': 600000,
        '6,15': 128319,
      },
    });

    await expect(resolveDataDialogTarget(ws as Worksheet, range)).resolves.toEqual({
      range,
      hasHeaders: true,
      wasExpanded: false,
    });
    expect(ws.getCurrentRegion).not.toHaveBeenCalled();
  });

  test('explicit multi-row dialog target keeps sparse title blocks headerless', async () => {
    const range = { startRow: 457, startCol: 0, endRow: 479, endCol: 10 };
    const ws = makeWorksheet({
      values: {
        '457,0': 'Consolidated Report',
        '463,6': 235658,
        '467,9': 486344,
      },
    });

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
