/**
 * Tests for Shift+Arrow selection extension behavior.
 *
 * Excel parity: the anchor stays put as activeCell while the range edge moves.
 * The moving edge is a property of the range geometry — getMovingEdge(range,
 * anchor) finds it even after normalization — so repeated Shift+Arrow keeps
 * extending past the normalized end of the range without snapping back.
 *
 * @see ../keyboard-actions.ts - extendSelection
 * @see ../helpers.ts - buildExtendUpdate (single source of truth for range geometry)
 */

import { MAX_COLS, MAX_ROWS } from '@mog-sdk/contracts/core';
import { buildExtendUpdate, initialSelectionContext } from '../helpers';
import { keyboardActions } from '../keyboard-actions';
import type { SelectionContext, SelectionEvent } from '../types';

describe('extendSelection - Shift+Arrow bug tests', () => {
  /**
   * Helper to call the extendSelection action.
   * Since it's an XState assign() function, we need to extract the logic.
   */
  function callExtendSelection(
    context: SelectionContext,
    event: SelectionEvent,
  ): Partial<SelectionContext> {
    // The action is wrapped in assign(), so we need to call it with the XState params
    const action = keyboardActions.extendSelection;
    // @ts-expect-error - We're calling the internal function directly for testing
    const result = action.assignment({ context, event, self: null, system: null });
    return result;
  }

  describe('Shift+Up extending selection', () => {
    it('first Shift+Up from B5 extends to B4:B5', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 4, col: 1 }, // B5 (0-indexed: row 4 = Excel row 5)
        pendingRange: { startRow: 4, startCol: 1, endRow: 4, endCol: 1 },
        anchor: null, // No anchor yet - first extend
      };

      const event: SelectionEvent = {
        type: 'KEY_ARROW',
        direction: 'up',
        shiftKey: true,
      };

      const result = callExtendSelection(context, event);

      // Should extend to B4:B5 (row 3 to row 4)
      // pendingRange is always populated (no length-1 assertion needed)
      expect(result.pendingRange).toBeDefined();
      expect(result.pendingRange).toEqual({
        startRow: 3,
        startCol: 1,
        endRow: 4,
        endCol: 1,
      });

      // Anchor should be established at B5
      expect(result.anchor).toEqual({ row: 4, col: 1 });

      expect(result.activeCell).toEqual({ row: 4, col: 1 });
    });

    it('second Shift+Up from B4:B5 extends to B3:B5 (NOT back to B5)', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 4, col: 1 }, // B5 - anchor
        pendingRange: { startRow: 3, startCol: 1, endRow: 4, endCol: 1 }, // B4:B5
        anchor: { row: 4, col: 1 }, // Anchor at B5
      };

      const event: SelectionEvent = {
        type: 'KEY_ARROW',
        direction: 'up',
        shiftKey: true,
      };

      const result = callExtendSelection(context, event);

      // Should extend to B3:B5 (moving edge B4 → B3)
      // pendingRange is always populated (no length-1 assertion needed)
      expect(result.pendingRange).toBeDefined();
      expect(result.pendingRange).toMatchObject({
        startRow: 2,
        startCol: 1,
        endRow: 4,
        endCol: 1,
      });

      // Anchor should remain at B5
      expect(result.anchor).toEqual({ row: 4, col: 1 });

      expect(result.activeCell).toEqual({ row: 4, col: 1 });
    });

    it('third Shift+Up from B3:B5 extends to B2:B5', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 4, col: 1 }, // B5 - anchor
        pendingRange: { startRow: 2, startCol: 1, endRow: 4, endCol: 1 }, // B3:B5
        anchor: { row: 4, col: 1 }, // Anchor at B5
      };

      const event: SelectionEvent = {
        type: 'KEY_ARROW',
        direction: 'up',
        shiftKey: true,
      };

      const result = callExtendSelection(context, event);

      // Should extend to B2:B5 (moving edge B3 → B2)
      // pendingRange is always populated (no length-1 assertion needed)
      expect(result.pendingRange).toBeDefined();
      expect(result.pendingRange).toMatchObject({
        startRow: 1,
        startCol: 1,
        endRow: 4,
        endCol: 1,
      });

      // Anchor should remain at B5
      expect(result.anchor).toEqual({ row: 4, col: 1 });

      expect(result.activeCell).toEqual({ row: 4, col: 1 });
    });

    it('boundary case: Shift+Up at row 0 stays at row 0', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 1, col: 1 }, // B2 - anchor
        pendingRange: { startRow: 0, startCol: 1, endRow: 1, endCol: 1 }, // B1:B2
        anchor: { row: 1, col: 1 }, // Anchor at B2
      };

      const event: SelectionEvent = {
        type: 'KEY_ARROW',
        direction: 'up',
        shiftKey: true,
      };

      const result = callExtendSelection(context, event);

      // Should stay at B1:B2 (can't go above row 0)
      // pendingRange is always populated (no length-1 assertion needed)
      expect(result.pendingRange).toBeDefined();
      expect(result.pendingRange).toEqual({
        startRow: 0, // Already at boundary
        startCol: 1,
        endRow: 1,
        endCol: 1,
      });
    });
  });

  describe('Shift+Down extending selection', () => {
    it('first Shift+Down from B5 extends to B5:B6', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 4, col: 1 }, // B5
        pendingRange: { startRow: 4, startCol: 1, endRow: 4, endCol: 1 },
        anchor: null,
      };

      const event: SelectionEvent = {
        type: 'KEY_ARROW',
        direction: 'down',
        shiftKey: true,
      };

      const result = callExtendSelection(context, event);

      // pendingRange is always populated (no length-1 assertion needed)
      expect(result.pendingRange).toBeDefined();
      expect(result.pendingRange).toEqual({
        startRow: 4,
        startCol: 1,
        endRow: 5, // Extended down
        endCol: 1,
      });

      expect(result.anchor).toEqual({ row: 4, col: 1 });
      expect(result.activeCell).toEqual({ row: 4, col: 1 });
    });

    it('second Shift+Down from B5:B6 extends to B5:B7', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 4, col: 1 }, // B5 - anchor
        pendingRange: { startRow: 4, startCol: 1, endRow: 5, endCol: 1 }, // B5:B6
        anchor: { row: 4, col: 1 },
      };

      const event: SelectionEvent = {
        type: 'KEY_ARROW',
        direction: 'down',
        shiftKey: true,
      };

      const result = callExtendSelection(context, event);

      // pendingRange is always populated (no length-1 assertion needed)
      expect(result.pendingRange).toBeDefined();
      expect(result.pendingRange).toEqual({
        startRow: 4,
        startCol: 1,
        endRow: 6, // Extended down
        endCol: 1,
      });

      expect(result.anchor).toEqual({ row: 4, col: 1 });
      expect(result.activeCell).toEqual({ row: 4, col: 1 });
    });

    it('preserves a full-row selection when extending down from Shift+Space', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 2, col: 0 }, // row 3
        pendingRange: {
          startRow: 2,
          startCol: 0,
          endRow: 2,
          endCol: MAX_COLS - 1,
          isFullRow: true,
        },
        anchor: null,
        anchorRow: 2,
      };

      const event: SelectionEvent = {
        type: 'KEY_ARROW',
        direction: 'down',
        shiftKey: true,
      };

      const result = callExtendSelection(context, event);

      expect(result.pendingRange).toEqual({
        startRow: 2,
        startCol: 0,
        endRow: 3,
        endCol: MAX_COLS - 1,
        isFullRow: true,
      });
      expect(result.anchor).toEqual({ row: 2, col: 0 });
      expect(result.anchorRow).toBe(2);
      expect(result.activeCell).toEqual({ row: 2, col: 0 });
    });

    it('keeps extending the moving row edge for an existing full-row span', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 2, col: 0 },
        pendingRange: {
          startRow: 2,
          startCol: 0,
          endRow: 3,
          endCol: MAX_COLS - 1,
          isFullRow: true,
        },
        anchor: { row: 2, col: 0 },
        anchorRow: 2,
      };

      const event: SelectionEvent = {
        type: 'KEY_ARROW',
        direction: 'down',
        shiftKey: true,
      };

      const result = callExtendSelection(context, event);

      expect(result.pendingRange).toEqual({
        startRow: 2,
        startCol: 0,
        endRow: 4,
        endCol: MAX_COLS - 1,
        isFullRow: true,
      });
      expect(result.anchor).toEqual({ row: 2, col: 0 });
      expect(result.activeCell).toEqual({ row: 2, col: 0 });
    });
  });

  describe('Shift+Left extending selection', () => {
    it('first Shift+Left from B5 extends to A5:B5', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 4, col: 1 }, // B5
        pendingRange: { startRow: 4, startCol: 1, endRow: 4, endCol: 1 },
        anchor: null,
      };

      const event: SelectionEvent = {
        type: 'KEY_ARROW',
        direction: 'left',
        shiftKey: true,
      };

      const result = callExtendSelection(context, event);

      // pendingRange is always populated (no length-1 assertion needed)
      expect(result.pendingRange).toBeDefined();
      expect(result.pendingRange).toEqual({
        startRow: 4,
        startCol: 0, // Extended left
        endRow: 4,
        endCol: 1,
      });

      expect(result.anchor).toEqual({ row: 4, col: 1 });
      expect(result.activeCell).toEqual({ row: 4, col: 1 });
    });

    it('second Shift+Left from A5:B5 stays at A5:B5 (boundary)', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 4, col: 1 }, // B5 - anchor
        pendingRange: { startRow: 4, startCol: 0, endRow: 4, endCol: 1 }, // A5:B5
        anchor: { row: 4, col: 1 },
      };

      const event: SelectionEvent = {
        type: 'KEY_ARROW',
        direction: 'left',
        shiftKey: true,
      };

      const result = callExtendSelection(context, event);

      // pendingRange is always populated (no length-1 assertion needed)
      expect(result.pendingRange).toBeDefined();
      expect(result.pendingRange).toEqual({
        startRow: 4,
        startCol: 0, // Already at boundary
        endRow: 4,
        endCol: 1,
      });
    });
  });

  describe('Shift+Right extending selection', () => {
    it('first Shift+Right from B5 extends to B5:C5', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 4, col: 1 }, // B5
        pendingRange: { startRow: 4, startCol: 1, endRow: 4, endCol: 1 },
        anchor: null,
      };

      const event: SelectionEvent = {
        type: 'KEY_ARROW',
        direction: 'right',
        shiftKey: true,
      };

      const result = callExtendSelection(context, event);

      // pendingRange is always populated (no length-1 assertion needed)
      expect(result.pendingRange).toBeDefined();
      expect(result.pendingRange).toEqual({
        startRow: 4,
        startCol: 1,
        endRow: 4,
        endCol: 2, // Extended right
      });

      expect(result.anchor).toEqual({ row: 4, col: 1 });
      expect(result.activeCell).toEqual({ row: 4, col: 1 });
    });

    it('second Shift+Right from B5:C5 extends to B5:D5', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 4, col: 1 }, // B5 - anchor
        pendingRange: { startRow: 4, startCol: 1, endRow: 4, endCol: 2 }, // B5:C5
        anchor: { row: 4, col: 1 },
      };

      const event: SelectionEvent = {
        type: 'KEY_ARROW',
        direction: 'right',
        shiftKey: true,
      };

      const result = callExtendSelection(context, event);

      // pendingRange is always populated (no length-1 assertion needed)
      expect(result.pendingRange).toBeDefined();
      expect(result.pendingRange).toEqual({
        startRow: 4,
        startCol: 1,
        endRow: 4,
        endCol: 3, // Extended right
      });

      expect(result.anchor).toEqual({ row: 4, col: 1 });
      expect(result.activeCell).toEqual({ row: 4, col: 1 });
    });

    it('first Shift+Right from a hidden single-cell target jumps to the next visible column', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 12, col: 15 }, // P13
        pendingRange: { startRow: 12, startCol: 15, endRow: 12, endCol: 15 },
        anchor: null,
        isColHidden: (col) => col >= 15 && col <= 26, // P:AA
      };

      const event: SelectionEvent = {
        type: 'KEY_ARROW',
        direction: 'right',
        shiftKey: true,
      };

      const result = callExtendSelection(context, event);

      expect(result.pendingRange).toEqual({
        startRow: 12,
        startCol: 15,
        endRow: 12,
        endCol: 27,
      });
      expect(result.anchor).toEqual({ row: 12, col: 15 });
      expect(result.activeCell).toEqual({ row: 12, col: 15 });
    });

    it('Shift+Right moves by visible columns while including hidden column spans', () => {
      let context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 16, col: 12 }, // M17
        pendingRange: { startRow: 16, startCol: 12, endRow: 16, endCol: 12 },
        anchor: null,
        isColHidden: (col) => col >= 15 && col <= 26, // P:AA
      };

      for (let visibleStep = 0; visibleStep < 3; visibleStep += 1) {
        const result = callExtendSelection(context, {
          type: 'KEY_ARROW',
          direction: 'right',
          shiftKey: true,
        });
        context = { ...context, ...result };
      }

      expect(context.pendingRange).toEqual({
        startRow: 16,
        startCol: 12,
        endRow: 16,
        endCol: 27,
      });
      expect(context.anchor).toEqual({ row: 16, col: 12 });
      expect(context.activeCell).toEqual({ row: 16, col: 12 });
    });

    it('Shift+Down moves by visible rows while including hidden row spans', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 1, col: 0 }, // A2
        pendingRange: { startRow: 1, startCol: 0, endRow: 1, endCol: 0 },
        anchor: null,
        isRowHidden: (row) => row >= 2 && row <= 3, // rows 3:4
      };

      const result = callExtendSelection(context, {
        type: 'KEY_ARROW',
        direction: 'down',
        shiftKey: true,
      });

      expect(result.pendingRange).toEqual({
        startRow: 1,
        startCol: 0,
        endRow: 4,
        endCol: 0,
      });
      expect(result.anchor).toEqual({ row: 1, col: 0 });
      expect(result.activeCell).toEqual({ row: 1, col: 0 });
    });

    it('preserves a full-column selection when extending right from Ctrl+Space', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 0, col: 1 }, // column B
        pendingRange: {
          startRow: 0,
          startCol: 1,
          endRow: MAX_ROWS - 1,
          endCol: 1,
          isFullColumn: true,
        },
        anchor: null,
        anchorCol: 1,
      };

      const event: SelectionEvent = {
        type: 'KEY_ARROW',
        direction: 'right',
        shiftKey: true,
      };

      const result = callExtendSelection(context, event);

      expect(result.pendingRange).toEqual({
        startRow: 0,
        startCol: 1,
        endRow: MAX_ROWS - 1,
        endCol: 2,
        isFullColumn: true,
      });
      expect(result.anchor).toEqual({ row: 0, col: 1 });
      expect(result.anchorCol).toBe(1);
      expect(result.activeCell).toEqual({ row: 0, col: 1 });
    });
  });

  describe('Anchor establishment', () => {
    it('first extend establishes anchor from activeCell when anchor is null', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 10, col: 5 }, // F11
        pendingRange: { startRow: 10, startCol: 5, endRow: 10, endCol: 5 },
        anchor: null, // No anchor yet
      };

      const event: SelectionEvent = {
        type: 'KEY_ARROW',
        direction: 'up',
        shiftKey: true,
      };

      const result = callExtendSelection(context, event);

      // Anchor should be established at the original activeCell
      expect(result.anchor).toEqual({ row: 10, col: 5 });
      expect(result.activeCell).toEqual({ row: 10, col: 5 });
    });

    it('subsequent extends use existing anchor', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 10, col: 5 }, // F11 - anchor
        pendingRange: { startRow: 9, startCol: 5, endRow: 10, endCol: 5 }, // F10:F11
        anchor: { row: 10, col: 5 }, // Anchor already set
      };

      const event: SelectionEvent = {
        type: 'KEY_ARROW',
        direction: 'up',
        shiftKey: true,
      };

      const result = callExtendSelection(context, event);

      // Anchor should remain the same
      expect(result.anchor).toEqual({ row: 10, col: 5 });
      expect(result.activeCell).toEqual({ row: 10, col: 5 });
    });
  });

  describe('Direction tracking', () => {
    it('updates direction based on anchor to new end relationship', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 4, col: 1 }, // B5 - anchor
        pendingRange: { startRow: 4, startCol: 1, endRow: 4, endCol: 1 },
        anchor: { row: 4, col: 1 },
        direction: 'down-right', // Initial direction
      };

      const event: SelectionEvent = {
        type: 'KEY_ARROW',
        direction: 'up',
        shiftKey: true,
      };

      const result = callExtendSelection(context, event);

      // Direction should update to reflect extending up
      // anchor is at (4,1), new end is at (3,1)
      // newEnd row (3) < anchor row (4) = up
      // newEnd col (1) = anchor col (1) = neither left nor right, but default is right
      expect(result.direction).toBe('up-right');
    });

    it('direction reflects up-left when extending up and left', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 4, col: 1 }, // B5 - anchor
        pendingRange: { startRow: 3, startCol: 1, endRow: 4, endCol: 1 }, // B4:B5
        anchor: { row: 4, col: 1 },
      };

      const event: SelectionEvent = {
        type: 'KEY_ARROW',
        direction: 'left',
        shiftKey: true,
      };

      const result = callExtendSelection(context, event);

      // BUG: getRangeEndCell returns B5 (4,1), moving left returns to B4:B5 but with left edge at A5
      // Expected: extending left from B4:B5 -> A4:B5
      expect(result.pendingRange).toMatchObject({
        startRow: 3,
        startCol: 0, // Extended left
        endRow: 4,
        endCol: 1,
      });

      // Direction should be up-left (end is above and left of anchor)
      expect(result.direction).toBe('up-left');
    });
  });

  describe('Does not process non-KEY_ARROW events', () => {
    it('returns empty object for KEY_HOME event', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 4, col: 1 },
        pendingRange: { startRow: 4, startCol: 1, endRow: 4, endCol: 1 },
      };

      const event: SelectionEvent = {
        type: 'KEY_HOME',
        ctrlKey: false,
        shiftKey: true,
      };

      const result = callExtendSelection(context, event);

      expect(result).toEqual({});
    });

    it('returns empty object for MOUSE_DOWN event', () => {
      const context: SelectionContext = {
        ...initialSelectionContext,
        activeCell: { row: 4, col: 1 },
        pendingRange: { startRow: 4, startCol: 1, endRow: 4, endCol: 1 },
      };

      const event: SelectionEvent = {
        type: 'MOUSE_DOWN',
        cell: { row: 5, col: 2 },
        shiftKey: false,
        ctrlKey: false,
      };

      const result = callExtendSelection(context, event);

      expect(result).toEqual({});
    });
  });
});

