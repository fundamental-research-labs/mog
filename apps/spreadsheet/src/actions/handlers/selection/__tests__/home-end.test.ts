import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import type { CellRange } from '@mog-sdk/contracts/core';

import { EXTEND_TO_A1 } from '../home-end';
import type { CellCoord } from '../helpers';

function makeDeps(options: {
  activeCell: CellCoord;
  ranges: CellRange[];
  anchor: CellCoord | null;
}) {
  const setSelection = jest.fn();
  const keyHome = jest.fn();

  const deps = {
    accessors: {
      selection: {
        getActiveCell: () => options.activeCell,
        getRanges: () => options.ranges,
        getAnchor: () => options.anchor,
      },
    },
    commands: {
      selection: {
        setSelection,
        keyHome,
      },
    },
  } as unknown as ActionDependencies;

  return { deps, setSelection, keyHome };
}

describe('Home/End selection handlers', () => {
  describe('EXTEND_TO_A1', () => {
    it('extends from the current anchor and makes A1 the active endpoint', () => {
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
        { row: 0, col: 0 },
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
        { row: 0, col: 0 },
        { row: 10, col: 10 },
      );
    });
  });
});
