/**
 * Merged Cell Navigation Tests
 *
 * Tests navigation through merged cells at the selection machine level.
 * This tests the low-level state transitions for arrow keys, extend selection,
 * and special keys (Home/End/Page) when merged cells are present.
 *
 * IMPORTANT: Merge-aware navigation is primarily handled by the coordinator layer,
 * not the selection machine. The machine operates on cell coordinates; the coordinator
 * is responsible for:
 * - Adjusting navigation targets to merge origins
 * - Preventing selection of partial merge regions
 * - Expanding selections to include entire merged regions
 *
 * These tests document EXPECTED machine behavior assuming the coordinator has
 * properly adjusted coordinates. Some tests are marked as .todo to indicate
 * coordinator-level features that need implementation.
 *
 * @see ../keyboard-actions.ts - Arrow key and navigation actions
 * @see ../helpers.ts - initialSelectionContext
 */

import type { CellRange } from '@mog-sdk/contracts/core';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import { initialSelectionContext } from '../helpers';
import { keyboardActions } from '../keyboard-actions';
import type { SelectionContext, SelectionEvent } from '../types';

// =============================================================================
// TEST UTILITIES
// =============================================================================

/**
 * Helper to call an action and get the resulting context updates.
 * XState actions are wrapped in assign(), so we extract the assignment function.
 */
function callAction(
  actionName: keyof typeof keyboardActions,
  context: SelectionContext,
  event: SelectionEvent,
): Partial<SelectionContext> {
  const action = (keyboardActions as any)[actionName];
  const result = action.assignment({ context, event, self: null, system: null });
  return result;
}

/**
 * Helper: Create a CellRange from coordinates.
 */
function range(startRow: number, startCol: number, endRow: number, endCol: number): CellRange {
  return { startRow, startCol, endRow, endCol };
}

/**
 * Helper: Create a CellCoord.
 */
function cell(row: number, col: number): CellCoord {
  return { row, col };
}

/**
 * Helper: Create a test context with custom initial state.
 */
function createContext(overrides: Partial<SelectionContext>): SelectionContext {
  return { ...initialSelectionContext, ...overrides };
}

// =============================================================================
// TESTS: Arrow Keys Through Merged Cells
// =============================================================================

describe('Arrow Keys - Basic Navigation (Machine Level)', () => {
  it('moveActiveCell moves right by one cell (coordinator handles merges)', () => {
    // Scenario: Navigating through a row with merged cells B1:D1
    // At machine level, we just move one cell at a time
    // Coordinator adjusts targets to merge origins if needed

    const context = createContext({
      activeCell: cell(0, 0), // A1
      pendingRange: range(0, 0, 0, 0),
    });

    const result = callAction('moveActiveCell', context, {
      type: 'KEY_ARROW',
      direction: 'right',
      shiftKey: false,
    });

    expect(result.activeCell).toEqual(cell(0, 1)); // B1
    expect(result.pendingRange).toEqual(range(0, 1, 0, 1)); // Single cell at B1
  });

  it('moveActiveCell moves down through rows (machine level)', () => {
    const context = createContext({
      activeCell: cell(0, 0), // A1
      pendingRange: range(0, 0, 0, 0),
    });

    const result = callAction('moveActiveCell', context, {
      type: 'KEY_ARROW',
      direction: 'down',
      shiftKey: false,
    });

    expect(result.activeCell).toEqual(cell(1, 0)); // A2
    expect(result.pendingRange).toEqual(range(1, 0, 1, 0));
  });

  it('moveActiveCell collapses a multi-cell selection after stepping from active cell', () => {
    const context = createContext({
      activeCell: cell(2, 2), // C3
      pendingRange: range(0, 0, 4, 4), // A1:E5
    });

    // Right arrow steps one cell from the active cell and collapses there.
    const result = callAction('moveActiveCell', context, {
      type: 'KEY_ARROW',
      direction: 'right',
      shiftKey: false,
    });

    expect(result.activeCell).toEqual(cell(2, 3)); // D3
    expect(result.pendingRange).toEqual(range(2, 3, 2, 3)); // Single cell at D3
  });
});

// =============================================================================
// TESTS: Extend Selection Through Merged Cells
// =============================================================================

