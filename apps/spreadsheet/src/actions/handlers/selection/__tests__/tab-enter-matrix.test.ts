/**
 * Tab/Enter Cycling Matrix Tests
 *
 * Tests Tab/Enter cycling within selections:
 * - Basic cycling (row-major for Tab, column-major for Enter)
 * - Hidden row/column skipping (Bug 2b)
 * - Merged cell deduplication (Bug 2c)
 * - Wrapping behavior at selection boundaries
 * - Single cell fallback
 *
 * Test layer (tab parity):
 * Previously, this file drove `TAB_FORWARD` / `TAB_BACKWARD` /
 * `ENTER_NAVIGATE` / `SHIFT_ENTER_NAVIGATE` action handlers directly through
 * `getNextCellInSelection` + `buildCyclingOptions`. The cycle
 * algorithm lives inside the selection machine
 * (`machines/selection/cycle.ts`), called from KEY_TAB / KEY_ENTER. To preserve
 * the user-flow harness without rewriting every case, this file now drives
 * `commands.selection.keyTab(shift)` / `commands.selection.keyEnter(shift)`
 * — i.e., it sends KEY_TAB / KEY_ENTER into a real selection actor and reads
 * the resulting context — while preserving the existing assertions.
 *
 * Layout-predicate callbacks (`isRowHidden`, `isColHidden`,
 * `getMergedRegionAt`) are pushed into the actor via the same
 * `setLayoutCallbacks` command that production wires through
 * `GridEditingSystem.refreshLayoutCallbacks()`.
 *
 * @see ../tab-enter.ts - The original handler-side functions (still in use
 * via the action-handler dispatch path; this file no longer exercises them).
 * @see ../../../../systems/grid-editing/machines/selection/cycle.ts - New cycle home.
 * @see ../../../../systems/grid-editing/machines/selection/__tests__/cycle.test.ts
 * - Machine-layer pin for the cycle algorithm at the layer it now lives in.
 */

import { createActor } from 'xstate';

import type { CellRange } from '@mog-sdk/contracts/core';
import type { CellCoord } from '@mog-sdk/contracts/rendering';

import { selectionMachine } from '../../../../systems/grid-editing/machines/grid-selection-machine';
import { selectionSelectors } from '../../../../selectors';

// =============================================================================
// USER-FLOW HARNESS
// =============================================================================

/**
 * Build a selection actor primed with `activeCell` + `ranges` and the
 * specified layout-predicate callbacks. Returns a `runTab` / `runEnter`
 * helper that mirrors the previous handler-call signature, returning a
 * `{ ranges, activeCell }` pair (the same shape the old `getSetSelection()`
 * returned).
 */
