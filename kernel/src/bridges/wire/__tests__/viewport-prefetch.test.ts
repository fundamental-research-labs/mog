import type { MutationResult, RecalcResult } from '../../compute/compute-types.gen';
import { classifyMutation } from '../mutation-classifier';
import type { PrefetchBounds } from '../viewport-prefetch';
import { computePrefetchBounds, isWithinPrefetch } from '../viewport-prefetch';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecalcResult(overrides?: Partial<RecalcResult>): RecalcResult {
  return {
    changedCells: [],
    projectionChanges: [],
    errors: [],
    validationAnnotations: [],
    metrics: {} as RecalcResult['metrics'],
    ...overrides,
  };
}

function makeMutationResult(overrides?: Partial<MutationResult>): MutationResult {
  return {
    recalc: makeRecalcResult(),
    ...overrides,
  };
}

function makeCellChange(row: number, col: number) {
  return {
    cellId: `cell_${row}_${col}`,
    sheetId: 'sheet1',
    position: { row, col },
    value: 42,
    extraFlags: 0,
  };
}

function makeProjectionChange(cells: Array<{ row: number; col: number }>) {
  return {
    sourceCellId: 'source',
    sheetId: 'sheet1',
    projectionCells: cells.map((c) => ({
      cellId: `cell_${c.row}_${c.col}`,
      row: c.row,
      col: c.col,
      value: 1,
    })),
  };
}

// ---------------------------------------------------------------------------
// computePrefetchBounds
// ---------------------------------------------------------------------------

describe('computePrefetchBounds', () => {
  const sheetDims = { maxRow: 1000, maxCol: 200 };

  it('adds overscan rows and columns correctly', () => {
    const visible: PrefetchBounds = { startRow: 600, startCol: 10, endRow: 650, endCol: 30 };
    const result = computePrefetchBounds(visible, sheetDims);

    expect(result.startRow).toBe(0); // max(0, 600 - 1000)
    expect(result.startCol).toBe(0); // max(0, 10 - 20) = 0, clamped
    expect(result.endRow).toBe(1000); // min(1000, 650 + 1000)
    expect(result.endCol).toBe(94); // 30 + 64
  });

  it('respects custom overscan config', () => {
    const visible: PrefetchBounds = { startRow: 100, startCol: 50, endRow: 120, endCol: 60 };
    const result = computePrefetchBounds(visible, sheetDims, {
      overscanRows: 10,
      overscanCols: 5,
    });

    expect(result.startRow).toBe(90);
    expect(result.startCol).toBe(45);
    expect(result.endRow).toBe(130);
    expect(result.endCol).toBe(65);
  });

  it('clamps to zero (no negative bounds)', () => {
    const visible: PrefetchBounds = { startRow: 5, startCol: 3, endRow: 20, endCol: 10 };
    const result = computePrefetchBounds(visible, sheetDims);

    expect(result.startRow).toBe(0);
    expect(result.startCol).toBe(0);
  });

  it('clamps to sheet dimensions (no exceeding max)', () => {
    const visible: PrefetchBounds = { startRow: 970, startCol: 185, endRow: 1000, endCol: 200 };
    const result = computePrefetchBounds(visible, sheetDims);

    expect(result.endRow).toBe(1000); // min(1000, 1000 + 1000) = 1000
    expect(result.endCol).toBe(200); // min(200, 200 + 64) = 200
  });
});

// ---------------------------------------------------------------------------
// isWithinPrefetch
// ---------------------------------------------------------------------------