describe('Extend Selection - Shift+Arrow (Machine Level)', () => {
  it('extendSelection extends from anchor by one cell at a time', () => {
    // Start at B5, extend left with Shift+Left.
    // anchor stays put as activeCell while the range edge moves.

    const context = createContext({
      activeCell: cell(4, 1), // B5
      pendingRange: range(4, 1, 4, 1), // Single cell
      anchor: null, // Will be established on first extend
    });

    const result = callAction('extendSelection', context, {
      type: 'KEY_ARROW',
      direction: 'left',
      shiftKey: true,
    });

    // Anchor at B5; the moving edge is A5.
    expect(result.activeCell).toEqual(cell(4, 1)); // B5 (anchor)
    expect(result.anchor).toEqual(cell(4, 1)); // B5
    expect(result.pendingRange).toEqual(range(4, 0, 4, 1)); // A5:B5
  });

  it('extendSelection preserves anchor across multiple extends', () => {
    // Scenario: B5, Shift+Left (→A5:B5), then Shift+Up.
    // The moving edge moves through range geometry while the anchor stays fixed.

    // First extend: B5 → A5
    const context1 = createContext({
      activeCell: cell(4, 1), // B5
      pendingRange: range(4, 1, 4, 1),
      anchor: null,
    });

    const result1 = callAction('extendSelection', context1, {
      type: 'KEY_ARROW',
      direction: 'left',
      shiftKey: true,
    });

    // Second extend: from A5 (moving edge in range) up to A4.
    const context2 = createContext({
      activeCell: result1.activeCell!, // B5 (anchor)
      pendingRange: result1.pendingRange!, // A5:B5
      anchor: result1.anchor!, // B5
    });

    const result2 = callAction('extendSelection', context2, {
      type: 'KEY_ARROW',
      direction: 'up',
      shiftKey: true,
    });

    // Anchor stays at B5 while the moving edge reaches A4.
    expect(result2.activeCell).toEqual(cell(4, 1)); // B5 (anchor)
    expect(result2.anchor).toEqual(cell(4, 1)); // B5
    expect(result2.pendingRange).toEqual(range(3, 0, 4, 1)); // A4:B5
  });

  it('extendSelection uses getMovingEdge to find correct extend point', () => {
    // Rectangular selection preservation: starting from A1:B2 with anchor at A1,
    // Shift+Right extends from B2 (moving edge) to C2.

    const context = createContext({
      activeCell: cell(0, 0), // A1 (anchor)
      pendingRange: range(0, 0, 1, 1), // A1:B2
      anchor: cell(0, 0), // A1
    });

    const result = callAction('extendSelection', context, {
      type: 'KEY_ARROW',
      direction: 'right',
      shiftKey: true,
    });

    // Moving edge moves from B2 to C2 while the anchor stays at A1.
    expect(result.activeCell).toEqual(cell(0, 0)); // A1 (anchor)
    expect(result.pendingRange).toEqual(range(0, 0, 1, 2)); // A1:C2
  });
});

// =============================================================================
// TESTS: Home/End Keys With Merged Cells
// =============================================================================

