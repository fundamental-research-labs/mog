/**
 * Keyboard Selection Matrix Tests
 *
 * Comprehensive parameterized test matrix for arrow-key selection behavior.
 * Tests all combinations of:
 * - 4 directions (up, down, left, right)
 * - 4 modifier combos (none, Shift, Ctrl, Ctrl+Shift)
 * - Multiple starting contexts (single cell, multi-cell range, at sheet edge)
 *
 * This test suite ensures complete coverage of keyboard navigation patterns
 * across all input combinations and edge cases.
 *
 * @see ../keyboard-actions.ts - The actions being tested
 */

import { MAX_COLS, MAX_ROWS } from '@mog-sdk/contracts/core';
import { initialSelectionContext } from '../helpers';
import { keyboardActions } from '../keyboard-actions';
import type { SelectionContext, SelectionEvent } from '../types';

// =============================================================================
// TEST HELPERS
// =============================================================================

/**
 * Call an XState action function for testing.
 * XState actions are wrapped in assign(), so we extract the assignment function.
 */
function callAction(
  actionName: string,
  context: SelectionContext,
  event: SelectionEvent,
): Partial<SelectionContext> {
  const action = (keyboardActions as any)[actionName];
  const result = action.assignment({ context, event, self: null, system: null });
  return result;
}

// =============================================================================
// ARROW KEY MOVE TESTS (no modifier)
// =============================================================================

describe('Arrow key movement (moveActiveCell)', () => {
  describe.each([
    { direction: 'up' as const, rowDelta: -1, colDelta: 0 },
    { direction: 'down' as const, rowDelta: 1, colDelta: 0 },
    { direction: 'left' as const, rowDelta: 0, colDelta: -1 },
    { direction: 'right' as const, rowDelta: 0, colDelta: 1 },
  ])(
    '$direction arrow from single cell',
    ({
      direction,
      rowDelta,
      colDelta,
    }: {
      direction: 'up' | 'down' | 'left' | 'right';
      rowDelta: number;
      colDelta: number;
    }) => {
      it('moves by 1 from B5', () => {
        const context: SelectionContext = {
          ...initialSelectionContext,
          activeCell: { row: 4, col: 1 }, // B5
          pendingRange: { startRow: 4, startCol: 1, endRow: 4, endCol: 1 },
          anchor: null,
        };

        const event: SelectionEvent = {
          type: 'KEY_ARROW',
          direction,
          shiftKey: false,
        };

        const result = callAction('moveActiveCell', context, event);

        expect(result.activeCell).toEqual({
          row: 4 + rowDelta,
          col: 1 + colDelta,
        });
        // pendingRange is always populated (no length-1 assertion needed)
        expect(result.pendingRange).toBeDefined();
        expect(result.pendingRange).toEqual({
          startRow: 4 + rowDelta,
          startCol: 1 + colDelta,
          endRow: 4 + rowDelta,
          endCol: 1 + colDelta,
        });
      });
    },
  );

  describe('Arrow keys collapse multi-cell selection after stepping from active cell', () => {
    it.each([
      {
        direction: 'up' as const,
        expected: { row: 1, col: 2 },
        desc: 'one row up from active cell',
      },
      {
        direction: 'down' as const,
        expected: { row: 3, col: 2 },
        desc: 'one row down from active cell',
      },
      {
        direction: 'left' as const,
        expected: { row: 2, col: 1 },
        desc: 'one column left from active cell',
      },
      {
        direction: 'right' as const,
        expected: { row: 2, col: 3 },
        desc: 'one column right from active cell',
      },
    ])(
      '$direction from A1:E5 (activeCell C3) - $desc',
      ({
        direction,
        expected,
      }: {
        direction: 'up' | 'down' | 'left' | 'right';
        expected: { row: number; col: number };
        desc: string;
      }) => {
        const context: SelectionContext = {
          ...initialSelectionContext,
          activeCell: { row: 2, col: 2 }, // C3 - middle of range
          pendingRange: { startRow: 0, startCol: 0, endRow: 4, endCol: 4 }, // A1:E5
          anchor: { row: 0, col: 0 },
        };

        const event: SelectionEvent = {
          type: 'KEY_ARROW',
          direction,
          shiftKey: false,
        };

        const result = callAction('moveActiveCell', context, event);

        expect(result.activeCell).toEqual(expected);
        // pendingRange is always populated (no length-1 assertion needed)
        expect(result.pendingRange).toBeDefined();
        expect(result.pendingRange).toEqual({
          startRow: expected.row,
          startCol: expected.col,
          endRow: expected.row,
          endCol: expected.col,
        });
      },
    );
  });

  describe('Edge boundary behavior', () => {
    it('arrow up from A1 stays at A1', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 0, col: 0 },
        pendingRange: { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
      };

      const event: SelectionEvent = {
        type: 'KEY_ARROW',
        direction: 'up',
        shiftKey: false,
      };

      const result = callAction('moveActiveCell', context, event);

      expect(result.activeCell).toEqual({ row: 0, col: 0 });
    });

    it('arrow left from A1 stays at A1', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 0, col: 0 },
        pendingRange: { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
      };

      const event: SelectionEvent = {
        type: 'KEY_ARROW',
        direction: 'left',
        shiftKey: false,
      };

      const result = callAction('moveActiveCell', context, event);

      expect(result.activeCell).toEqual({ row: 0, col: 0 });
    });

    it('arrow down from A1 moves to A2', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 0, col: 0 },
        pendingRange: { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
      };

      const event: SelectionEvent = {
        type: 'KEY_ARROW',
        direction: 'down',
        shiftKey: false,
      };

      const result = callAction('moveActiveCell', context, event);

      expect(result.activeCell).toEqual({ row: 1, col: 0 });
    });

    it('arrow right from A1 moves to B1', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 0, col: 0 },
        pendingRange: { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
      };

      const event: SelectionEvent = {
        type: 'KEY_ARROW',
        direction: 'right',
        shiftKey: false,
      };

      const result = callAction('moveActiveCell', context, event);

      expect(result.activeCell).toEqual({ row: 0, col: 1 });
    });
  });
});

