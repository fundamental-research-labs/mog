/**
 * SELECT_CURRENT_REGION Action Handler — unit tests
 *
 * Locks in the consolidation of `getCurrentRegion` to the kernel API
 * (`Worksheet.getCurrentRegion`). The previous handler had a
 * 122-line local reimplementation with subtle bounds & "isolated empty
 * cell" semantics; the local copy is now deleted and the kernel is the
 * single source of truth.
 *
 * Coverage:
 * - First press calls the kernel API (verifies the local helper is gone).
 * - Existing "isolated cell -> selectAll" early-out is preserved.
 * - Region-with-data result triggers setSelection with the kernel range.
 * - Second press (within state-machine window) selects all cells.
 *
 */

import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import type { CellRange } from '@mog-sdk/contracts/core';

import { SELECT_CURRENT_REGION } from '../select-all';
import { cycleCurrentRegionSelection } from '../current-region';

// =============================================================================
// Test Utilities
// =============================================================================

interface MockSetup {
  deps: ActionDependencies;
  selectAll: jest.Mock;
  setSelection: jest.Mock;
  getCurrentRegion: jest.Mock;
  recordCtrlAPress: jest.Mock;
  resetCtrlAState: jest.Mock;
}

function makeMockDeps(opts: {
  activeCell?: { row: number; col: number };
  selectionRanges?: CellRange[];
  /** Result from ws.getCurrentRegion(row, col). */
  currentRegionResult?: CellRange;
  /** What state the Ctrl+A state machine returns next. */
  nextCtrlAState?: 'region' | 'all' | 'objects';
}): MockSetup {
  const activeCell = opts.activeCell ?? { row: 2, col: 3 };
  const selectAll = jest.fn();
  const setSelection = jest.fn();
  const getCurrentRegion = jest.fn().mockResolvedValue(
    (opts.currentRegionResult ?? {
      startRow: activeCell.row,
      startCol: activeCell.col,
      endRow: activeCell.row,
      endCol: activeCell.col,
    }) as never,
  );
  const recordCtrlAPress = jest.fn();
  const resetCtrlAState = jest.fn();
  const getNextCtrlAState = jest.fn().mockReturnValue(opts.nextCtrlAState ?? 'region');

  const ws = {
    getCurrentRegion,
    charts: {
      list: jest.fn().mockResolvedValue([] as never),
    },
  };

  const workbook = {
    getSheetById: jest.fn().mockReturnValue(ws),
  };

  const deps = {
    workbook,
    accessors: {
      selection: {
        getActiveCell: () => activeCell,
        getRanges: () =>
          opts.selectionRanges ?? [
            {
              startRow: activeCell.row,
              startCol: activeCell.col,
              endRow: activeCell.row,
              endCol: activeCell.col,
            },
          ],
      },
    },
    commands: {
      selection: {
        selectAll,
        setSelection,
      },
    },
    getActiveSheetId: () => 'sheet1' as any,
    onUIAction: jest.fn(),
  } as unknown as ActionDependencies;

  // Inject UIStore for getUIStore(deps).getState() — exposes Ctrl+A state mgmt.
  (deps as unknown as { uiStore: unknown }).uiStore = {
    getState: () => ({
      getNextCtrlAState,
      recordCtrlAPress,
      resetCtrlAState,
    }),
  };

  return { deps, selectAll, setSelection, getCurrentRegion, recordCtrlAPress, resetCtrlAState };
}

// =============================================================================
// Tests
// =============================================================================