describe('Home/End Keys - Navigation', () => {
  it('moveToHome goes to column A on current row', () => {
    const context = createContext({
      activeCell: cell(2, 5), // F3
      pendingRange: range(2, 5, 2, 5),
    });

    const result = callAction('moveToHome', context, {
      type: 'KEY_HOME',
      ctrlKey: false,
      shiftKey: false,
    });

    expect(result.activeCell).toEqual(cell(2, 0)); // A3
    expect(result.pendingRange).toEqual(range(2, 0, 2, 0));
  });

  it('moveToHome with Ctrl goes to A1', () => {
    const context = createContext({
      activeCell: cell(10, 10), // K11
      pendingRange: range(10, 10, 10, 10),
    });

    const result = callAction('moveToHome', context, {
      type: 'KEY_HOME',
      ctrlKey: true,
      shiftKey: false,
    });

    expect(result.activeCell).toEqual(cell(0, 0)); // A1
    expect(result.pendingRange).toEqual(range(0, 0, 0, 0));
  });

  it('extendToHome extends to column A on moving edge row', () => {
    // Uses moving edge row, not anchor row.
    // Starting at C3, after extend up to C1, Home extends to A1:C3.
    // activeCell remains anchored at C3 while followCell can track A1.

    const context = createContext({
      activeCell: cell(2, 2), // C3 (anchor)
      pendingRange: range(0, 2, 2, 2), // C1:C3
      anchor: cell(2, 2), // C3
    });

    const result = callAction('extendToHome', context, {
      type: 'KEY_HOME',
      ctrlKey: false,
      shiftKey: true,
    });

    // Moving edge is C1 (row 0), so Home extends to A1 in range geometry.
    expect(result.activeCell).toEqual(cell(2, 2)); // C3 (anchor)
    expect(result.pendingRange).toEqual(range(0, 0, 2, 2)); // A1:C3
  });

  it('moveToEnd goes to last column (MAX_COLS-1) on current row', () => {
    const context = createContext({
      activeCell: cell(2, 5), // F3
      pendingRange: range(2, 5, 2, 5),
    });

    const result = callAction('moveToEnd', context, {
      type: 'KEY_END',
      ctrlKey: false,
      shiftKey: false,
    });

    // MAX_COLS = 16384, so MAX_COLS-1 = 16383 (column XFD)
    expect(result.activeCell).toEqual(cell(2, 16383)); // XFD3
  });
});

// =============================================================================
// TESTS: Page Navigation With Merged Cells
// =============================================================================

describe('Page Navigation - With Merged Cells', () => {
  it('pageDown moves by visibleRows', () => {
    const context = createContext({
      activeCell: cell(5, 3), // D6
      pendingRange: range(5, 3, 5, 3),
    });

    const result = callAction('pageDown', context, {
      type: 'PAGE_DOWN',
      visibleRows: 10,
      shiftKey: false,
    });

    // Should move down by 10 visible rows
    expect(result.activeCell).toEqual(cell(15, 3)); // D16
    expect(result.pendingRange).toEqual(range(15, 3, 15, 3));
  });

  it('pageUp respects sheet bounds (does not go negative)', () => {
    const context = createContext({
      activeCell: cell(2, 3), // D3
      pendingRange: range(2, 3, 2, 3),
    });

    const result = callAction('pageUp', context, {
      type: 'PAGE_UP',
      visibleRows: 10,
      shiftKey: false,
    });

    // Should move up 10 rows, but clamp to row 0
    expect(result.activeCell).toEqual(cell(0, 3)); // D1
    expect(result.pendingRange).toEqual(range(0, 3, 0, 3));
  });

  it('pageDownExtend preserves activeCell at the anchor while moving range edge by page size', () => {
    const context = createContext({
      activeCell: cell(5, 3), // D6
      pendingRange: range(5, 3, 5, 3),
      anchor: cell(5, 3),
    });

    const result = callAction('pageDownExtend', context, {
      type: 'PAGE_DOWN',
      visibleRows: 10,
      shiftKey: true,
    });

    // Anchor stays at D6; range geometry and viewport-follow track D16.
    expect(result.activeCell).toEqual(cell(5, 3)); // D6 (anchor)
    expect(result.pendingRange).toEqual(range(5, 3, 15, 3)); // D6:D16
  });

  // TODO: This test documents expected behavior when coordinator handles merged cells
  it.todo('page navigation with large merged cell in path (coordinator handles merge boundaries)');
});

// =============================================================================
// TESTS: Tab/Enter Navigation (Machine Level)
// =============================================================================