// =============================================================================
// SHIFT+ARROW EXTEND TESTS
// =============================================================================

describe('Shift+Arrow selection extension (extendSelection)', () => {
  describe.each([
    {
      direction: 'down' as const,
      firstRange: { startRow: 4, startCol: 1, endRow: 5, endCol: 1 },
      secondRange: { startRow: 4, startCol: 1, endRow: 6, endCol: 1 },
      desc: 'extends downward',
    },
    {
      direction: 'up' as const,
      firstRange: { startRow: 3, startCol: 1, endRow: 4, endCol: 1 },
      secondRange: { startRow: 2, startCol: 1, endRow: 4, endCol: 1 },
      desc: 'extends upward',
    },
    {
      direction: 'right' as const,
      firstRange: { startRow: 4, startCol: 1, endRow: 4, endCol: 2 },
      secondRange: { startRow: 4, startCol: 1, endRow: 4, endCol: 3 },
      desc: 'extends rightward',
    },
    {
      direction: 'left' as const,
      firstRange: { startRow: 4, startCol: 0, endRow: 4, endCol: 1 },
      secondRange: { startRow: 4, startCol: 0, endRow: 4, endCol: 1 },
      desc: 'extends leftward (hits edge at A)',
    },
  ])(
    'Shift+$direction from B5 - $desc',
    ({
      direction,
      firstRange,
      secondRange,
    }: {
      direction: 'up' | 'down' | 'left' | 'right';
      firstRange: { startRow: number; startCol: number; endRow: number; endCol: number };
      secondRange: { startRow: number; startCol: number; endRow: number; endCol: number };
      desc: string;
    }) => {
      it('first Shift+arrow creates range', () => {
        const context: SelectionContext = {
          ...initialSelectionContext,
          activeCell: { row: 4, col: 1 }, // B5
          pendingRange: { startRow: 4, startCol: 1, endRow: 4, endCol: 1 },
          anchor: null,
        };

        const event: SelectionEvent = {
          type: 'KEY_ARROW',
          direction,
          shiftKey: true,
        };

        const result = callAction('extendSelection', context, event);

        expect(result.pendingRange).toEqual(firstRange);
        expect(result.anchor).toEqual({ row: 4, col: 1 });
        expect(result.activeCell).toEqual({ row: 4, col: 1 });
      });

      it('second Shift+arrow extends further', () => {
        const context: SelectionContext = {
          ...initialSelectionContext,
          activeCell: { row: 4, col: 1 },
          pendingRange: firstRange,
          anchor: { row: 4, col: 1 },
        };

        const event: SelectionEvent = {
          type: 'KEY_ARROW',
          direction,
          shiftKey: true,
        };

        const result = callAction('extendSelection', context, event);

        expect(result.pendingRange).toEqual(secondRange);
        expect(result.anchor).toEqual({ row: 4, col: 1 });
        expect(result.activeCell).toEqual({ row: 4, col: 1 });
      });
    },
  );

  describe('Shift+Arrow shrinking behavior (moving edge toward anchor)', () => {
    it('Shift+Up from B5:B6 (anchor B5) shrinks to B5:B5', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 4, col: 1 }, // B5 (anchor)
        pendingRange: { startRow: 4, startCol: 1, endRow: 5, endCol: 1 }, // B5:B6 (extended down)
        anchor: { row: 4, col: 1 },
      };

      const event: SelectionEvent = {
        type: 'KEY_ARROW',
        direction: 'up',
        shiftKey: true,
      };

      const result = callAction('extendSelection', context, event);

      // Moving edge at B6 moves up to B5, shrinking to single cell
      expect(result.pendingRange).toEqual({
        startRow: 4,
        startCol: 1,
        endRow: 4,
        endCol: 1,
      });
      expect(result.activeCell).toEqual({ row: 4, col: 1 });
      expect(result.anchor).toEqual({ row: 4, col: 1 });
    });

    it('Shift+Down from B3:B5 (anchor B5) shrinks to B4:B5', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 4, col: 1 }, // B5 (anchor)
        pendingRange: { startRow: 2, startCol: 1, endRow: 4, endCol: 1 }, // B3:B5 (extended up)
        anchor: { row: 4, col: 1 },
      };

      const event: SelectionEvent = {
        type: 'KEY_ARROW',
        direction: 'down',
        shiftKey: true,
      };

      const result = callAction('extendSelection', context, event);

      // Moving edge at B3 moves down to B4
      expect(result.pendingRange).toEqual({
        startRow: 3,
        startCol: 1,
        endRow: 4,
        endCol: 1,
      });
      expect(result.activeCell).toEqual({ row: 4, col: 1 });
      expect(result.anchor).toEqual({ row: 4, col: 1 });
    });
  });

  describe('Edge boundary behavior', () => {
    it('Shift+Up from A1 stays at A1', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 0, col: 0 },
        pendingRange: { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
        anchor: null,
      };

      const event: SelectionEvent = {
        type: 'KEY_ARROW',
        direction: 'up',
        shiftKey: true,
      };

      const result = callAction('extendSelection', context, event);

      expect(result.pendingRange).toEqual({
        startRow: 0,
        startCol: 0,
        endRow: 0,
        endCol: 0,
      });
    });

    it('Shift+Down from A1 extends to A2', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 0, col: 0 },
        pendingRange: { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
        anchor: null,
      };

      const event: SelectionEvent = {
        type: 'KEY_ARROW',
        direction: 'down',
        shiftKey: true,
      };

      const result = callAction('extendSelection', context, event);

      expect(result.pendingRange).toEqual({
        startRow: 0,
        startCol: 0,
        endRow: 1,
        endCol: 0,
      });
    });
  });
});

