import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import type { CellRange } from '@mog-sdk/contracts/core';

import { EXTEND_TO_A1, EXTEND_TO_LAST_USED_CELL, EXTEND_TO_ROW_END } from '../home-end';
import type { CellCoord } from '../helpers';

function makeDeps(options: {
  activeCell: CellCoord;
  ranges: CellRange[];
  anchor: CellCoord | null;
  lastDataCol?: number | null;
  usedRange?: CellRange | null;
}) {
  const setSelection = jest.fn();
  const keyHome = jest.fn();
  const findLastColumn = jest.fn().mockResolvedValue({ lastDataCol: options.lastDataCol ?? null });
  const getUsedRange = jest.fn().mockResolvedValue(options.usedRange ?? null);

  const deps = {
    getActiveSheetId: () => 'sheet-1',
    accessors: {
      selection: {
        getActiveCell: () => options.activeCell,
        getRanges: () => options.ranges,
        getAnchor: () => options.anchor,
      },
    },
    workbook: {
      getSheetById: () => ({
        findLastColumn,
        getUsedRange,
      }),
    },
    commands: {
      selection: {
        setSelection,
        keyHome,
      },
    },
  } as unknown as ActionDependencies;

  return { deps, setSelection, keyHome, findLastColumn, getUsedRange };
}

describe('Home/End selection handlers', () => {
  describe('EXTEND_TO_A1', () => {
    it('extends from the current anchor and keeps the anchor active', () => {
      const setup = makeDeps({
        activeCell: { row: 2, col: 2 },
        ranges: [{ startRow: 2, startCol: 2, endRow: 2, endCol: 3 }],
        anchor: { row: 2, col: 2 },
      });

      const result = EXTEND_TO_A1(setup.deps);

      expect(result.handled).toBe(true);
      expect(setup.keyHome).not.toHaveBeenCalled();
      expect(setup.setSelection).toHaveBeenCalledWith(
        [{ startRow: 0, startCol: 0, endRow: 2, endCol: 2 }],
        { row: 2, col: 2 },
        { row: 2, col: 2 },
      );
    });

    it('establishes the anchor from the active cell on the first extend', () => {
      const setup = makeDeps({
        activeCell: { row: 10, col: 10 },
        ranges: [{ startRow: 10, startCol: 10, endRow: 10, endCol: 10 }],
        anchor: null,
      });

      const result = EXTEND_TO_A1(setup.deps);

      expect(result.handled).toBe(true);
      expect(setup.setSelection).toHaveBeenCalledWith(
        [{ startRow: 0, startCol: 0, endRow: 10, endCol: 10 }],
        { row: 10, col: 10 },
        { row: 10, col: 10 },
      );
    });
  });

  describe('EXTEND_TO_ROW_END', () => {
    it('extends to the row data edge while keeping the anchor active', async () => {
      const setup = makeDeps({
        activeCell: { row: 2, col: 0 },
        ranges: [{ startRow: 2, startCol: 0, endRow: 2, endCol: 0 }],
        anchor: null,
        lastDataCol: 4,
      });

      const result = await EXTEND_TO_ROW_END(setup.deps);

      expect(result.handled).toBe(true);
      expect(setup.findLastColumn).toHaveBeenCalledWith(2);
      expect(setup.setSelection).toHaveBeenCalledWith(
        [{ startRow: 2, startCol: 0, endRow: 2, endCol: 4 }],
        { row: 2, col: 0 },
        { row: 2, col: 0 },
      );
    });
  });

  describe('EXTEND_TO_LAST_USED_CELL', () => {
    it('extends to the sheet used-range edge while keeping the anchor active', async () => {
      const setup = makeDeps({
        activeCell: { row: 0, col: 0 },
        ranges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }],
        anchor: null,
        usedRange: { startRow: 0, startCol: 0, endRow: 4, endCol: 3 },
      });

      const result = await EXTEND_TO_LAST_USED_CELL(setup.deps);

      expect(result.handled).toBe(true);
      expect(setup.getUsedRange).toHaveBeenCalled();
      expect(setup.setSelection).toHaveBeenCalledWith(
        [{ startRow: 0, startCol: 0, endRow: 4, endCol: 3 }],
        { row: 0, col: 0 },
        { row: 0, col: 0 },
      );
    });
  });
});