describe('Tab/Enter Navigation - Machine Fallback', () => {
  it('moveTab moves right by default', () => {
    const context = createContext({
      activeCell: cell(2, 3), // D3
      pendingRange: range(2, 3, 2, 3),
    });

    const result = callAction('moveTab', context, {
      type: 'KEY_TAB',
      shiftKey: false,
    });

    expect(result.activeCell).toEqual(cell(2, 4)); // E3
    expect(result.pendingRange).toEqual(range(2, 4, 2, 4));
  });

  it('moveTab with shift moves left', () => {
    const context = createContext({
      activeCell: cell(2, 3), // D3
      pendingRange: range(2, 3, 2, 3),
    });

    const result = callAction('moveTab', context, {
      type: 'KEY_TAB',
      shiftKey: true,
    });

    expect(result.activeCell).toEqual(cell(2, 2)); // C3
  });

  it('moveEnter moves down by default', () => {
    const context = createContext({
      activeCell: cell(2, 3), // D3
      pendingRange: range(2, 3, 2, 3),
    });

    const result = callAction('moveEnter', context, {
      type: 'KEY_ENTER',
      shiftKey: false,
    });

    expect(result.activeCell).toEqual(cell(3, 3)); // D4
    expect(result.pendingRange).toEqual(range(3, 3, 3, 3));
  });

  it('moveEnter with shift moves up', () => {
    const context = createContext({
      activeCell: cell(2, 3), // D3
      pendingRange: range(2, 3, 2, 3),
    });

    const result = callAction('moveEnter', context, {
      type: 'KEY_ENTER',
      shiftKey: true,
    });

    expect(result.activeCell).toEqual(cell(1, 3)); // D2
  });

  // NOTE: Multi-cell Tab/Enter cycling is handled by action handlers (TAB_FORWARD, etc.)
  // not by machine actions. See tab-enter-matrix.test.ts for comprehensive cycling tests.
});

// =============================================================================
// TESTS: Hidden Cell Navigation
// =============================================================================

describe('Hidden Cell Skipping - Machine Level', () => {
  it('moveActiveCell skips hidden rows when isRowHidden is provided', () => {
    const isRowHidden = (row: number) => row === 1; // Row 2 is hidden

    const context = createContext({
      activeCell: cell(0, 0), // A1
      pendingRange: range(0, 0, 0, 0),
      isRowHidden,
    });

    const result = callAction('moveActiveCell', context, {
      type: 'KEY_ARROW',
      direction: 'down',
      shiftKey: false,
    });

    // Should skip row 1 (hidden), go to row 2
    expect(result.activeCell).toEqual(cell(2, 0)); // A3
  });

  it('moveActiveCell skips hidden columns when isColHidden is provided', () => {
    const isColHidden = (col: number) => col === 1; // Column B is hidden

    const context = createContext({
      activeCell: cell(0, 0), // A1
      pendingRange: range(0, 0, 0, 0),
      isColHidden,
    });

    const result = callAction('moveActiveCell', context, {
      type: 'KEY_ARROW',
      direction: 'right',
      shiftKey: false,
    });

    // Should skip col 1 (hidden), go to col 2
    expect(result.activeCell).toEqual(cell(0, 2)); // C1
  });

  it('vertical movement in a hidden column advances by row', () => {
    const isColHidden = (col: number) => col === 26; // AA is hidden/grouped

    const context = createContext({
      activeCell: cell(12, 26), // AA13
      pendingRange: range(12, 26, 12, 26),
      isColHidden,
    });

    const result = callAction('moveEnter', context, {
      type: 'KEY_ENTER',
      shiftKey: false,
    });

    expect(result.activeCell).toEqual(cell(13, 26)); // AA14
  });

  it('horizontal movement in a hidden row advances by column', () => {
    const isRowHidden = (row: number) => row === 12; // Row 13 is hidden/grouped

    const context = createContext({
      activeCell: cell(12, 26), // AA13
      pendingRange: range(12, 26, 12, 26),
      isRowHidden,
    });

    const result = callAction('moveTab', context, {
      type: 'KEY_TAB',
      shiftKey: false,
    });

    expect(result.activeCell).toEqual(cell(12, 27)); // AB13
  });

  it('extendSelection moves to the next visible edge while including hidden rows', () => {
    const isRowHidden = (row: number) => row === 2; // Row 3 is hidden

    const context = createContext({
      activeCell: cell(1, 0), // A2
      pendingRange: range(1, 0, 1, 0),
      anchor: null,
      isRowHidden,
    });

    const result = callAction('extendSelection', context, {
      type: 'KEY_ARROW',
      direction: 'down',
      shiftKey: true,
    });

    // Shift+Arrow moves the edge to the next visible row while the hidden row
    // remains inside the selected rectangle.
    expect(result.anchor).toEqual(cell(1, 0)); // A2 (anchor)
    expect(result.pendingRange).toEqual(range(1, 0, 3, 0)); // A2:A4
  });
});