// =============================================================================
// CTRL+ARROW JUMP TESTS (fallback implementation)
// =============================================================================

describe('Ctrl+Arrow jump (jumpToEdge)', () => {
  describe.each([
    { direction: 'down' as const, targetRow: 14, targetCol: 1 },
    { direction: 'up' as const, targetRow: 0, targetCol: 1 }, // Clamped to 0
    { direction: 'right' as const, targetRow: 4, targetCol: 11 },
    { direction: 'left' as const, targetRow: 4, targetCol: 0 }, // Clamped to 0
  ])(
    'Ctrl+$direction from B5',
    ({
      direction,
      targetRow,
      targetCol,
    }: {
      direction: 'up' | 'down' | 'left' | 'right';
      targetRow: number;
      targetCol: number;
    }) => {
      it(`jumps to row ${targetRow}, col ${targetCol}`, () => {
        const context: SelectionContext = {
          ...initialSelectionContext,
          activeCell: { row: 4, col: 1 }, // B5
          pendingRange: { startRow: 4, startCol: 1, endRow: 4, endCol: 1 },
        };

        const event: SelectionEvent = {
          type: 'KEY_CTRL_ARROW',
          direction,
          shiftKey: false,
        };

        const result = callAction('jumpToEdge', context, event);

        expect(result.activeCell).toEqual({
          row: targetRow,
          col: targetCol,
        });
        expect(result.pendingRange).toEqual({
          startRow: targetRow,
          startCol: targetCol,
          endRow: targetRow,
          endCol: targetCol,
        });
      });
    },
  );

  describe('Near-edge clamping', () => {
    it('Ctrl+Down from near bottom clamps to MAX_ROWS-1', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: MAX_ROWS - 5, col: 1 },
        pendingRange: { startRow: MAX_ROWS - 5, startCol: 1, endRow: MAX_ROWS - 5, endCol: 1 },
      };

      const event: SelectionEvent = {
        type: 'KEY_CTRL_ARROW',
        direction: 'down',
        shiftKey: false,
      };

      const result = callAction('jumpToEdge', context, event);

      expect(result.activeCell!.row).toBe(MAX_ROWS - 1);
    });

    it('Ctrl+Right from near right edge clamps to MAX_COLS-1', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 4, col: MAX_COLS - 5 },
        pendingRange: { startRow: 4, startCol: MAX_COLS - 5, endRow: 4, endCol: MAX_COLS - 5 },
      };

      const event: SelectionEvent = {
        type: 'KEY_CTRL_ARROW',
        direction: 'right',
        shiftKey: false,
      };

      const result = callAction('jumpToEdge', context, event);

      expect(result.activeCell!.col).toBe(MAX_COLS - 1);
    });
  });
});