// =============================================================================
// buildExtendUpdate — direct unit tests for the shared helper.
//
// Lowest-layer guard: callers that omit the optional activeCell argument still
// use the moving-edge default. Physical Shift-extension callers pass the
// anchor explicitly; sticky/additive/formula callers may intentionally use an
// edge-active cell.
// =============================================================================

describe('buildExtendUpdate (range geometry helper)', () => {
  it('extend down: activeCell follows the moving edge', () => {
    const anchor = { row: 4, col: 1 }; // B5
    const newEnd = { row: 6, col: 1 }; // B7
    const result = buildExtendUpdate(anchor, newEnd);
    expect(result.activeCell).toEqual(newEnd);
    expect(result.anchor).toEqual(anchor);
    expect(result.pendingRange).toMatchObject({
      startRow: 4,
      startCol: 1,
      endRow: 6,
      endCol: 1,
    });
    expect(result.direction).toBe('down-right');
  });

  it('extend up: activeCell follows the moving edge', () => {
    const anchor = { row: 4, col: 1 }; // B5
    const newEnd = { row: 2, col: 1 }; // B3
    const result = buildExtendUpdate(anchor, newEnd);
    expect(result.activeCell).toEqual(newEnd);
    expect(result.anchor).toEqual(anchor);
    expect(result.direction).toBe('up-right');
  });

  it('extend left: activeCell follows the moving edge', () => {
    const anchor = { row: 4, col: 5 }; // F5
    const newEnd = { row: 4, col: 1 }; // B5
    const result = buildExtendUpdate(anchor, newEnd);
    expect(result.activeCell).toEqual(newEnd);
    expect(result.anchor).toEqual(anchor);
    expect(result.direction).toBe('down-left');
  });

  it('extend right: activeCell follows the moving edge', () => {
    const anchor = { row: 4, col: 1 }; // B5
    const newEnd = { row: 4, col: 5 }; // F5
    const result = buildExtendUpdate(anchor, newEnd);
    expect(result.activeCell).toEqual(newEnd);
    expect(result.anchor).toEqual(anchor);
    expect(result.direction).toBe('down-right');
  });

  it('shrink back to the anchor: activeCell reaches the anchor', () => {
    const anchor = { row: 4, col: 1 }; // B5
    // Currently extended to B5:B7, now shrink so the new end is the anchor itself
    const result = buildExtendUpdate(anchor, anchor);
    expect(result.activeCell).toEqual(anchor);
    expect(result.anchor).toEqual(anchor);
    expect(result.pendingRange).toMatchObject({
      startRow: 4,
      startCol: 1,
      endRow: 4,
      endCol: 1,
    });
    expect(result.direction).toBe('down-right');
  });

  it('extend diagonally up-left: activeCell follows the moving edge', () => {
    const anchor = { row: 5, col: 5 }; // F6
    const newEnd = { row: 2, col: 1 }; // B3
    const result = buildExtendUpdate(anchor, newEnd);
    expect(result.activeCell).toEqual(newEnd);
    expect(result.direction).toBe('up-left');
  });
});