// =============================================================================
// TESTS: Direct Navigation (Go To)
// =============================================================================

describe('Go To - Direct Cell Navigation', () => {
  it('goToCell navigates to specified cell', () => {
    const context = createContext({
      activeCell: cell(0, 0), // A1
      pendingRange: range(0, 0, 0, 0),
    });

    const result = callAction('goToCell', context, {
      type: 'GO_TO',
      cell: cell(10, 5), // F11
    });

    expect(result.activeCell).toEqual(cell(10, 5));
    expect(result.pendingRange).toEqual(range(10, 5, 10, 5));
  });

  it('goToCell clamps to valid sheet bounds', () => {
    const context = createContext({
      activeCell: cell(0, 0),
      pendingRange: range(0, 0, 0, 0),
    });

    // Try to navigate beyond sheet bounds
    const result = callAction('goToCell', context, {
      type: 'GO_TO',
      cell: cell(2000000, 20000), // Way beyond MAX_ROWS/MAX_COLS
    });

    // Should clamp to MAX_ROWS-1 and MAX_COLS-1
    expect(result.activeCell).toEqual(cell(1048575, 16383));
  });

  // TODO: Coordinator should adjust go-to targets to merge origins
  it.todo('goToCell with merge target (coordinator adjusts to merge origin)');
});

// =============================================================================
// TESTS: Select All
// =============================================================================

describe('Select All', () => {
  it('selectAll selects entire sheet range', () => {
    const context = createContext({
      activeCell: cell(10, 10),
      pendingRange: range(10, 10, 10, 10),
    });

    const result = callAction('selectAll', context, {
      type: 'SELECT_ALL',
    });

    // Selects from A1 to MAX_ROWS-1, MAX_COLS-1
    expect(result.activeCell).toEqual(cell(10, 10));
    expect(result.anchor).toEqual(cell(10, 10));
    expect(result.pendingRange).toEqual({
      startRow: 0,
      startCol: 0,
      endRow: 1048575, // MAX_ROWS - 1
      endCol: 16383, // MAX_COLS - 1
      isFullRow: true,
      isFullColumn: true,
    });
    expect(result.committedRanges).toEqual([]);
  });

  // NOTE: Progressive Ctrl+A (current region → all → objects) is handled by
  // action handlers (SELECT_CURRENT_REGION), not by machine actions.
});

// =============================================================================
// TESTS: Edge Cases and Boundary Conditions
// =============================================================================

describe('Edge Cases', () => {
  it('arrow keys at sheet boundaries do not wrap', () => {
    const context = createContext({
      activeCell: cell(0, 0), // A1
      pendingRange: range(0, 0, 0, 0),
    });

    // Try to move up from A1
    const result = callAction('moveActiveCell', context, {
      type: 'KEY_ARROW',
      direction: 'up',
      shiftKey: false,
    });

    // Should stay at A1 (clamped to row 0)
    expect(result.activeCell).toEqual(cell(0, 0));
  });

  it('extend selection at boundaries clamps correctly', () => {
    const context = createContext({
      activeCell: cell(0, 0), // A1
      pendingRange: range(0, 0, 0, 0),
      anchor: cell(0, 0),
    });

    // Try to extend up from A1
    const result = callAction('extendSelection', context, {
      type: 'KEY_ARROW',
      direction: 'up',
      shiftKey: true,
    });

    // Should stay at A1 (clamped to row 0)
    expect(result.pendingRange).toEqual(range(0, 0, 0, 0));
  });

  it('handles direction computation for diagonal selections', () => {
    // Start at B2, extend to D4 (down-right)
    const context = createContext({
      activeCell: cell(1, 1), // B2
      pendingRange: range(1, 1, 1, 1),
      anchor: null,
    });

    const result1 = callAction('extendSelection', context, {
      type: 'KEY_ARROW',
      direction: 'right',
      shiftKey: true,
    });

    // Direction should be right from anchor B2
    expect(result1.direction).toBeDefined();

    const result2 = callAction(
      'extendSelection',
      { ...context, ...result1 },
      {
        type: 'KEY_ARROW',
        direction: 'down',
        shiftKey: true,
      },
    );

    // Direction should now be down-right
    expect(result2.direction).toBeDefined();
  });
});