// =============================================================================
// CTRL+SHIFT+ARROW EXTEND TESTS (fallback implementation)
// =============================================================================

describe('Ctrl+Shift+Arrow extend (jumpToEdgeExtend)', () => {
  it('Ctrl+Shift+Down from B5 extends by 10', () => {
    const context: SelectionContext = {
      ...initialSelectionContext,
      activeCell: { row: 4, col: 1 }, // B5
      pendingRange: { startRow: 4, startCol: 1, endRow: 4, endCol: 1 },
      anchor: null,
    };

    const event: SelectionEvent = {
      type: 'KEY_CTRL_ARROW',
      direction: 'down',
      shiftKey: true,
    };

    const result = callAction('jumpToEdgeExtend', context, event);

    expect(result.pendingRange).toEqual({
      startRow: 4,
      startCol: 1,
      endRow: 14,
      endCol: 1,
    });
    expect(result.activeCell).toEqual({ row: 4, col: 1 });
    expect(result.anchor).toEqual({ row: 4, col: 1 });
  });

  it('Ctrl+Shift+Up from B15 extends upward by 10', () => {
    const context: SelectionContext = {
      ...initialSelectionContext,
      activeCell: { row: 14, col: 1 }, // B15
      pendingRange: { startRow: 14, startCol: 1, endRow: 14, endCol: 1 },
      anchor: null,
    };

    const event: SelectionEvent = {
      type: 'KEY_CTRL_ARROW',
      direction: 'up',
      shiftKey: true,
    };

    const result = callAction('jumpToEdgeExtend', context, event);

    expect(result.pendingRange).toEqual({
      startRow: 4,
      startCol: 1,
      endRow: 14,
      endCol: 1,
    });
    expect(result.activeCell).toEqual({ row: 14, col: 1 });
    expect(result.anchor).toEqual({ row: 14, col: 1 });
  });

  it('anchor stays put during extend', () => {
    const context: SelectionContext = {
      ...initialSelectionContext,
      activeCell: { row: 4, col: 1 }, // B5 (anchor)
      pendingRange: { startRow: 4, startCol: 1, endRow: 8, endCol: 1 }, // B5:B9
      anchor: { row: 4, col: 1 },
    };

    const event: SelectionEvent = {
      type: 'KEY_CTRL_ARROW',
      direction: 'down',
      shiftKey: true,
    };

    const result = callAction('jumpToEdgeExtend', context, event);

    // Extends from B9 (moving edge) to B19
    expect(result.pendingRange).toEqual({
      startRow: 4,
      startCol: 1,
      endRow: 18,
      endCol: 1,
    });
    expect(result.activeCell).toEqual({ row: 4, col: 1 });
    expect(result.anchor).toEqual({ row: 4, col: 1 });
  });
});

// =============================================================================
// HOME/END KEY TESTS
// =============================================================================

