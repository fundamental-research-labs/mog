/**
 * INSERT_TABLE Action Handler — unit tests
 *
 * Locks in the Excel current-region auto-expansion behavior for the
 * Insert Table flow:
 *
 * - Single-cell selection on a contiguous block expands to the data region
 * before opening the Create Table dialog (so the dialog seeds with the
 * user's data, not just the click target).
 * - Empty cell with no adjacent data falls back to the raw single-cell range
 * (the dialog still opens; user can type a range manually).
 * - Multi-cell selections are passed through as-is (user explicitly chose).
 * - Empty selection returns `{ handled: false, reason: 'disabled' }`.
 *
 * Verifies the handler calls `openInsertTableDialog({ range, hasHeaders })`
 * with the resolved target snapshot.
 *
 */

import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import type { CellRange } from '@mog-sdk/contracts/core';

import { INSERT_TABLE } from '../formatting/cell-format-dialogs';

// =============================================================================
// Test Utilities
// =============================================================================

interface MockSetup {
  deps: ActionDependencies;
  openInsertTableDialog: jest.Mock;
  getCurrentRegion: jest.Mock;
}

function makeMockDeps(opts: {
  selectionRanges: CellRange[];
  /** Result that ws.getCurrentRegion(row, col) should resolve to. */
  currentRegionResult?: CellRange;
  cellValues?: Record<string, unknown>;
}): MockSetup {
  const openInsertTableDialog = jest.fn();
  const getCurrentRegion = jest.fn().mockImplementation((...args: unknown[]) => {
    const row = args[0] as number;
    const col = args[1] as number;
    // Default: single-cell region (the kernel's "no data" return).
    const fallback: CellRange = { startRow: row, startCol: col, endRow: row, endCol: col };
    return Promise.resolve(opts.currentRegionResult ?? fallback);
  });

  const ws = {
    getCurrentRegion,
    getCell: jest.fn((row: number, col: number) =>
      Promise.resolve({ value: opts.cellValues?.[`${row},${col}`] ?? null }),
    ),
  };

  const workbook = {
    getSheetById: jest.fn().mockReturnValue(ws),
  };

  const deps = {
    workbook,
    accessors: {
      selection: {
        getActiveCell: () => ({ row: 0, col: 0 }),
        getRanges: () => opts.selectionRanges,
      },
    },
    commands: {},
    getActiveSheetId: () => 'sheet1' as any,
  } as unknown as ActionDependencies;

  // Inject UIStore via the contract used by getUIStore(deps).
  // The contract reads `deps.uiStore.getState()` — point it at our mock.
  (deps as unknown as { uiStore: unknown }).uiStore = {
    getState: () => ({ openInsertTableDialog }),
  };

  return { deps, openInsertTableDialog, getCurrentRegion };
}

// =============================================================================
// Tests
// =============================================================================

