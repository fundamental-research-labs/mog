import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';

import type { DocumentContext } from '../../context';
import { KernelError } from '../../errors';
import { WorksheetLayoutImpl } from '../worksheet/layout';

const SHEET_ID = sheetId('sheet-1');

function createHarness() {
  const computeBridge = {
    canDoStructureOp: jest.fn(async () => true),
    getColWidthQuery: jest.fn(async () => 120),
    setColWidth: jest.fn(async () => undefined),
    setColWidths: jest.fn(async () => undefined),
    getColWidthCharsQuery: jest.fn(async () => 8.43),
    setColWidthChars: jest.fn(async () => undefined),
    setColWidthsChars: jest.fn(async () => undefined),
    autoFitColumnAndSet: jest.fn(async () => undefined),
    autoFitColumnsAndSet: jest.fn(async () => undefined),
    getColWidthsBatch: jest.fn(async () => [] as Array<[number, number]>),
    getColWidthsBatchChars: jest.fn(async () => [] as Array<[number, number]>),
    hideColumns: jest.fn(async () => undefined),
    unhideColumns: jest.fn(async () => undefined),
    isColHiddenQuery: jest.fn(async () => false),
    getDefaultColWidthChars: jest.fn(async () => 8.43),
    getColPosition: jest.fn(async () => 64),
  };
  const ctx = {
    writeGate: { assertWritable: jest.fn() },
    computeBridge,
  } as unknown as DocumentContext;

  return {
    computeBridge,
    layout: new WorksheetLayoutImpl(ctx, SHEET_ID),
  };
}

describe('WorksheetLayout Office-style column selectors', () => {
  it.each(['B', '$b', 'B:B', '$B:$B'])(
    'sets one column selected by %s through the scalar production bridge',
    async (selector) => {
      const { computeBridge, layout } = createHarness();

      await layout.setColumnWidth(selector, 120);

      expect(computeBridge.setColWidth).toHaveBeenCalledWith(SHEET_ID, 1, 120);
      expect(computeBridge.setColWidths).not.toHaveBeenCalled();
    },
  );

  it('preserves zero-based numeric selectors', async () => {
    const { computeBridge, layout } = createHarness();

    await layout.setColumnWidth(1, 120);

    expect(computeBridge.setColWidth).toHaveBeenCalledWith(SHEET_ID, 1, 120);
  });

  it('expands a whole-column range through the batch production bridge', async () => {
    const { computeBridge, layout } = createHarness();

    await layout.setColumnWidth('$B:$D', 120);

    expect(computeBridge.setColWidths).toHaveBeenCalledWith(SHEET_ID, [
      [1, 120],
      [2, 120],
      [3, 120],
    ]);
    expect(computeBridge.setColWidth).not.toHaveBeenCalled();
  });

  it('normalizes character-width and tuple mutations with last overlap winning', async () => {
    const { computeBridge, layout } = createHarness();

    await layout.setColumnWidthChars('B:D', 12);
    expect(computeBridge.setColWidthsChars).toHaveBeenCalledWith(SHEET_ID, [
      [1, 12],
      [2, 12],
      [3, 12],
    ]);

    computeBridge.setColWidths.mockClear();
    await layout.setColumnWidths([
      ['B:D', 120],
      ['$C', 140],
    ]);
    expect(computeBridge.setColWidths).toHaveBeenCalledWith(SHEET_ID, [
      [1, 120],
      [2, 140],
      [3, 120],
    ]);
  });

  it('accepts range selectors across column collection operations', async () => {
    const { computeBridge, layout } = createHarness();

    await layout.autoFitColumn('B:D');
    expect(computeBridge.autoFitColumnsAndSet).toHaveBeenCalledWith(SHEET_ID, [1, 2, 3]);

    await layout.autoFitColumns('B:D');
    expect(computeBridge.autoFitColumnsAndSet).toHaveBeenLastCalledWith(SHEET_ID, [1, 2, 3]);

    await layout.setColumnVisible('$B:$D', false);
    expect(computeBridge.hideColumns).toHaveBeenCalledWith(SHEET_ID, [1, 2, 3]);

    await layout.unhideColumns('B:D');
    expect(computeBridge.unhideColumns).toHaveBeenCalledWith(SHEET_ID, [1, 2, 3]);

    await layout.hideColumns(['B', 'D:D']);
    expect(computeBridge.hideColumns).toHaveBeenLastCalledWith(SHEET_ID, [1, 3]);

    await layout.resetColumnWidth('B:D');
    expect(computeBridge.setColWidthsChars).toHaveBeenLastCalledWith(SHEET_ID, [
      [1, 8.43],
      [2, 8.43],
      [3, 8.43],
    ]);
  });

  it('accepts one range selector or two scalar selectors for batch reads', async () => {
    const { computeBridge, layout } = createHarness();

    await layout.getColWidthsBatch('B:D');
    expect(computeBridge.getColWidthsBatch).toHaveBeenCalledWith(SHEET_ID, 1, 3);

    await layout.getColWidthsBatchChars('$B', 'D:D');
    expect(computeBridge.getColWidthsBatchChars).toHaveBeenCalledWith(SHEET_ID, 1, 3);
  });

  it('accepts scalar string selectors on scalar reads', async () => {
    const { computeBridge, layout } = createHarness();

    await expect(layout.getColumnWidth('b:b')).resolves.toBe(120);
    expect(computeBridge.getColWidthQuery).toHaveBeenCalledWith(SHEET_ID, 1);

    await expect(layout.getColumnWidthChars('$B')).resolves.toBe(8.43);
    expect(computeBridge.getColWidthCharsQuery).toHaveBeenCalledWith(SHEET_ID, 1);

    await expect(layout.isColumnHidden('B')).resolves.toBe(false);
    expect(computeBridge.isColHiddenQuery).toHaveBeenCalledWith(SHEET_ID, 1);

    await expect(layout.getColPosition('B:B')).resolves.toBe(64);
    expect(computeBridge.getColPosition).toHaveBeenCalledWith(SHEET_ID, 1);
  });

  it('rejects multi-column selectors on scalar reads before a bridge call', async () => {
    const { computeBridge, layout } = createHarness();

    await expect(layout.getColumnWidth('B:D')).rejects.toThrow('Expected one column');

    expect(computeBridge.getColWidthQuery).not.toHaveBeenCalled();
  });

  it('rejects invalid selectors before any width mutation', async () => {
    const { computeBridge, layout } = createHarness();

    for (const selector of ['A1', '1:3', 'Sheet1!A:A', 'D:B', 'XFE', -1, 1.5]) {
      await expect(layout.setColumnWidth(selector, 120)).rejects.toBeInstanceOf(KernelError);
    }

    expect(computeBridge.setColWidth).not.toHaveBeenCalled();
    expect(computeBridge.setColWidths).not.toHaveBeenCalled();
  });
});