describe('SELECT_CURRENT_REGION — literal current-region command', () => {
  test('first press calls ws.getCurrentRegion with the active cell coords', async () => {
    // Active cell C3 (row 2, col 2); kernel returns A1:E10 contiguous block.
    const setup = makeMockDeps({
      activeCell: { row: 2, col: 2 },
      currentRegionResult: { startRow: 0, startCol: 0, endRow: 9, endCol: 4 },
    });

    const result = await SELECT_CURRENT_REGION(setup.deps);

    expect(result.handled).toBe(true);
    // Kernel must be called with the active cell coords — not via the old
    // local helper (which is now deleted).
    expect(setup.getCurrentRegion).toHaveBeenCalledTimes(1);
    expect(setup.getCurrentRegion).toHaveBeenCalledWith(2, 2);
  });

  test('region with data triggers setSelection with the kernel-returned range', async () => {
    const region: CellRange = { startRow: 0, startCol: 0, endRow: 9, endCol: 4 };
    const setup = makeMockDeps({
      activeCell: { row: 2, col: 2 },
      currentRegionResult: region,
    });

    await SELECT_CURRENT_REGION(setup.deps);

    expect(setup.setSelection).toHaveBeenCalledTimes(1);
    const [rangesArg, activeCellArg] = setup.setSelection.mock.calls[0] as [CellRange[], unknown];
    expect(rangesArg[0]).toEqual({
      startRow: 0,
      startCol: 0,
      endRow: 9,
      endCol: 4,
    });
    expect(activeCellArg).toEqual({ row: 2, col: 2 });
    expect(setup.recordCtrlAPress).not.toHaveBeenCalled();
    expect(setup.resetCtrlAState).toHaveBeenCalledTimes(1);
    expect(setup.selectAll).not.toHaveBeenCalled();
  });

  test('single-cell current region selects that cell instead of falling through to selectAll', async () => {
    const setup = makeMockDeps({
      activeCell: { row: 5, col: 5 },
      currentRegionResult: { startRow: 5, startCol: 5, endRow: 5, endCol: 5 },
    });

    const result = await SELECT_CURRENT_REGION(setup.deps);

    expect(result.handled).toBe(true);
    expect(setup.selectAll).not.toHaveBeenCalled();
    expect(setup.setSelection).toHaveBeenCalledWith(
      [{ startRow: 5, startCol: 5, endRow: 5, endCol: 5 }],
      { row: 5, col: 5 },
    );
    expect(setup.resetCtrlAState).toHaveBeenCalledTimes(1);
  });
});

describe('cycleCurrentRegionSelection — Ctrl+A progressive selection', () => {
  test('isolated empty cell (kernel returns single-cell == active cell) falls through to selectAll', async () => {
    const setup = makeMockDeps({
      activeCell: { row: 5, col: 5 },
      currentRegionResult: { startRow: 5, startCol: 5, endRow: 5, endCol: 5 },
    });

    const result = await cycleCurrentRegionSelection(setup.deps);

    expect(result.handled).toBe(true);
    expect(setup.selectAll).toHaveBeenCalledTimes(1);
    expect(setup.setSelection).not.toHaveBeenCalled();
    expect(setup.recordCtrlAPress).toHaveBeenCalledWith('all');
  });

  test('second press (state machine returns "all") skips region and selects all without calling kernel', async () => {
    const setup = makeMockDeps({
      activeCell: { row: 2, col: 2 },
      // Selection is currently a small range — so isAllCellsSelected is false.
      selectionRanges: [{ startRow: 0, startCol: 0, endRow: 9, endCol: 4 }],
      nextCtrlAState: 'all',
    });

    const result = await cycleCurrentRegionSelection(setup.deps);

    expect(result.handled).toBe(true);
    expect(setup.selectAll).toHaveBeenCalledTimes(1);
    // Kernel must NOT be called on second press — that path is skipped.
    expect(setup.getCurrentRegion).not.toHaveBeenCalled();
    expect(setup.recordCtrlAPress).toHaveBeenCalledWith('all');
  });

  test('records "region" before awaiting kernel so a concurrent press transitions to "all"', async () => {
    // Race regression: previously recordCtrlAPress fired AFTER the kernel
    // await resolved. With the kernel call now async (vs. the deleted
    // in-process helper), a second Ctrl+A during the in-flight first call
    // would read stale state and re-enter the 'region' branch instead of
    // advancing to 'all'. Now the press is recorded synchronously before
    // the await, so `getNextCtrlAState` on a second press sees 'region'
    // and correctly returns 'all'.
    let resolveKernel: (value: CellRange) => void = () => {};
    const setup = makeMockDeps({
      activeCell: { row: 2, col: 2 },
      currentRegionResult: { startRow: 0, startCol: 0, endRow: 9, endCol: 4 },
    });
    setup.getCurrentRegion.mockImplementation(
      () => new Promise<CellRange>((res) => (resolveKernel = res)),
    );

    const pending = cycleCurrentRegionSelection(setup.deps);

    // While the kernel call is pending, the press must already be recorded.
    expect(setup.recordCtrlAPress).toHaveBeenCalledWith('region');
    const callsBeforeResolve = setup.recordCtrlAPress.mock.calls.length;
    expect(callsBeforeResolve).toBeGreaterThanOrEqual(1);

    resolveKernel({ startRow: 0, startCol: 0, endRow: 9, endCol: 4 });
    await pending;
  });
});