describe('Home/End keys', () => {
  describe('Home key (moveToHome)', () => {
    it('Home goes to column A, same row', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 4, col: 5 }, // F5
        pendingRange: { startRow: 4, startCol: 5, endRow: 4, endCol: 5 },
      };

      const event: SelectionEvent = {
        type: 'KEY_HOME',
        ctrlKey: false,
      };

      const result = callAction('moveToHome', context, event);

      expect(result.activeCell).toEqual({ row: 4, col: 0 }); // A5
    });

    it('Ctrl+Home goes to A1', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 10, col: 10 }, // K11
        pendingRange: { startRow: 10, startCol: 10, endRow: 10, endCol: 10 },
      };

      const event: SelectionEvent = {
        type: 'KEY_HOME',
        ctrlKey: true,
      };

      const result = callAction('moveToHome', context, event);

      expect(result.activeCell).toEqual({ row: 0, col: 0 }); // A1
    });
  });

  describe('Shift+Home (extendToHome)', () => {
    it('Shift+Home extends to column A on moving edge row', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 4, col: 5 }, // F5 (anchor)
        pendingRange: { startRow: 4, startCol: 5, endRow: 4, endCol: 5 },
        anchor: null,
      };

      const event: SelectionEvent = {
        type: 'KEY_HOME',
        ctrlKey: false,
        shiftKey: true,
      };

      const result = callAction('extendToHome', context, event);

      expect(result.pendingRange).toEqual({
        startRow: 4,
        startCol: 0,
        endRow: 4,
        endCol: 5,
      });
      expect(result.activeCell).toEqual({ row: 4, col: 5 });
    });

    it('Ctrl+Shift+Home extends to A1', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 10, col: 10 }, // K11 (anchor)
        pendingRange: { startRow: 10, startCol: 10, endRow: 10, endCol: 10 },
        anchor: null,
      };

      const event: SelectionEvent = {
        type: 'KEY_HOME',
        ctrlKey: true,
        shiftKey: true,
      };

      const result = callAction('extendToHome', context, event);

      expect(result.pendingRange).toEqual({
        startRow: 0,
        startCol: 0,
        endRow: 10,
        endCol: 10,
      });
      expect(result.activeCell).toEqual({ row: 10, col: 10 });
    });

    it('Shift+Home on multi-cell uses moving edge row, not anchor row', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 4, col: 5 }, // F5 (anchor)
        pendingRange: { startRow: 4, startCol: 5, endRow: 6, endCol: 8 }, // F5:I7 (extended down-right)
        anchor: { row: 4, col: 5 },
      };

      const event: SelectionEvent = {
        type: 'KEY_HOME',
        ctrlKey: false,
        shiftKey: true,
      };

      const result = callAction('extendToHome', context, event);

      // Moving edge is at row 6, col 8. Shift+Home moves column to 0 on row 6.
      // New end is (6, 0), range from anchor (4,5) to (6,0) normalizes to (4,0 to 6,5)
      expect(result.pendingRange).toEqual({
        startRow: 4,
        startCol: 0,
        endRow: 6,
        endCol: 5,
      });
      expect(result.activeCell).toEqual({ row: 4, col: 5 });
    });
  });

  describe('End key (moveToEnd)', () => {
    it('End goes to last column, same row', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 4, col: 5 }, // F5
        pendingRange: { startRow: 4, startCol: 5, endRow: 4, endCol: 5 },
      };

      const event: SelectionEvent = {
        type: 'KEY_END',
        ctrlKey: false,
      };

      const result = callAction('moveToEnd', context, event);

      expect(result.activeCell).toEqual({ row: 4, col: MAX_COLS - 1 });
    });

    it('Ctrl+End goes to last cell (MAX bounds fallback)', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 4, col: 5 }, // F5
        pendingRange: { startRow: 4, startCol: 5, endRow: 4, endCol: 5 },
      };

      const event: SelectionEvent = {
        type: 'KEY_END',
        ctrlKey: true,
      };

      const result = callAction('moveToEnd', context, event);

      expect(result.activeCell).toEqual({ row: MAX_ROWS - 1, col: MAX_COLS - 1 });
    });
  });

  describe('Shift+End (extendToEnd)', () => {
    it('Shift+End extends to last column on moving edge row', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 4, col: 5 }, // F5 (anchor)
        pendingRange: { startRow: 4, startCol: 5, endRow: 4, endCol: 5 },
        anchor: null,
      };

      const event: SelectionEvent = {
        type: 'KEY_END',
        ctrlKey: false,
        shiftKey: true,
      };

      const result = callAction('extendToEnd', context, event);

      expect(result.pendingRange).toEqual({
        startRow: 4,
        startCol: 5,
        endRow: 4,
        endCol: MAX_COLS - 1,
      });
      expect(result.activeCell).toEqual({ row: 4, col: 5 });
    });

    it('Ctrl+Shift+End extends to last cell (MAX bounds fallback)', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 4, col: 5 }, // F5 (anchor)
        pendingRange: { startRow: 4, startCol: 5, endRow: 4, endCol: 5 },
        anchor: null,
      };

      const event: SelectionEvent = {
        type: 'KEY_END',
        ctrlKey: true,
        shiftKey: true,
      };

      const result = callAction('extendToEnd', context, event);

      expect(result.pendingRange).toEqual({
        startRow: 4,
        startCol: 5,
        endRow: MAX_ROWS - 1,
        endCol: MAX_COLS - 1,
      });
      expect(result.activeCell).toEqual({ row: 4, col: 5 });
    });

    it('Shift+End on multi-cell uses moving edge row, not anchor row', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 4, col: 5 }, // F5 (anchor)
        pendingRange: { startRow: 4, startCol: 5, endRow: 6, endCol: 8 }, // F5:I7 (extended down-right)
        anchor: { row: 4, col: 5 },
      };

      const event: SelectionEvent = {
        type: 'KEY_END',
        ctrlKey: false,
        shiftKey: true,
      };

      const result = callAction('extendToEnd', context, event);

      // Moving edge is at row 6, col 8. Shift+End extends to MAX_COLS-1 on row 6.
      expect(result.pendingRange).toEqual({
        startRow: 4,
        startCol: 5,
        endRow: 6,
        endCol: MAX_COLS - 1,
      });
      expect(result.activeCell).toEqual({ row: 4, col: 5 });
    });
  });
});

