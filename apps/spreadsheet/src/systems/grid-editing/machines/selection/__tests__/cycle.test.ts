/**
 * Selection Cycle (Tab/Enter) — Machine-Layer Pin
 *
 * Pins the cycle algorithm at the layer where it now lives. Complements
 * `actions/handlers/selection/__tests__/tab-enter-matrix.test.ts`,
 * which preserves the user-flow harness and covers the same scenarios; this
 * file tests `getNextCellInSelection` and `hasCyclableStops` directly so
 * regressions surface specifically at the layer they live in.
 * @see ../cycle.ts
 */

import type { CellRange } from '@mog-sdk/contracts/core';

import type { CellCoord } from '../../../../shared/types';
import { getNextCellInSelection, hasCyclableStops, type CycleOptions } from '../cycle';

// =============================================================================
// HELPERS
// =============================================================================

const cell = (row: number, col: number): CellCoord => ({ row, col });
const rng = (startRow: number, startCol: number, endRow: number, endCol: number): CellRange => ({
  startRow,
  startCol,
  endRow,
  endCol,
});

/**
 * Build a `getMergedRegionAt` getter from a flat merge list. Mirrors the
 * production accessor wired in `GridEditingSystem.refreshLayoutCallbacks`.
 */
function makeMergeGetter(merges: CellRange[]): CycleOptions['getMergedRegionAt'] {
  return (row, col) => {
    for (const m of merges) {
      if (row >= m.startRow && row <= m.endRow && col >= m.startCol && col <= m.endCol) {
        return m;
      }
    }
    return null;
  };
}

// =============================================================================
// CYCLE: Basic Row-Major (Tab)
// =============================================================================

describe('getNextCellInSelection — Tab (row-major)', () => {
  it('cycles through A1:C3 forward', () => {
    const r = [rng(0, 0, 2, 2)];
    expect(getNextCellInSelection(cell(0, 0), r, 'forward', 'tab')).toEqual(cell(0, 1));
    expect(getNextCellInSelection(cell(0, 2), r, 'forward', 'tab')).toEqual(cell(1, 0));
    expect(getNextCellInSelection(cell(2, 2), r, 'forward', 'tab')).toEqual(cell(0, 0)); // wrap
  });

  it('cycles backward', () => {
    const r = [rng(0, 0, 2, 2)];
    expect(getNextCellInSelection(cell(0, 0), r, 'backward', 'tab')).toEqual(cell(2, 2)); // wrap
    expect(getNextCellInSelection(cell(0, 1), r, 'backward', 'tab')).toEqual(cell(0, 0));
    expect(getNextCellInSelection(cell(1, 0), r, 'backward', 'tab')).toEqual(cell(0, 2));
  });

  it('returns null on empty ranges', () => {
    expect(getNextCellInSelection(cell(0, 0), [], 'forward', 'tab')).toBeNull();
  });
});

// =============================================================================
// CYCLE: Basic Column-Major (Enter)
// =============================================================================

describe('getNextCellInSelection — Enter (column-major)', () => {
  it('cycles through A1:C3 forward', () => {
    const r = [rng(0, 0, 2, 2)];
    expect(getNextCellInSelection(cell(0, 0), r, 'forward', 'enter')).toEqual(cell(1, 0));
    expect(getNextCellInSelection(cell(2, 0), r, 'forward', 'enter')).toEqual(cell(0, 1));
    expect(getNextCellInSelection(cell(2, 2), r, 'forward', 'enter')).toEqual(cell(0, 0)); // wrap
  });

  it('cycles backward', () => {
    const r = [rng(0, 0, 2, 2)];
    expect(getNextCellInSelection(cell(0, 0), r, 'backward', 'enter')).toEqual(cell(2, 2)); // wrap
    expect(getNextCellInSelection(cell(1, 0), r, 'backward', 'enter')).toEqual(cell(0, 0));
    expect(getNextCellInSelection(cell(0, 1), r, 'backward', 'enter')).toEqual(cell(2, 0));
  });
});

// =============================================================================
// CYCLE: Hidden rows/cols
// =============================================================================

describe('getNextCellInSelection — hidden rows/cols (Bug 2b)', () => {
  it('Tab skips hidden row 2 in A1:C5', () => {
    const r = [rng(0, 0, 4, 2)];
    const opts: CycleOptions = { isRowHidden: (row) => row === 2 };
    // C1 → next visible = A2 (row 1)
    expect(getNextCellInSelection(cell(0, 2), r, 'forward', 'tab', opts)).toEqual(cell(1, 0));
    // C2 → next visible = A4 (skip row 2)
    expect(getNextCellInSelection(cell(1, 2), r, 'forward', 'tab', opts)).toEqual(cell(3, 0));
  });

  it('Enter skips hidden rows in column-major order', () => {
    const r = [rng(0, 0, 4, 2)];
    const opts: CycleOptions = { isRowHidden: (row) => row === 1 || row === 3 };
    // A1 → A3
    expect(getNextCellInSelection(cell(0, 0), r, 'forward', 'enter', opts)).toEqual(cell(2, 0));
    // A3 → A5
    expect(getNextCellInSelection(cell(2, 0), r, 'forward', 'enter', opts)).toEqual(cell(4, 0));
  });

  it('Tab skips hidden column C in A1:E3', () => {
    const r = [rng(0, 0, 2, 4)];
    const opts: CycleOptions = { isColHidden: (col) => col === 2 };
    expect(getNextCellInSelection(cell(0, 1), r, 'forward', 'tab', opts)).toEqual(cell(0, 3));
    expect(getNextCellInSelection(cell(0, 3), r, 'forward', 'tab', opts)).toEqual(cell(0, 4));
  });
});