describe('INSERT_TABLE — current-region auto-expansion', () => {
  test('single-cell selection on contiguous data expands to the data region', async () => {
    // Selection is a single cell B2 (row 1, col 1); kernel reports the
    // surrounding contiguous block A1:D10.
    const expandedRegion: CellRange = { startRow: 0, startCol: 0, endRow: 9, endCol: 3 };
    const setup = makeMockDeps({
      selectionRanges: [{ startRow: 1, startCol: 1, endRow: 1, endCol: 1 }],
      currentRegionResult: expandedRegion,
    });

    const result = await INSERT_TABLE(setup.deps);

    expect(result.handled).toBe(true);
    expect(setup.getCurrentRegion).toHaveBeenCalledWith(1, 1);
    expect(setup.openInsertTableDialog).toHaveBeenCalledTimes(1);
    expect(setup.openInsertTableDialog).toHaveBeenCalledWith({
      range: expandedRegion,
      hasHeaders: false,
    });
  });

  test('single-cell selection on empty isolated cell falls back to raw single-cell range', async () => {
    // Selection on E5 with no adjacent data — kernel returns the same
    // single cell. The handler must still open the dialog with that
    // single-cell range (not null) so the user can edit the range manually.
    const rawRange: CellRange = { startRow: 4, startCol: 4, endRow: 4, endCol: 4 };
    const setup = makeMockDeps({
      selectionRanges: [rawRange],
      // Kernel returns single-cell for empty isolated cells.
      currentRegionResult: { startRow: 4, startCol: 4, endRow: 4, endCol: 4 },
    });

    const result = await INSERT_TABLE(setup.deps);

    expect(result.handled).toBe(true);
    expect(setup.openInsertTableDialog).toHaveBeenCalledTimes(1);
    expect(setup.openInsertTableDialog).toHaveBeenCalledWith({
      range: rawRange,
      hasHeaders: false,
    });
  });

  test('multi-cell selection passes through without invoking getCurrentRegion', async () => {
    // User explicitly selected A1:C5 — handler must respect that and NOT
    // call ws.getCurrentRegion (expandToDataRegion only expands
    // single-cell / single-row selections).
    const multiRange: CellRange = { startRow: 0, startCol: 0, endRow: 4, endCol: 2 };
    const setup = makeMockDeps({
      selectionRanges: [multiRange],
    });

    const result = await INSERT_TABLE(setup.deps);

    expect(result.handled).toBe(true);
    expect(setup.getCurrentRegion).not.toHaveBeenCalled();
    expect(setup.openInsertTableDialog).toHaveBeenCalledWith({
      range: multiRange,
      hasHeaders: false,
    });
  });

  test('multi-cell selection with text headers seeds dialog with hasHeaders=true', async () => {
    const multiRange: CellRange = { startRow: 0, startCol: 0, endRow: 3, endCol: 1 };
    const setup = makeMockDeps({
      selectionRanges: [multiRange],
      cellValues: {
        '0,0': 'Name',
        '0,1': 'Score',
        '1,0': 'Alice',
        '1,1': '90',
      },
    });

    const result = await INSERT_TABLE(setup.deps);

    expect(result.handled).toBe(true);
    expect(setup.getCurrentRegion).not.toHaveBeenCalled();
    expect(setup.openInsertTableDialog).toHaveBeenCalledWith({
      range: multiRange,
      hasHeaders: true,
    });
  });

  test('multi-cell selection with sparse text title row seeds dialog with hasHeaders=true', async () => {
    const multiRange: CellRange = { startRow: 457, startCol: 0, endRow: 479, endCol: 10 };
    const setup = makeMockDeps({
      selectionRanges: [multiRange],
      cellValues: {
        '457,0': 'Consolidated Report',
        '458,0': 'Current items',
        '463,6': 235658,
      },
    });

    const result = await INSERT_TABLE(setup.deps);

    expect(result.handled).toBe(true);
    expect(setup.getCurrentRegion).not.toHaveBeenCalled();
    expect(setup.openInsertTableDialog).toHaveBeenCalledWith({
      range: multiRange,
      hasHeaders: true,
    });
  });

  test('empty selection returns disabled', async () => {
    const setup = makeMockDeps({
      selectionRanges: [],
    });

    const result = await INSERT_TABLE(setup.deps);

    expect(result.handled).toBe(false);
    expect(result.reason).toBe('disabled');
    expect(setup.openInsertTableDialog).not.toHaveBeenCalled();
  });

  test('single-row multi-column selection expands via getCurrentRegion (Excel header-row semantics)', async () => {
    // Excel treats a single-row selection as "header row" and expands
    // downward via getCurrentRegion. Verifies expandToDataRegion is wired
    // through for this case too.
    const headerRow: CellRange = { startRow: 0, startCol: 0, endRow: 0, endCol: 3 };
    const expanded: CellRange = { startRow: 0, startCol: 0, endRow: 9, endCol: 3 };
    const setup = makeMockDeps({
      selectionRanges: [headerRow],
      currentRegionResult: expanded,
    });

    const result = await INSERT_TABLE(setup.deps);

    expect(result.handled).toBe(true);
    expect(setup.getCurrentRegion).toHaveBeenCalledWith(0, 0);
    expect(setup.openInsertTableDialog).toHaveBeenCalledWith({
      range: expanded,
      hasHeaders: false,
    });
  });

  test("strips kernel's `sheetId` field before storing in the dialog state", async () => {
    // The kernel's getCurrentRegion returns a CellRange that may carry an
    // extra `sheetId` field; the dialog state's `TablePreviewRange` only
    // models the four positional fields. Verify the handler doesn't leak the
    // extra field through to openInsertTableDialog.
    const kernelRange = {
      startRow: 0,
      startCol: 0,
      endRow: 9,
      endCol: 3,
      sheetId: 'kernel-sheet-id-leak',
    };
    const setup = makeMockDeps({
      selectionRanges: [{ startRow: 1, startCol: 1, endRow: 1, endCol: 1 }],
      currentRegionResult: kernelRange as unknown as CellRange,
    });

    await INSERT_TABLE(setup.deps);

    expect(setup.openInsertTableDialog).toHaveBeenCalledTimes(1);
    const passed = setup.openInsertTableDialog.mock.calls[0][0] as {
      range: Record<string, unknown>;
      hasHeaders: boolean;
    };
    expect(passed).toEqual({
      range: { startRow: 0, startCol: 0, endRow: 9, endCol: 3 },
      hasHeaders: false,
    });
    expect(passed.range).not.toHaveProperty('sheetId');
  });
});