describe('isWithinPrefetch', () => {
  const prefetch: PrefetchBounds = { startRow: 50, startCol: 0, endRow: 200, endCol: 50 };

  it('returns true when visible is fully inside prefetch', () => {
    const visible: PrefetchBounds = { startRow: 100, startCol: 10, endRow: 150, endCol: 30 };
    expect(isWithinPrefetch(visible, prefetch)).toBe(true);
  });

  it('returns true when visible equals prefetch exactly', () => {
    expect(isWithinPrefetch(prefetch, prefetch)).toBe(true);
  });

  it('returns false when visible extends beyond prefetch startRow', () => {
    const visible: PrefetchBounds = { startRow: 40, startCol: 10, endRow: 150, endCol: 30 };
    expect(isWithinPrefetch(visible, prefetch)).toBe(false);
  });

  it('returns false when visible extends beyond prefetch endRow', () => {
    const visible: PrefetchBounds = { startRow: 100, startCol: 10, endRow: 250, endCol: 30 };
    expect(isWithinPrefetch(visible, prefetch)).toBe(false);
  });

  it('returns false when visible extends beyond prefetch startCol', () => {
    const visible: PrefetchBounds = { startRow: 100, startCol: -1, endRow: 150, endCol: 30 };
    expect(isWithinPrefetch(visible, prefetch)).toBe(false);
  });

  it('returns false when visible extends beyond prefetch endCol', () => {
    const visible: PrefetchBounds = { startRow: 100, startCol: 10, endRow: 150, endCol: 60 };
    expect(isWithinPrefetch(visible, prefetch)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// classifyMutation
// ---------------------------------------------------------------------------

describe('classifyMutation', () => {
  const prefetch: PrefetchBounds = { startRow: 50, startCol: 0, endRow: 200, endCol: 50 };
  const visible: PrefetchBounds = { startRow: 100, startCol: 10, endRow: 150, endCol: 30 };

  it('returns invalidate when no prefetch bounds exist', () => {
    const result = makeMutationResult();
    expect(classifyMutation(result, false, null, visible)).toBe('invalidate');
  });

  it('returns invalidate when no visible bounds exist', () => {
    const result = makeMutationResult();
    expect(classifyMutation(result, false, prefetch, null)).toBe('invalidate');
  });

  it('returns invalidate for structural changes', () => {
    const result = makeMutationResult();
    expect(classifyMutation(result, true, prefetch, visible)).toBe('invalidate');
  });

  it('returns invalidate for sorting changes', () => {
    const result = makeMutationResult({
      sortingChanges: [
        {
          sheetId: 's1',
          kind: 'modified' as any,
          startRow: 0,
          startCol: 0,
          endRow: 10,
          endCol: 5,
          rowsMoved: 3,
        },
      ],
    });
    expect(classifyMutation(result, false, prefetch, visible)).toBe('invalidate');
  });

  it('returns invalidate for visibility changes', () => {
    const result = makeMutationResult({
      visibilityChanges: [{ sheetId: 's1', axis: 'row', index: 0, hidden: true }],
    });
    expect(classifyMutation(result, false, prefetch, visible)).toBe('invalidate');
  });

  it('returns invalidate for dimension changes', () => {
    const result = makeMutationResult({
      dimensionChanges: [{ sheetId: 's1', axis: 'row', index: 0, kind: 'set' as any }],
    });
    expect(classifyMutation(result, false, prefetch, visible)).toBe('invalidate');
  });

  it('returns invalidate for filter changes', () => {
    const result = makeMutationResult({
      filterChanges: [{ sheetId: 's1', kind: 'modified' as any }],
    });
    expect(classifyMutation(result, false, prefetch, visible)).toBe('invalidate');
  });

  it('returns invalidate for CF changes', () => {
    const result = makeMutationResult({
      cfChanges: [{ sheetId: 's1', kind: 'modified' as any }],
    });
    expect(classifyMutation(result, false, prefetch, visible)).toBe('invalidate');
  });

  it('returns dirty for recalc changes outside visible but in prefetch', () => {
    // Cell at row 60, col 5 is in prefetch (50-200, 0-50) but outside visible (100-150, 10-30)
    const result = makeMutationResult({
      recalc: makeRecalcResult({
        changedCells: [makeCellChange(60, 5)],
      }),
    });
    expect(classifyMutation(result, false, prefetch, visible)).toBe('dirty');
  });

  it('returns dirty for projection changes outside visible but in prefetch', () => {
    const result = makeMutationResult({
      recalc: makeRecalcResult({
        projectionChanges: [makeProjectionChange([{ row: 60, col: 5 }])],
      }),
    });
    expect(classifyMutation(result, false, prefetch, visible)).toBe('dirty');
  });

  it('returns patch for changes only within visible area', () => {
    // Cell at row 110, col 15 is inside visible (100-150, 10-30)
    const result = makeMutationResult({
      recalc: makeRecalcResult({
        changedCells: [makeCellChange(110, 15)],
      }),
    });
    expect(classifyMutation(result, false, prefetch, visible)).toBe('patch');
  });

  it('returns patch for changes entirely outside prefetch (not in buffer)', () => {
    // Cell at row 300 is outside prefetch (50-200), so no dirty cells in prefetch
    const result = makeMutationResult({
      recalc: makeRecalcResult({
        changedCells: [makeCellChange(300, 5)],
      }),
    });
    expect(classifyMutation(result, false, prefetch, visible)).toBe('patch');
  });

  it('returns patch for empty mutation (no changes)', () => {
    const result = makeMutationResult();
    expect(classifyMutation(result, false, prefetch, visible)).toBe('patch');
  });

  it('structural flag takes priority over non-structural content', () => {
    // Even if all changed cells are in visible area, structural = invalidate
    const result = makeMutationResult({
      recalc: makeRecalcResult({
        changedCells: [makeCellChange(110, 15)],
      }),
    });
    expect(classifyMutation(result, true, prefetch, visible)).toBe('invalidate');
  });
});