// =============================================================================
// CYCLE: Merged regions (Bug 2c)
// =============================================================================

describe('getNextCellInSelection — merged regions (Bug 2c)', () => {
  it('treats B2:D4 as a single stop at B2 in row-major order', () => {
    const r = [rng(0, 0, 4, 4)]; // A1:E5
    const opts: CycleOptions = { getMergedRegionAt: makeMergeGetter([rng(1, 1, 3, 3)]) };
    // A2 → B2 (merge origin)
    expect(getNextCellInSelection(cell(1, 0), r, 'forward', 'tab', opts)).toEqual(cell(1, 1));
    // B2 → E2 (skip merge interior)
    expect(getNextCellInSelection(cell(1, 1), r, 'forward', 'tab', opts)).toEqual(cell(1, 4));
  });

  it('treats B2:D4 as a single stop in column-major order', () => {
    const r = [rng(0, 0, 4, 4)];
    const opts: CycleOptions = { getMergedRegionAt: makeMergeGetter([rng(1, 1, 3, 3)]) };
    // B1 → B2 (merge origin)
    expect(getNextCellInSelection(cell(0, 1), r, 'forward', 'enter', opts)).toEqual(cell(1, 1));
    // B2 → B5 (skip merge interior)
    expect(getNextCellInSelection(cell(1, 1), r, 'forward', 'enter', opts)).toEqual(cell(4, 1));
  });

  it('maps active cell at non-origin merge cell back to origin', () => {
    // If the active cell is mid-merge (e.g., the user shrank a range and
    // landed on a non-origin cell), the cycle still finds it.
    const r = [rng(0, 0, 4, 4)];
    const opts: CycleOptions = { getMergedRegionAt: makeMergeGetter([rng(1, 1, 3, 3)]) };
    // C3 (1, 2) is mid-merge → maps to B2 (1, 1) → next stop is E2.
    expect(getNextCellInSelection(cell(2, 2), r, 'forward', 'tab', opts)).toEqual(cell(1, 4));
  });

  it('excludes merges whose origin is outside the active range', () => {
    // Range is C2:E4 (1-indexed) but the merge B1:D2 has its origin at B1
    // — outside the range. The merge should NOT be included as a stop.
    const r = [rng(1, 2, 3, 4)]; // C2:E4 (rows 1-3, cols 2-4)
    const opts: CycleOptions = { getMergedRegionAt: makeMergeGetter([rng(0, 1, 1, 3)]) };
    // From C2 (1, 2): the cell (1, 2) IS inside the merge B1:D2, but the
    // merge origin (0, 1) is NOT in the range. The cycle should skip it.
    // Next stop is the next visible cell after C2 in row-major order: D2 (1, 3).
    // That cell is also in the merge (origin still excluded), keep going: E2 (1, 4).
    expect(getNextCellInSelection(cell(1, 2), r, 'forward', 'tab', opts)).toEqual(cell(1, 4));
  });
});

// =============================================================================
// CYCLE: Multi-range
// =============================================================================

describe('getNextCellInSelection — multi-range', () => {
  it('walks ranges in order, then wraps', () => {
    // Two ranges: A1:B1 and A3:B3
    const r = [rng(0, 0, 0, 1), rng(2, 0, 2, 1)];
    // A1 → B1 (within first range)
    expect(getNextCellInSelection(cell(0, 0), r, 'forward', 'tab')).toEqual(cell(0, 1));
    // B1 → A3 (jump to next range)
    expect(getNextCellInSelection(cell(0, 1), r, 'forward', 'tab')).toEqual(cell(2, 0));
    // A3 → B3 (within second range)
    expect(getNextCellInSelection(cell(2, 0), r, 'forward', 'tab')).toEqual(cell(2, 1));
    // B3 → A1 (wrap to first cell of first range)
    expect(getNextCellInSelection(cell(2, 1), r, 'forward', 'tab')).toEqual(cell(0, 0));
  });
});

// =============================================================================
// hasCyclableStops
// =============================================================================

describe('hasCyclableStops', () => {
  it('returns false for empty ranges', () => {
    expect(hasCyclableStops([])).toBe(false);
  });

  it('returns false for a single 1x1 range', () => {
    expect(hasCyclableStops([rng(0, 0, 0, 0)])).toBe(false);
  });

  it('returns true for a 2x2 range', () => {
    expect(hasCyclableStops([rng(0, 0, 1, 1)])).toBe(true);
  });

  it('returns false for a 2x2 range entirely inside a single merge', () => {
    // Selection A1:B2 is fully inside merge A1:B2 — only one cyclable stop.
    const opts: CycleOptions = { getMergedRegionAt: makeMergeGetter([rng(0, 0, 1, 1)]) };
    expect(hasCyclableStops([rng(0, 0, 1, 1)], opts)).toBe(false);
  });

  it('returns true when one merge plus one regular cell give two stops', () => {
    // A1:C1 with a merge at A1:B1 yields stops [A1 (merge origin), C1]
    const opts: CycleOptions = { getMergedRegionAt: makeMergeGetter([rng(0, 0, 0, 1)]) };
    expect(hasCyclableStops([rng(0, 0, 0, 2)], opts)).toBe(true);
  });

  it('returns true for two single-cell ranges (multi-range selection)', () => {
    expect(hasCyclableStops([rng(0, 0, 0, 0), rng(2, 2, 2, 2)])).toBe(true);
  });
});