function setupActor(setup: {
  activeCell: CellCoord;
  ranges: CellRange[];
  isRowHidden?: (row: number) => boolean;
  isColHidden?: (col: number) => boolean;
  merges?: Map<string, CellRange>;
}) {
  const actor = createActor(selectionMachine);
  actor.start();

  // Build a viewport-merge accessor mirroring `ws.viewport.getMerges()`
  // semantics: any (row, col) inside a merge resolves to the merge bounds.
  const getMergedRegionAt = setup.merges
    ? (row: number, col: number): CellRange | null => {
        return setup.merges?.get(`${row},${col}`) ?? null;
      }
    : undefined;

  actor.send({
    type: 'SET_LAYOUT_CALLBACKS',
    isRowHidden: setup.isRowHidden,
    isColHidden: setup.isColHidden,
    getMergedRegionAt,
  });

  // Plant the initial state. SET_SELECTION with default `source: 'user'`
  // preserves modes — but we never set any mode in these tests, so the
  // active cell + ranges land cleanly. `committedRanges` is empty for
  // single-range payloads (handled by the source-aware `setSelection`
  // assign).
  actor.send({
    type: 'SET_SELECTION',
    ranges: setup.ranges,
    activeCell: setup.activeCell,
  });

  const snapshot = () => {
    const snap = actor.getSnapshot();
    return {
      activeCell: snap.context.activeCell,
      ranges: selectionSelectors.ranges(snap),
    };
  };

  return {
    runTab: (shiftKey: boolean) => {
      actor.send({ type: 'KEY_TAB', shiftKey });
      return snapshot();
    },
    runEnter: (shiftKey: boolean) => {
      actor.send({ type: 'KEY_ENTER', shiftKey });
      return snapshot();
    },
    snapshot,
    stop: () => actor.stop(),
  };
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

// =============================================================================
// TESTS: Basic Tab Cycling (Row-Major)
// =============================================================================

describe('Tab Forward - Row-Major Cycling', () => {
  it('cycles through A1:C3 in row-major order (left-to-right, top-to-bottom)', () => {
    // A1:C3 = 9 cells in row-major order:
    // A1→B1→C1→A2→B2→C2→A3→B3→C3→(wrap to A1)

    const testRange = range(0, 0, 2, 2); // A1:C3

    // A1 → B1
    const a1 = setupActor({ activeCell: cell(0, 0), ranges: [testRange] });
    expect(a1.runTab(false)).toEqual({ ranges: [testRange], activeCell: cell(0, 1) });
    a1.stop();

    // B1 → C1
    const b1 = setupActor({ activeCell: cell(0, 1), ranges: [testRange] });
    expect(b1.runTab(false)).toEqual({ ranges: [testRange], activeCell: cell(0, 2) });
    b1.stop();

    // C1 → A2 (wrap to next row)
    const c1 = setupActor({ activeCell: cell(0, 2), ranges: [testRange] });
    expect(c1.runTab(false)).toEqual({ ranges: [testRange], activeCell: cell(1, 0) });
    c1.stop();

    // B2 → C2
    const b2 = setupActor({ activeCell: cell(1, 1), ranges: [testRange] });
    expect(b2.runTab(false)).toEqual({ ranges: [testRange], activeCell: cell(1, 2) });
    b2.stop();

    // C3 → A1 (wrap to beginning)
    const c3 = setupActor({ activeCell: cell(2, 2), ranges: [testRange] });
    expect(c3.runTab(false)).toEqual({ ranges: [testRange], activeCell: cell(0, 0) });
    c3.stop();
  });

  it('handles single cell selection by free movement (no cycle)', () => {
    // Single-cell selections fall through to free-movement Tab (right by one).
    // The old handler explicitly
    // dispatched a `keyTab(false)` call after detecting `ranges.length === 1`
    // and 1×1; the same observable result emerges from the machine path.
    const a = setupActor({
      activeCell: cell(0, 0),
      ranges: [range(0, 0, 0, 0)], // Single cell
    });
    const after = a.runTab(false);
    // The old path dispatched keyTab instead of setSelection; the machine path
    // reaches the same observable behavior: Tab moves right by one cell when
    // the selection is a single cell.
    expect(after.activeCell).toEqual(cell(0, 1));
    a.stop();
  });
});

describe('Tab Backward - Row-Major Reverse', () => {
  it('cycles backward through A1:C3 (reverse row-major order)', () => {
    const testRange = range(0, 0, 2, 2); // A1:C3

    // A1 → C3 (wrap backward to end)
    const a1 = setupActor({ activeCell: cell(0, 0), ranges: [testRange] });
    expect(a1.runTab(true)).toEqual({ ranges: [testRange], activeCell: cell(2, 2) });
    a1.stop();

    // B1 → A1
    const b1 = setupActor({ activeCell: cell(0, 1), ranges: [testRange] });
    expect(b1.runTab(true)).toEqual({ ranges: [testRange], activeCell: cell(0, 0) });
    b1.stop();

    // A2 → C1 (wrap backward to previous row)
    const a2 = setupActor({ activeCell: cell(1, 0), ranges: [testRange] });
    expect(a2.runTab(true)).toEqual({ ranges: [testRange], activeCell: cell(0, 2) });
    a2.stop();
  });

  it('handles single cell selection by free movement (Shift+Tab)', () => {
    // Single-cell Shift+Tab: free movement, left by one. Active cell is at
    // A1 (0, 0); Shift+Tab clamps at column 0, so the cell stays in place
    // (matching `moveCell`'s `Math.max(0, ...)` clamp).
    const a = setupActor({ activeCell: cell(0, 0), ranges: [range(0, 0, 0, 0)] });
    const after = a.runTab(true);
    expect(after.activeCell).toEqual(cell(0, 0)); // clamped at column 0
    a.stop();
  });
});

// =============================================================================
// TESTS: Basic Enter Cycling (Column-Major)
// =============================================================================

describe('Enter Navigate - Column-Major Cycling', () => {
  it('cycles through A1:C3 in column-major order (top-to-bottom, left-to-right)', () => {
    // A1:C3 = 9 cells in column-major order:
    // A1→A2→A3→B1→B2→B3→C1→C2→C3→(wrap to A1)

    const testRange = range(0, 0, 2, 2); // A1:C3

    // A1 → A2
    const a1 = setupActor({ activeCell: cell(0, 0), ranges: [testRange] });
    expect(a1.runEnter(false)).toEqual({ ranges: [testRange], activeCell: cell(1, 0) });
    a1.stop();

    // A2 → A3
    const a2 = setupActor({ activeCell: cell(1, 0), ranges: [testRange] });
    expect(a2.runEnter(false)).toEqual({ ranges: [testRange], activeCell: cell(2, 0) });
    a2.stop();

    // A3 → B1 (wrap to next column)
    const a3 = setupActor({ activeCell: cell(2, 0), ranges: [testRange] });
    expect(a3.runEnter(false)).toEqual({ ranges: [testRange], activeCell: cell(0, 1) });
    a3.stop();

    // C3 → A1 (wrap to beginning)
    const c3 = setupActor({ activeCell: cell(2, 2), ranges: [testRange] });
    expect(c3.runEnter(false)).toEqual({ ranges: [testRange], activeCell: cell(0, 0) });
    c3.stop();
  });

  it('handles single cell selection by free movement (Enter moves down)', () => {
    // Single-cell Enter: free movement, down by one. Active cell A1 → A2.
    const a = setupActor({ activeCell: cell(0, 0), ranges: [range(0, 0, 0, 0)] });
    expect(a.runEnter(false).activeCell).toEqual(cell(1, 0));
    a.stop();
  });
});

describe('Shift+Enter Navigate - Column-Major Reverse', () => {
  it('cycles backward through A1:C3 (reverse column-major order)', () => {
    const testRange = range(0, 0, 2, 2); // A1:C3

    // A1 → C3 (wrap backward to end)
    const a1 = setupActor({ activeCell: cell(0, 0), ranges: [testRange] });
    expect(a1.runEnter(true)).toEqual({ ranges: [testRange], activeCell: cell(2, 2) });
    a1.stop();

    // A2 → A1
    const a2 = setupActor({ activeCell: cell(1, 0), ranges: [testRange] });
    expect(a2.runEnter(true)).toEqual({ ranges: [testRange], activeCell: cell(0, 0) });
    a2.stop();

    // B1 → A3 (wrap backward to previous column)
    const b1 = setupActor({ activeCell: cell(0, 1), ranges: [testRange] });
    expect(b1.runEnter(true)).toEqual({ ranges: [testRange], activeCell: cell(2, 0) });
    b1.stop();
  });

  it('handles single cell selection by free movement (Shift+Enter moves up)', () => {
    // Single-cell Shift+Enter: free movement up; clamped at row 0 → stay at A1.
    const a = setupActor({ activeCell: cell(0, 0), ranges: [range(0, 0, 0, 0)] });
    expect(a.runEnter(true).activeCell).toEqual(cell(0, 0));
    a.stop();
  });
});

// =============================================================================
// TESTS: Hidden Row Skipping (Bug 2b)
// =============================================================================

describe('Hidden Row Skipping - Bug 2b', () => {
  it('Tab skips hidden row 2 in A1:C5 selection', () => {
    const testRange = range(0, 0, 4, 2); // A1:C5

    // Mock row 2 as hidden
    const isRowHidden = (row: number) => row === 2;

    // Tab from C1 should skip entire row 2, jump to A2 (next visible row)
    const c1 = setupActor({
      activeCell: cell(0, 2), // C1
      ranges: [testRange],
      isRowHidden,
    });
    expect(c1.runTab(false)).toEqual({ ranges: [testRange], activeCell: cell(1, 0) });
    c1.stop();

    // Tab from C2 should skip row 2 entirely, go to A4 (row index 3)
    const c2 = setupActor({
      activeCell: cell(1, 2), // C2 (row index 1)
      ranges: [testRange],
      isRowHidden,
    });
    expect(c2.runTab(false)).toEqual({ ranges: [testRange], activeCell: cell(3, 0) }); // A4
  });

  it('Enter skips hidden rows in column-major order', () => {
    const testRange = range(0, 0, 4, 2); // A1:C5

    // Mock rows 1 and 3 as hidden
    const isRowHidden = (row: number) => row === 1 || row === 3;

    // Enter from A1 should skip row 1, go to A3
    const a1 = setupActor({
      activeCell: cell(0, 0), // A1
      ranges: [testRange],
      isRowHidden,
    });
    expect(a1.runEnter(false)).toEqual({ ranges: [testRange], activeCell: cell(2, 0) }); // A3
    a1.stop();

    // Enter from A3 should skip row 3, go to A5
    const a3 = setupActor({
      activeCell: cell(2, 0), // A3
      ranges: [testRange],
      isRowHidden,
    });
    expect(a3.runEnter(false)).toEqual({ ranges: [testRange], activeCell: cell(4, 0) }); // A5
    a3.stop();
  });
});

// =============================================================================
// TESTS: Hidden Column Skipping (Bug 2b)
// =============================================================================

describe('Hidden Column Skipping - Bug 2b', () => {
  it('Tab skips hidden column C (col 2) in A1:E3 selection', () => {
    const testRange = range(0, 0, 2, 4); // A1:E3

    // Mock column C (index 2) as hidden
    const isColHidden = (col: number) => col === 2;

    // Tab from B1 should skip column C, go to D1
    const b1 = setupActor({
      activeCell: cell(0, 1), // B1
      ranges: [testRange],
      isColHidden,
    });
    expect(b1.runTab(false)).toEqual({ ranges: [testRange], activeCell: cell(0, 3) }); // D1
    b1.stop();

    // Tab from D1 → E1
    const d1 = setupActor({
      activeCell: cell(0, 3), // D1
      ranges: [testRange],
      isColHidden,
    });
    expect(d1.runTab(false)).toEqual({ ranges: [testRange], activeCell: cell(0, 4) }); // E1
    d1.stop();
  });

  it('Enter skips hidden columns when wrapping to next column', () => {
    const testRange = range(0, 0, 2, 4); // A1:E3

    // Mock columns B and D (indices 1 and 3) as hidden
    const isColHidden = (col: number) => col === 1 || col === 3;

    // Enter from A3 should skip column B, go to C1
    const a3 = setupActor({
      activeCell: cell(2, 0), // A3
      ranges: [testRange],
      isColHidden,
    });
    expect(a3.runEnter(false)).toEqual({ ranges: [testRange], activeCell: cell(0, 2) }); // C1
    a3.stop();

    // Enter from C3 should skip column D, go to E1
    const c3 = setupActor({
      activeCell: cell(2, 2), // C3
      ranges: [testRange],
      isColHidden,
    });
    expect(c3.runEnter(false)).toEqual({ ranges: [testRange], activeCell: cell(0, 4) }); // E1
    c3.stop();
  });
});

// =============================================================================
// TESTS: Merged Cell Deduplication (Bug 2c)
// =============================================================================

describe('Merged Cell Deduplication - Bug 2c', () => {
  it('Tab treats merged region B2:D4 as single stop at B2', () => {
    const testRange = range(0, 0, 4, 4); // A1:E5

    // Mock merge B2:D4 (rows 1-3, cols 1-3)
    const mergeRegion = range(1, 1, 3, 3);
    const merges = new Map<string, CellRange>();
    for (let row = 1; row <= 3; row++) {
      for (let col = 1; col <= 3; col++) {
        merges.set(`${row},${col}`, mergeRegion);
      }
    }

    // Tab from A2 → B2 (merge origin)
    const a2 = setupActor({
      activeCell: cell(1, 0), // A2
      ranges: [testRange],
      merges,
    });
    expect(a2.runTab(false)).toEqual({ ranges: [testRange], activeCell: cell(1, 1) }); // B2
    a2.stop();

    // Tab from B2 should skip the rest of the merge (treated as one stop),
    // go to E2.
    const b2 = setupActor({
      activeCell: cell(1, 1), // B2 (merge origin)
      ranges: [testRange],
      merges,
    });
    expect(b2.runTab(false)).toEqual({ ranges: [testRange], activeCell: cell(1, 4) }); // E2
    b2.stop();
  });

  it('Enter treats merged region B2:D4 as single stop in column-major order', () => {
    const testRange = range(0, 0, 4, 4); // A1:E5

    const mergeRegion = range(1, 1, 3, 3);
    const merges = new Map<string, CellRange>();
    for (let row = 1; row <= 3; row++) {
      for (let col = 1; col <= 3; col++) {
        merges.set(`${row},${col}`, mergeRegion);
      }
    }

    // Enter from B1 → B2 (merge origin)
    const b1 = setupActor({
      activeCell: cell(0, 1), // B1
      ranges: [testRange],
      merges,
    });
    expect(b1.runEnter(false)).toEqual({ ranges: [testRange], activeCell: cell(1, 1) }); // B2
    b1.stop();

    // Enter from B2 should skip merge interior, go to B5
    const b2 = setupActor({
      activeCell: cell(1, 1), // B2 (merge origin)
      ranges: [testRange],
      merges,
    });
    expect(b2.runEnter(false)).toEqual({ ranges: [testRange], activeCell: cell(4, 1) }); // B5
    b2.stop();
  });

  it('handles merge at selection edge correctly', () => {
    const testRange = range(0, 0, 2, 2); // A1:C3

    // Mock merge B1:C2 (rows 0-1, cols 1-2)
    const mergeRegion = range(0, 1, 1, 2);
    const merges = new Map<string, CellRange>();
    for (let row = 0; row <= 1; row++) {
      for (let col = 1; col <= 2; col++) {
        merges.set(`${row},${col}`, mergeRegion);
      }
    }

    // Tab from A1 → B1 (merge origin)
    const a1 = setupActor({
      activeCell: cell(0, 0),
      ranges: [testRange],
      merges,
    });
    expect(a1.runTab(false)).toEqual({ ranges: [testRange], activeCell: cell(0, 1) }); // B1
    a1.stop();

    // Tab from B1 → A2 (next row, skip rest of merged region)
    const b1 = setupActor({
      activeCell: cell(0, 1),
      ranges: [testRange],
      merges,
    });
    expect(b1.runTab(false)).toEqual({ ranges: [testRange], activeCell: cell(1, 0) }); // A2
    b1.stop();
  });
});

// =============================================================================
// TESTS: Combined Hidden + Merged
// =============================================================================

describe('Combined Hidden and Merged Cells', () => {
  it('Tab skips hidden columns and treats merges as single stops', () => {
    const testRange = range(0, 0, 2, 4); // A1:E3

    // Hide column C (index 2)
    const isColHidden = (col: number) => col === 2;

    // Merge E2 (rows 0-1, cols 3-4)
    const mergeRegion = range(0, 3, 1, 4);
    const merges = new Map<string, CellRange>();
    for (let row = 0; row <= 1; row++) {
      for (let col = 3; col <= 4; col++) {
        merges.set(`${row},${col}`, mergeRegion);
      }
    }

    // Tab from B1 should skip C1 (hidden), go to D1 (merge origin)
    const b1 = setupActor({
      activeCell: cell(0, 1), // B1
      ranges: [testRange],
      isColHidden,
      merges,
    });
    expect(b1.runTab(false)).toEqual({ ranges: [testRange], activeCell: cell(0, 3) }); // D1
    b1.stop();

    // Tab from D1 should skip rest of merge, skip C2 (hidden), go to A2
    const d1 = setupActor({
      activeCell: cell(0, 3), // D1
      ranges: [testRange],
      isColHidden,
      merges,
    });
    expect(d1.runTab(false)).toEqual({ ranges: [testRange], activeCell: cell(1, 0) }); // A2
    d1.stop();
  });
});

// =============================================================================
// TESTS: Edge Cases
// =============================================================================

describe('Edge Cases', () => {
  it('handles active cell outside of selection range', () => {
    const testRange = range(0, 0, 2, 2); // A1:C3

    // Active cell at D4 (outside selection)
    const a = setupActor({
      activeCell: cell(3, 3), // D4
      ranges: [testRange],
    });

    // Should start from beginning of selection
    expect(a.runTab(false)).toEqual({ ranges: [testRange], activeCell: cell(0, 0) }); // A1
    a.stop();
  });

  it('handles a selection where the only stop equals the active cell', () => {
    // The action handler had a special path for `ranges.length === 0`
    // (empty list) that fell back to `keyTab`. The machine path doesn't
    // accept empty ranges via `SET_SELECTION` (the source-aware reducer
    // requires at least one range), so we cover the equivalent observable:
    // a single 1×1 selection where the active cell is already at the only
    // cyclable stop. Tab moves right by one (free-movement fallback).
    const a = setupActor({
      activeCell: cell(0, 0),
      ranges: [range(0, 0, 0, 0)],
    });
    expect(a.runTab(false).activeCell).toEqual(cell(0, 1));
    a.stop();
  });

  it('wraps correctly when all cells in last row are hidden', () => {
    const testRange = range(0, 0, 2, 2); // A1:C3

    // Hide entire row 2 (index 2)
    const isRowHidden = (row: number) => row === 2;

    // Tab from C2 should skip row 2 entirely, wrap to A1
    const c2 = setupActor({
      activeCell: cell(1, 2), // C2
      ranges: [testRange],
      isRowHidden,
    });
    expect(c2.runTab(false)).toEqual({ ranges: [testRange], activeCell: cell(0, 0) }); // A1
    c2.stop();
  });

  it('handles selection with only merged cells', () => {
    const testRange = range(0, 0, 1, 1); // A1:B2

    // Entire selection is one merged region
    const mergeRegion = range(0, 0, 1, 1);
    const merges = new Map<string, CellRange>();
    for (let row = 0; row <= 1; row++) {
      for (let col = 0; col <= 1; col++) {
        merges.set(`${row},${col}`, mergeRegion);
      }
    }

    // The action handler cycled to A1 (the only stop). The cycle helper's
    // `hasCyclableStops` predicate returns
    // `false` for a single-stop list (length < 2), so KEY_TAB falls
    // through to free movement: A1 + Tab = B1 (escapeMergeOnMove jumps
    // past the merge in the right direction; merge ends at col 1 so
    // post-merge col is 2 → C1).
    const a = setupActor({
      activeCell: cell(0, 0),
      ranges: [testRange],
      merges,
    });
    // Free movement: A1 → step right (B1) → escape merge → C1.
    expect(a.runTab(false).activeCell).toEqual(cell(0, 2));
    a.stop();
  });
});
