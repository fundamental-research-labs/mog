/**
 * APPLY_BORDERS direct-mode preset routing.
 *
 * The toolbar dispatches `APPLY_BORDERS` with `{ borders, preset }` for
 * the user's last-used selection. The preset must thread into the
 * handler's outline/inside/none branches — without it, "Outside Borders"
 * on a multi-cell selection collapses to per-cell apply (4 sides on
 * every cell instead of the 12-edge perimeter on 3×3).
 *
 * This test locks the handler-level routing contract independently of
 * the BorderPicker UI and end-to-end scenarios. The picker→handler
 * boundary is where the latent "drop the preset" bug lived; a handler
 * unit test survives picker rewrites and runs in milliseconds.
 *
 * Also covers the side-effect: every direct-mode apply records
 * `lastUsedBorderFormat` in the BordersPickerSlice. Required for the
 * SplitButton main-click replay path to work.
 */

import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import type { CellBorders, CellRange } from '@mog-sdk/contracts/core';
import { sheetId as makeSheetId } from '@mog-sdk/contracts/core';

import { APPLY_BORDERS } from '../formatting/borders';

// =============================================================================
// Test utilities
// =============================================================================

interface MockSetup {
  deps: ActionDependencies;
  setRangesMock: jest.Mock;
  setLastUsedBorderFormatMock: jest.Mock;
}

function createMockDeps(opts: {
  ranges: CellRange[];
  hiddenRows?: number[];
  bitmapHiddenRows?: number[];
  hiddenCols?: number[];
  bitmapHiddenCols?: number[];
}): MockSetup {
  const activeSheetId = makeSheetId('sheet1');

  const setRangesMock = jest.fn().mockResolvedValue(undefined);
  const setLastUsedBorderFormatMock = jest.fn();
  const hiddenRows = new Set(opts.hiddenRows ?? []);
  const bitmapHiddenRows = new Set(opts.bitmapHiddenRows ?? opts.hiddenRows ?? []);
  const hiddenCols = new Set(opts.hiddenCols ?? []);
  const bitmapHiddenCols = new Set(opts.bitmapHiddenCols ?? opts.hiddenCols ?? []);

  // The outline branch clamps full-row/column selections to data bounds.
  // For unit testing we return the range unchanged so we can assert on
  // the geometry the handler emits without a real worksheet.
  const clampMock = jest.fn().mockImplementation(async (r: CellRange) => r);

  const mockWorksheet = {
    formats: { setRanges: setRangesMock },
    layout: {
      getHiddenRowsBitmap: jest.fn(async () => bitmapHiddenRows),
      getHiddenColumnsBitmap: jest.fn(async () => bitmapHiddenCols),
      isRowHidden: jest.fn(async (row: number) => hiddenRows.has(row)),
      isColumnHidden: jest.fn(async (col: number) => hiddenCols.has(col)),
    },
    _internal: { clampRangeToDataBounds: clampMock },
  };

  const mockUIStore = {
    getState: () => ({
      // Direct-mode (payload provided) never reads pendingBorder*; values
      // here are just to satisfy the type if the handler accidentally falls
      // through to UIStore mode.
      pendingBorderFormat: null,
      pendingBorderPreset: null,
      setLastUsedBorderFormat: setLastUsedBorderFormatMock,
      clearPendingBorderFormat: jest.fn(),
      clearPendingBorderPreset: jest.fn(),
    }),
  };

  const deps = {
    workbook: {
      activeSheet: mockWorksheet,
      getSheetById: jest.fn().mockReturnValue(mockWorksheet),
    },
    getActiveSheetId: jest.fn().mockReturnValue(activeSheetId),
    uiStore: mockUIStore,
    accessors: {
      selection: {
        getActiveCell: jest.fn().mockReturnValue({ row: 0, col: 0 }),
        getRanges: jest.fn().mockReturnValue(opts.ranges),
      },
    },
  } as unknown as ActionDependencies;

  return { deps, setRangesMock, setLastUsedBorderFormatMock };
}