// =============================================================================
// PAGE NAVIGATION TESTS
// =============================================================================

describe('Page Up/Down/Left/Right (page actions)', () => {
  const VISIBLE_ROWS = 20;
  const VISIBLE_COLS = 10;

  describe('Page Up/Down', () => {
    it('Page Down moves down by visibleRows', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 10, col: 5 },
        pendingRange: { startRow: 10, startCol: 5, endRow: 10, endCol: 5 },
      };

      const event: SelectionEvent = {
        type: 'PAGE_DOWN',
        visibleRows: VISIBLE_ROWS,
        shiftKey: false,
      };

      const result = callAction('pageDown', context, event);

      expect(result.activeCell).toEqual({ row: 30, col: 5 });
    });

    it('Page Up moves up by visibleRows', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 30, col: 5 },
        pendingRange: { startRow: 30, startCol: 5, endRow: 30, endCol: 5 },
      };

      const event: SelectionEvent = {
        type: 'PAGE_UP',
        visibleRows: VISIBLE_ROWS,
        shiftKey: false,
      };

      const result = callAction('pageUp', context, event);

      expect(result.activeCell).toEqual({ row: 10, col: 5 });
    });

    it('Page Up from row 10 clamps to row 0', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 10, col: 5 },
        pendingRange: { startRow: 10, startCol: 5, endRow: 10, endCol: 5 },
      };

      const event: SelectionEvent = {
        type: 'PAGE_UP',
        visibleRows: VISIBLE_ROWS,
        shiftKey: false,
      };

      const result = callAction('pageUp', context, event);

      expect(result.activeCell).toEqual({ row: 0, col: 5 });
    });

    it('Page Down from near bottom clamps to MAX_ROWS-1', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: MAX_ROWS - 5, col: 5 },
        pendingRange: { startRow: MAX_ROWS - 5, startCol: 5, endRow: MAX_ROWS - 5, endCol: 5 },
      };

      const event: SelectionEvent = {
        type: 'PAGE_DOWN',
        visibleRows: VISIBLE_ROWS,
        shiftKey: false,
      };

      const result = callAction('pageDown', context, event);

      expect(result.activeCell).toEqual({ row: MAX_ROWS - 1, col: 5 });
    });
  });

  describe('Shift+Page Up/Down extend', () => {
    it('Shift+Page Down extends selection', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 10, col: 5 },
        pendingRange: { startRow: 10, startCol: 5, endRow: 10, endCol: 5 },
        anchor: null,
      };

      const event: SelectionEvent = {
        type: 'PAGE_DOWN',
        visibleRows: VISIBLE_ROWS,
        shiftKey: true,
      };

      const result = callAction('pageDownExtend', context, event);

      expect(result.pendingRange).toEqual({
        startRow: 10,
        startCol: 5,
        endRow: 30,
        endCol: 5,
      });
      expect(result.activeCell).toEqual({ row: 10, col: 5 });
    });

    it('Shift+Page Up extends selection', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 30, col: 5 },
        pendingRange: { startRow: 30, startCol: 5, endRow: 30, endCol: 5 },
        anchor: null,
      };

      const event: SelectionEvent = {
        type: 'PAGE_UP',
        visibleRows: VISIBLE_ROWS,
        shiftKey: true,
      };

      const result = callAction('pageUpExtend', context, event);

      expect(result.pendingRange).toEqual({
        startRow: 10,
        startCol: 5,
        endRow: 30,
        endCol: 5,
      });
      expect(result.activeCell).toEqual({ row: 30, col: 5 });
    });
  });

  describe('Page Left/Right', () => {
    it('Page Right moves right by visibleCols', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 5, col: 10 },
        pendingRange: { startRow: 5, startCol: 10, endRow: 5, endCol: 10 },
      };

      const event: SelectionEvent = {
        type: 'PAGE_RIGHT',
        visibleCols: VISIBLE_COLS,
        shiftKey: false,
      };

      const result = callAction('pageRight', context, event);

      expect(result.activeCell).toEqual({ row: 5, col: 20 });
    });

    it('Page Left moves left by visibleCols', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 5, col: 20 },
        pendingRange: { startRow: 5, startCol: 20, endRow: 5, endCol: 20 },
      };

      const event: SelectionEvent = {
        type: 'PAGE_LEFT',
        visibleCols: VISIBLE_COLS,
        shiftKey: false,
      };

      const result = callAction('pageLeft', context, event);

      expect(result.activeCell).toEqual({ row: 5, col: 10 });
    });

    it('Page Left from col 5 clamps to col 0', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 5, col: 5 },
        pendingRange: { startRow: 5, startCol: 5, endRow: 5, endCol: 5 },
      };

      const event: SelectionEvent = {
        type: 'PAGE_LEFT',
        visibleCols: VISIBLE_COLS,
        shiftKey: false,
      };

      const result = callAction('pageLeft', context, event);

      expect(result.activeCell).toEqual({ row: 5, col: 0 });
    });

    it('Page Right from near right edge clamps to MAX_COLS-1', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 5, col: MAX_COLS - 3 },
        pendingRange: { startRow: 5, startCol: MAX_COLS - 3, endRow: 5, endCol: MAX_COLS - 3 },
      };

      const event: SelectionEvent = {
        type: 'PAGE_RIGHT',
        visibleCols: VISIBLE_COLS,
        shiftKey: false,
      };

      const result = callAction('pageRight', context, event);

      expect(result.activeCell).toEqual({ row: 5, col: MAX_COLS - 1 });
    });
  });

  describe('Shift+Page Left/Right extend', () => {
    it('Shift+Page Right extends selection', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 5, col: 10 },
        pendingRange: { startRow: 5, startCol: 10, endRow: 5, endCol: 10 },
        anchor: null,
      };

      const event: SelectionEvent = {
        type: 'PAGE_RIGHT',
        visibleCols: VISIBLE_COLS,
        shiftKey: true,
      };

      const result = callAction('pageRightExtend', context, event);

      expect(result.pendingRange).toEqual({
        startRow: 5,
        startCol: 10,
        endRow: 5,
        endCol: 20,
      });
      expect(result.activeCell).toEqual({ row: 5, col: 10 });
    });

    it('Shift+Page Left extends selection', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 5, col: 20 },
        pendingRange: { startRow: 5, startCol: 20, endRow: 5, endCol: 20 },
        anchor: null,
      };

      const event: SelectionEvent = {
        type: 'PAGE_LEFT',
        visibleCols: VISIBLE_COLS,
        shiftKey: true,
      };

      const result = callAction('pageLeftExtend', context, event);

      expect(result.pendingRange).toEqual({
        startRow: 5,
        startCol: 10,
        endRow: 5,
        endCol: 20,
      });
      expect(result.activeCell).toEqual({ row: 5, col: 20 });
    });
  });
});