const thinBlack = { style: 'thin' as const, color: '#000000' };
const outlineBorders: CellBorders = {
  top: thinBlack,
  right: thinBlack,
  bottom: thinBlack,
  left: thinBlack,
};

// =============================================================================
// Tests
// =============================================================================

describe('APPLY_BORDERS — direct-mode preset routing', () => {
  it("preset 'outline' on a 3×3 emits four edge ranges (perimeter), not nine cells", async () => {
    const range: CellRange = { startRow: 0, startCol: 0, endRow: 2, endCol: 2 };
    const { deps, setRangesMock } = createMockDeps({ ranges: [range] });

    await APPLY_BORDERS(deps, { borders: outlineBorders, preset: 'outline' });

    // Four calls — one per edge — each writing exactly one edge style.
    expect(setRangesMock).toHaveBeenCalledTimes(4);

    const calls = setRangesMock.mock.calls.map((c: unknown[]) => ({
      ranges: c[0] as CellRange[],
      payload: c[1] as { borders?: CellBorders },
    }));

    // Top edge: row 0, full width
    expect(calls).toContainEqual({
      ranges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 2 }],
      payload: { borders: { top: thinBlack } },
    });
    // Bottom edge: row 2, full width
    expect(calls).toContainEqual({
      ranges: [{ startRow: 2, startCol: 0, endRow: 2, endCol: 2 }],
      payload: { borders: { bottom: thinBlack } },
    });
    // Left edge: col 0, full height
    expect(calls).toContainEqual({
      ranges: [{ startRow: 0, startCol: 0, endRow: 2, endCol: 0 }],
      payload: { borders: { left: thinBlack } },
    });
    // Right edge: col 2, full height
    expect(calls).toContainEqual({
      ranges: [{ startRow: 0, startCol: 2, endRow: 2, endCol: 2 }],
      payload: { borders: { right: thinBlack } },
    });

    // Critical: NO call writes all four sides to the full 3×3, which is
    // what happened pre-fix when the preset was dropped from the payload.
    for (const call of calls) {
      const r = call.ranges[0];
      const isFullRange = r.startRow === 0 && r.startCol === 0 && r.endRow === 2 && r.endCol === 2;
      expect(isFullRange && Object.keys(call.payload.borders ?? {}).length === 4).toBe(false);
    }
  });

  it("preset 'outline' treats hidden-column gaps as visible perimeter boundaries", async () => {
    const range: CellRange = { startRow: 0, startCol: 0, endRow: 2, endCol: 4 };
    const { deps, setRangesMock } = createMockDeps({
      ranges: [range],
      hiddenCols: [2, 3],
      bitmapHiddenCols: [],
    });

    await APPLY_BORDERS(deps, { borders: outlineBorders, preset: 'outline' });

    const calls = setRangesMock.mock.calls.map((c: unknown[]) => ({
      ranges: c[0] as CellRange[],
      payload: c[1] as { borders?: CellBorders },
    }));

    expect(calls).toContainEqual({
      ranges: [{ startRow: 0, startCol: 1, endRow: 2, endCol: 1 }],
      payload: { borders: { right: thinBlack } },
    });
    expect(calls).toContainEqual({
      ranges: [{ startRow: 0, startCol: 4, endRow: 2, endCol: 4 }],
      payload: { borders: { left: thinBlack } },
    });
  });

  it("preset 'outline' formats a selected range even when all rows are hidden", async () => {
    const range: CellRange = { startRow: 10, startCol: 0, endRow: 12, endCol: 2 };
    const { deps, setRangesMock } = createMockDeps({
      ranges: [range],
      hiddenRows: [10, 11, 12],
    });

    await APPLY_BORDERS(deps, { borders: outlineBorders, preset: 'outline' });

    const calls = setRangesMock.mock.calls.map((c: unknown[]) => ({
      ranges: c[0] as CellRange[],
      payload: c[1] as { borders?: CellBorders },
    }));

    expect(calls).toContainEqual({
      ranges: [{ startRow: 10, startCol: 0, endRow: 10, endCol: 2 }],
      payload: { borders: { top: thinBlack } },
    });
    expect(calls).toContainEqual({
      ranges: [{ startRow: 12, startCol: 0, endRow: 12, endCol: 2 }],
      payload: { borders: { bottom: thinBlack } },
    });
    expect(calls).toContainEqual({
      ranges: [{ startRow: 10, startCol: 0, endRow: 12, endCol: 0 }],
      payload: { borders: { left: thinBlack } },
    });
    expect(calls).toContainEqual({
      ranges: [{ startRow: 10, startCol: 2, endRow: 12, endCol: 2 }],
      payload: { borders: { right: thinBlack } },
    });
  });

  it('preset null (no preset) on a multi-cell range applies borders per-cell', async () => {
    const range: CellRange = { startRow: 0, startCol: 0, endRow: 1, endCol: 1 };
    const { deps, setRangesMock } = createMockDeps({ ranges: [range] });

    await APPLY_BORDERS(deps, {
      borders: { bottom: thinBlack },
      preset: null,
    });

    // Single setRanges call across the whole 2×2 with the bottom border.
    expect(setRangesMock).toHaveBeenCalledTimes(1);
    expect(setRangesMock).toHaveBeenCalledWith([range], { borders: { bottom: thinBlack } });
  });

  it("preset 'none' clears borders on every cell with one call", async () => {
    const range: CellRange = { startRow: 0, startCol: 0, endRow: 4, endCol: 4 };
    const { deps, setRangesMock } = createMockDeps({ ranges: [range] });

    // The "No Border" preset emits the {style:'none'} shape (not empty {}),
    // and the handler's 'none' branch clears via an explicit empty borders patch.
    await APPLY_BORDERS(deps, {
      borders: {
        top: { style: 'none' },
        right: { style: 'none' },
        bottom: { style: 'none' },
        left: { style: 'none' },
      },
      preset: 'none',
    });

    expect(setRangesMock).toHaveBeenCalledTimes(1);
    expect(setRangesMock).toHaveBeenCalledWith([range], { borders: {} });
  });

  it('records the payload as last-used on every direct-mode apply', async () => {
    const range: CellRange = { startRow: 0, startCol: 0, endRow: 0, endCol: 0 };
    const { deps, setLastUsedBorderFormatMock } = createMockDeps({ ranges: [range] });

    const payload = { borders: outlineBorders, preset: 'outline' as const };
    await APPLY_BORDERS(deps, payload);

    expect(setLastUsedBorderFormatMock).toHaveBeenCalledTimes(1);
    expect(setLastUsedBorderFormatMock).toHaveBeenCalledWith({
      borders: outlineBorders,
      preset: 'outline',
    });
  });

  it('records "No Border" as last-used (not skipped, unlike null colors)', async () => {
    const range: CellRange = { startRow: 0, startCol: 0, endRow: 0, endCol: 0 };
    const { deps, setLastUsedBorderFormatMock } = createMockDeps({ ranges: [range] });

    const noBorder = {
      borders: {
        top: { style: 'none' as const },
        right: { style: 'none' as const },
        bottom: { style: 'none' as const },
        left: { style: 'none' as const },
      },
      preset: 'none' as const,
    };
    await APPLY_BORDERS(deps, noBorder);

    expect(setLastUsedBorderFormatMock).toHaveBeenCalledTimes(1);
    expect(setLastUsedBorderFormatMock).toHaveBeenCalledWith(noBorder);
  });

  it('treats payload with explicit `preset: undefined` as preset null', async () => {
    // Backward-compat: existing toolbar callers don't pass preset, so
    // payload.preset is undefined. Handler must treat it as null
    // (per-cell apply), not blow up.
    const range: CellRange = { startRow: 0, startCol: 0, endRow: 0, endCol: 0 };
    const { deps, setRangesMock } = createMockDeps({ ranges: [range] });

    await APPLY_BORDERS(deps, { borders: { bottom: thinBlack } });

    expect(setRangesMock).toHaveBeenCalledTimes(1);
    expect(setRangesMock).toHaveBeenCalledWith([range], { borders: { bottom: thinBlack } });
  });
});
