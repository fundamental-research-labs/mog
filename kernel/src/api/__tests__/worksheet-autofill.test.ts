/**
 * WorksheetImpl AutoFill & FillSeries Unit Tests
 *
 * Tests:
 * 1. autoFill() — delegation, mode passing, invalid ranges, return shape
 * 2. fillSeries() — delegation, options passthrough, invalid ranges
 * 3. fill-operations internals — computeDirection, modeToFlags, bridge call shape
 */

import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import { KernelError } from '../../errors';
import type { WorksheetImpl as WorksheetImplClass } from '../worksheet/worksheet-impl';
import type { AutoFillMode, FillSeriesOptions } from '@mog-sdk/contracts/fill';
import { installWorksheetImplEsmMocks } from './helpers/worksheet-impl-esm-mocks';

// ---------------------------------------------------------------------------
// Mock transitive dependencies (same pattern as worksheet-impl.test.ts)
// ---------------------------------------------------------------------------

installWorksheetImplEsmMocks();

// Import the mocked fill-operations for assertions
const { WorksheetImpl } = await import('../worksheet/worksheet-impl');
const FillOps = await import('../worksheet/operations/fill-operations');

async function importActualFillOps(): Promise<
  typeof import('../worksheet/operations/fill-operations')
> {
  let realFillOps!: typeof import('../worksheet/operations/fill-operations');
  await jest.isolateModulesAsync(async () => {
    jest.unstable_unmockModule('../worksheet/operations/fill-operations');
    realFillOps = await import('../worksheet/operations/fill-operations');
  });
  return realFillOps;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SHEET_ID = sheetId('sheet-1');

function createMockCtx(): any {
  return {
    writeGate: {
      assertWritable: jest.fn(),
    },
    computeBridge: {
      setCell: jest.fn().mockResolvedValue({ success: true }),
      getCell: jest.fn().mockResolvedValue(undefined),
      setCells: jest.fn(),
      setCellsByPosition: jest.fn().mockResolvedValue(undefined),
      getCellIdAtPosition: jest.fn().mockResolvedValue(null),
      getCellFormat: jest.fn().mockResolvedValue(null),
      getDataBounds: jest.fn().mockResolvedValue(null),
      getRowHeight: jest.fn().mockResolvedValue(20),
      setRowHeight: jest.fn().mockResolvedValue(undefined),
      getRowHeightQuery: jest.fn().mockResolvedValue(20),
      getColWidthQuery: jest.fn().mockResolvedValue(80),
      getColWidth: jest.fn().mockResolvedValue(80),
      setColWidth: jest.fn().mockResolvedValue(undefined),
      getColWidthCharsQuery: jest.fn().mockResolvedValue(8.43),
      setColWidthChars: jest.fn().mockResolvedValue(undefined),
      getColWidthsBatchChars: jest.fn().mockResolvedValue([]),
      getDefaultColWidthChars: jest.fn().mockResolvedValue(8.43),
      hideRows: jest.fn().mockResolvedValue(undefined),
      unhideRows: jest.fn().mockResolvedValue(undefined),
      hideColumns: jest.fn().mockResolvedValue(undefined),
      unhideColumns: jest.fn().mockResolvedValue(undefined),
      isRowHidden: jest.fn().mockResolvedValue(false),
      isColHidden: jest.fn().mockResolvedValue(false),
      isRowHiddenQuery: jest.fn().mockResolvedValue(false),
      isColHiddenQuery: jest.fn().mockResolvedValue(false),
      setRowFormat: jest.fn(),
      setColFormat: jest.fn(),
      setCellFormatForRanges: jest.fn(),
      setFormatForRanges: jest.fn().mockResolvedValue(undefined),
      clearFormatForRanges: jest.fn().mockResolvedValue(undefined),
      getFrozenPanes: jest.fn().mockResolvedValue({ rows: 0, cols: 0 }),
      getFrozenPanesQuery: jest.fn().mockResolvedValue({ rows: 0, cols: 0 }),
      setFrozenPanes: jest.fn().mockResolvedValue(undefined),
      getSheetProtectionOptions: jest.fn().mockResolvedValue(null),
      hasSheetProtectionPassword: jest.fn().mockResolvedValue(false),
      isSheetProtected: jest.fn().mockResolvedValue(false),
      protectSheet: jest.fn().mockResolvedValue(undefined),
      unprotectSheet: jest.fn().mockResolvedValue(undefined),
      insertCellsWithShift: jest.fn().mockResolvedValue(undefined),
      deleteCellsWithShift: jest.fn().mockResolvedValue(undefined),
      prepareDateValue: jest.fn().mockResolvedValue({ serial: 44927, formatToApply: null }),
      prepareTimeValue: jest.fn().mockResolvedValue({ serial: 0.5, formatToApply: null }),
      relocateCells: jest.fn().mockResolvedValue(undefined),
      getProjectionRange: jest.fn().mockResolvedValue(null),
      getProjectionSource: jest.fn().mockResolvedValue(null),
      isProjectedPosition: jest.fn().mockResolvedValue(false),
      queryRange: jest.fn().mockResolvedValue({ cells: [], merges: [] }),
      addComment: jest.fn().mockResolvedValue(undefined),
      getCommentsForCell: jest.fn().mockResolvedValue([]),
      deleteComment: jest.fn().mockResolvedValue(undefined),
      getAllComments: jest.fn().mockResolvedValue([]),
      getComment: jest.fn().mockResolvedValue(null),
      updateComment: jest.fn().mockResolvedValue(undefined),
      setThreadResolved: jest.fn().mockResolvedValue(undefined),
      getCommentThread: jest.fn().mockResolvedValue([]),
      autoFill: jest.fn().mockResolvedValue(undefined),
      beginUndoGroup: jest.fn().mockResolvedValue(undefined),
      endUndoGroup: jest.fn().mockResolvedValue(undefined),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorksheetImpl — autoFill', () => {
  let ws: WorksheetImplClass;
  let ctx: any;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx = createMockCtx();
    ws = new WorksheetImpl(SHEET_ID, ctx);

    // Default mock for FillOps.autoFill
    (FillOps.autoFill as jest.Mock).mockResolvedValue({
      patternType: 'linear',
      filledCellCount: 7,
      warnings: [],
    });

    // Default mock for FillOps.fillSeries
    (FillOps.fillSeries as jest.Mock).mockResolvedValue(undefined);
  });

  // =========================================================================
  // autoFill — delegation & parsing
  // =========================================================================

  it('delegates to FillOps.autoFill with correctly parsed ranges', async () => {
    await ws.autoFill('A1:A3', 'A4:A10');

    expect(FillOps.autoFill).toHaveBeenCalledWith(
      expect.anything(), // ctx
      SHEET_ID,
      { startRow: 0, startCol: 0, endRow: 2, endCol: 0 }, // A1:A3
      { startRow: 3, startCol: 0, endRow: 9, endCol: 0 }, // A4:A10
      'auto',
    );
  });

  it('passes explicit mode through to FillOps.autoFill', async () => {
    await ws.autoFill('A1:A3', 'A4:A10', 'copy');

    expect(FillOps.autoFill).toHaveBeenCalledWith(
      expect.anything(),
      SHEET_ID,
      expect.objectContaining({ startRow: 0, startCol: 0 }),
      expect.objectContaining({ startRow: 3, startCol: 0 }),
      'copy',
    );
  });

  it('defaults mode to "auto" when not specified', async () => {
    await ws.autoFill('B2:D2', 'E2:H2');

    expect(FillOps.autoFill).toHaveBeenCalledWith(
      expect.anything(),
      SHEET_ID,
      { startRow: 1, startCol: 1, endRow: 1, endCol: 3 }, // B2:D2
      { startRow: 1, startCol: 4, endRow: 1, endCol: 7 }, // E2:H2
      'auto',
    );
  });

  it.each<AutoFillMode>([
    'auto',
    'copy',
    'series',
    'days',
    'weekdays',
    'months',
    'years',
    'formats',
    'values',
    'withoutFormats',
    'linearTrend',
    'growthTrend',
  ])('accepts mode "%s"', async (mode) => {
    await ws.autoFill('A1:A3', 'A4:A10', mode);

    expect(FillOps.autoFill).toHaveBeenCalledWith(
      expect.anything(),
      SHEET_ID,
      expect.any(Object),
      expect.any(Object),
      mode,
    );
  });

  it('throws KernelError for invalid source range', async () => {
    await expect(ws.autoFill('INVALID', 'A4:A10')).rejects.toThrow(KernelError);
  });

  it('throws KernelError for invalid target range', async () => {
    await expect(ws.autoFill('A1:A3', 'INVALID')).rejects.toThrow(KernelError);
  });

  it('returns AutoFillResult from FillOps', async () => {
    const mockResult = {
      patternType: 'date' as const,
      filledCellCount: 14,
      warnings: [{ row: 5, col: 0, kind: { type: 'sourceCellEmpty' as const } }],
    };
    (FillOps.autoFill as jest.Mock).mockResolvedValue(mockResult);

    const result = await ws.autoFill('A1:A3', 'A4:A10');

    expect(result).toEqual(mockResult);
    expect(result.patternType).toBe('date');
    expect(result.filledCellCount).toBe(14);
    expect(result.warnings).toHaveLength(1);
  });
});

// ===========================================================================
// fillSeries
// ===========================================================================

describe('WorksheetImpl — fillSeries', () => {
  let ws: WorksheetImplClass;
  let ctx: any;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx = createMockCtx();
    ws = new WorksheetImpl(SHEET_ID, ctx);

    (FillOps.autoFill as jest.Mock).mockResolvedValue({
      patternType: 'linear',
      filledCellCount: 0,
      warnings: [],
    });
    (FillOps.fillSeries as jest.Mock).mockResolvedValue(undefined);
  });

  it('delegates to FillOps.fillSeries with parsed range and options', async () => {
    const options: FillSeriesOptions = {
      direction: 'down',
      seriesType: 'linear',
      stepValue: 1,
    };

    await ws.fillSeries('A1:A10', options);

    expect(FillOps.fillSeries).toHaveBeenCalledWith(
      expect.anything(), // ctx
      SHEET_ID,
      { startRow: 0, startCol: 0, endRow: 9, endCol: 0 }, // A1:A10
      options,
    );
  });

  it('throws KernelError for invalid range', async () => {
    const options: FillSeriesOptions = {
      direction: 'down',
      seriesType: 'linear',
      stepValue: 1,
    };

    await expect(ws.fillSeries('INVALID', options)).rejects.toThrow(KernelError);
  });

  it('passes direction, seriesType, stepValue, dateUnit through', async () => {
    const options: FillSeriesOptions = {
      direction: 'right',
      seriesType: 'date',
      stepValue: 7,
      dateUnit: 'month',
      trend: false,
    };

    await ws.fillSeries('B2:F2', options);

    expect(FillOps.fillSeries).toHaveBeenCalledWith(
      expect.anything(),
      SHEET_ID,
      { startRow: 1, startCol: 1, endRow: 1, endCol: 5 }, // B2:F2
      options,
    );
  });

  it('passes stopValue and trend options through', async () => {
    const options: FillSeriesOptions = {
      direction: 'down',
      seriesType: 'growth',
      stepValue: 2,
      stopValue: 1000,
      trend: true,
    };

    await ws.fillSeries('C1:C20', options);

    expect(FillOps.fillSeries).toHaveBeenCalledWith(
      expect.anything(),
      SHEET_ID,
      { startRow: 0, startCol: 2, endRow: 19, endCol: 2 }, // C1:C20
      options,
    );
  });
});

// ===========================================================================
// fill-operations.ts internals (imported directly, NOT through worksheet)
// ===========================================================================

describe('fill-operations — unit tests', () => {
  let ctx: any;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx = createMockCtx();

    // Restore real implementations for the fill-operations module
    // We need to reimport to get the real module, but since it's mocked globally,
    // we test the internals through integration (calling autoFill/fillSeries directly).
  });

  // Since FillOps is globally mocked, bridge integration tests import an isolated
  // unmocked ESM copy of the real module.

  describe('computeDirection (tested via autoFill bridge call)', () => {
    let realFillOps: typeof FillOps;

    beforeEach(async () => {
      realFillOps = await importActualFillOps();
    });

    it('source above target → direction "down"', async () => {
      const source = { startRow: 0, startCol: 0, endRow: 2, endCol: 0 };
      const target = { startRow: 3, startCol: 0, endRow: 9, endCol: 0 };

      await realFillOps.autoFill(ctx, SHEET_ID, source, target, 'auto');

      expect(ctx.computeBridge.autoFill).toHaveBeenCalledWith(
        SHEET_ID,
        expect.objectContaining({ direction: 'down' }),
      );
    });

    it('source below target → direction "up"', async () => {
      const source = { startRow: 5, startCol: 0, endRow: 7, endCol: 0 };
      const target = { startRow: 0, startCol: 0, endRow: 4, endCol: 0 };

      await realFillOps.autoFill(ctx, SHEET_ID, source, target, 'auto');

      expect(ctx.computeBridge.autoFill).toHaveBeenCalledWith(
        SHEET_ID,
        expect.objectContaining({ direction: 'up' }),
      );
    });

    it('source left of target → direction "right"', async () => {
      const source = { startRow: 0, startCol: 0, endRow: 0, endCol: 2 };
      const target = { startRow: 0, startCol: 3, endRow: 0, endCol: 7 };

      await realFillOps.autoFill(ctx, SHEET_ID, source, target, 'auto');

      expect(ctx.computeBridge.autoFill).toHaveBeenCalledWith(
        SHEET_ID,
        expect.objectContaining({ direction: 'right' }),
      );
    });

    it('source right of target → direction "left"', async () => {
      const source = { startRow: 0, startCol: 5, endRow: 0, endCol: 7 };
      const target = { startRow: 0, startCol: 0, endRow: 0, endCol: 4 };

      await realFillOps.autoFill(ctx, SHEET_ID, source, target, 'auto');

      expect(ctx.computeBridge.autoFill).toHaveBeenCalledWith(
        SHEET_ID,
        expect.objectContaining({ direction: 'left' }),
      );
    });
  });

  describe('modeToFlags (tested via autoFill bridge call)', () => {
    let realFillOps: typeof FillOps;

    beforeEach(async () => {
      realFillOps = await importActualFillOps();
    });

    it('"formats" → only includeFormats=true', async () => {
      const source = { startRow: 0, startCol: 0, endRow: 2, endCol: 0 };
      const target = { startRow: 3, startCol: 0, endRow: 9, endCol: 0 };

      await realFillOps.autoFill(ctx, SHEET_ID, source, target, 'formats');

      expect(ctx.computeBridge.autoFill).toHaveBeenCalledWith(
        SHEET_ID,
        expect.objectContaining({
          includeFormulas: false,
          includeValues: false,
          includeFormats: true,
        }),
      );
    });

    it('"values" → includeFormats=false', async () => {
      const source = { startRow: 0, startCol: 0, endRow: 2, endCol: 0 };
      const target = { startRow: 3, startCol: 0, endRow: 9, endCol: 0 };

      await realFillOps.autoFill(ctx, SHEET_ID, source, target, 'values');

      expect(ctx.computeBridge.autoFill).toHaveBeenCalledWith(
        SHEET_ID,
        expect.objectContaining({
          includeFormulas: true,
          includeValues: true,
          includeFormats: false,
        }),
      );
    });

    it('"withoutFormats" → includeFormats=false', async () => {
      const source = { startRow: 0, startCol: 0, endRow: 2, endCol: 0 };
      const target = { startRow: 3, startCol: 0, endRow: 9, endCol: 0 };

      await realFillOps.autoFill(ctx, SHEET_ID, source, target, 'withoutFormats');

      expect(ctx.computeBridge.autoFill).toHaveBeenCalledWith(
        SHEET_ID,
        expect.objectContaining({
          includeFormulas: true,
          includeValues: true,
          includeFormats: false,
        }),
      );
    });

    it('default mode → all flags true', async () => {
      const source = { startRow: 0, startCol: 0, endRow: 2, endCol: 0 };
      const target = { startRow: 3, startCol: 0, endRow: 9, endCol: 0 };

      await realFillOps.autoFill(ctx, SHEET_ID, source, target, 'auto');

      expect(ctx.computeBridge.autoFill).toHaveBeenCalledWith(
        SHEET_ID,
        expect.objectContaining({
          includeFormulas: true,
          includeValues: true,
          includeFormats: true,
        }),
      );
    });
  });

  describe('bridge call shape', () => {
    let realFillOps: typeof FillOps;

    beforeEach(async () => {
      realFillOps = await importActualFillOps();
    });

    it('autoFill passes sourceRange, targetRange, direction, mode, and flags to bridge', async () => {
      const source = { startRow: 0, startCol: 0, endRow: 2, endCol: 0 };
      const target = { startRow: 3, startCol: 0, endRow: 9, endCol: 0 };

      await realFillOps.autoFill(ctx, SHEET_ID, source, target, 'copy');

      expect(ctx.computeBridge.autoFill).toHaveBeenCalledTimes(1);
      expect(ctx.computeBridge.autoFill).toHaveBeenCalledWith(SHEET_ID, {
        sourceRange: { startRow: 0, startCol: 0, endRow: 2, endCol: 0 },
        targetRange: { startRow: 3, startCol: 0, endRow: 9, endCol: 0 },
        direction: 'down',
        mode: 'copy',
        stepValue: 1,
        includeFormulas: true,
        includeValues: true,
        includeFormats: true,
      });
    });

    it('autoFill wraps the bridge mutation in one undo group', async () => {
      const source = { startRow: 0, startCol: 0, endRow: 0, endCol: 0 };
      const target = { startRow: 1, startCol: 0, endRow: 4, endCol: 0 };

      await realFillOps.autoFill(ctx, SHEET_ID, source, target, 'copy');

      expect(ctx.computeBridge.beginUndoGroup).toHaveBeenCalledTimes(1);
      expect(ctx.computeBridge.endUndoGroup).toHaveBeenCalledTimes(1);
      const beginOrder = ctx.computeBridge.beginUndoGroup.mock.invocationCallOrder[0];
      const fillOrder = ctx.computeBridge.autoFill.mock.invocationCallOrder[0];
      const endOrder = ctx.computeBridge.endUndoGroup.mock.invocationCallOrder[0];
      expect(beginOrder).toBeLessThan(fillOrder);
      expect(fillOrder).toBeLessThan(endOrder);
    });

    it('autoFill ends the undo group when the bridge throws', async () => {
      const source = { startRow: 0, startCol: 0, endRow: 0, endCol: 0 };
      const target = { startRow: 1, startCol: 0, endRow: 4, endCol: 0 };
      ctx.computeBridge.autoFill.mockRejectedValueOnce(new Error('bridge failed'));

      await expect(realFillOps.autoFill(ctx, SHEET_ID, source, target, 'copy')).rejects.toThrow(
        'bridge failed',
      );

      expect(ctx.computeBridge.beginUndoGroup).toHaveBeenCalledTimes(1);
      expect(ctx.computeBridge.endUndoGroup).toHaveBeenCalledTimes(1);
    });

    it('fillSeries passes split ranges and series mode to bridge', async () => {
      const range = { startRow: 0, startCol: 0, endRow: 9, endCol: 0 };
      const options: FillSeriesOptions = {
        direction: 'down',
        seriesType: 'linear',
        stepValue: 1,
      };

      await realFillOps.fillSeries(ctx, SHEET_ID, range, options);

      expect(ctx.computeBridge.autoFill).toHaveBeenCalledTimes(1);
      expect(ctx.computeBridge.autoFill).toHaveBeenCalledWith(SHEET_ID, {
        sourceRange: { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
        targetRange: { startRow: 1, startCol: 0, endRow: 9, endCol: 0 },
        direction: 'down',
        mode: 'series', // linear + no trend = 'series'
        includeFormulas: false,
        includeValues: true,
        includeFormats: false,
        stepValue: 1,
      });
    });

    it('fillSeries wraps the bridge mutation in one undo group', async () => {
      const range = { startRow: 0, startCol: 0, endRow: 9, endCol: 0 };
      const options: FillSeriesOptions = {
        direction: 'down',
        seriesType: 'linear',
        stepValue: 1,
      };

      await realFillOps.fillSeries(ctx, SHEET_ID, range, options);

      expect(ctx.computeBridge.beginUndoGroup).toHaveBeenCalledTimes(1);
      expect(ctx.computeBridge.endUndoGroup).toHaveBeenCalledTimes(1);
      const beginOrder = ctx.computeBridge.beginUndoGroup.mock.invocationCallOrder[0];
      const fillOrder = ctx.computeBridge.autoFill.mock.invocationCallOrder[0];
      const endOrder = ctx.computeBridge.endUndoGroup.mock.invocationCallOrder[0];
      expect(beginOrder).toBeLessThan(fillOrder);
      expect(fillOrder).toBeLessThan(endOrder);
    });

    it('fillSeries with date/month maps to "months" mode', async () => {
      const range = { startRow: 0, startCol: 0, endRow: 9, endCol: 0 };
      const options: FillSeriesOptions = {
        direction: 'down',
        seriesType: 'date',
        stepValue: 1,
        dateUnit: 'month',
      };

      await realFillOps.fillSeries(ctx, SHEET_ID, range, options);

      expect(ctx.computeBridge.autoFill).toHaveBeenCalledWith(
        SHEET_ID,
        expect.objectContaining({ mode: 'months' }),
      );
    });

    it('fillSeries with linear + trend maps to "linearTrend" mode', async () => {
      const range = { startRow: 0, startCol: 0, endRow: 9, endCol: 0 };
      const options: FillSeriesOptions = {
        direction: 'down',
        seriesType: 'linear',
        stepValue: 1,
        trend: true,
      };

      await realFillOps.fillSeries(ctx, SHEET_ID, range, options);

      expect(ctx.computeBridge.autoFill).toHaveBeenCalledWith(
        SHEET_ID,
        expect.objectContaining({ mode: 'linearTrend' }),
      );
    });

    it('fillSeries with growth maps to "growthTrend" mode', async () => {
      const range = { startRow: 0, startCol: 0, endRow: 9, endCol: 0 };
      const options: FillSeriesOptions = {
        direction: 'down',
        seriesType: 'growth',
        stepValue: 2,
      };

      await realFillOps.fillSeries(ctx, SHEET_ID, range, options);

      expect(ctx.computeBridge.autoFill).toHaveBeenCalledWith(
        SHEET_ID,
        expect.objectContaining({ mode: 'growthTrend' }),
      );
    });

    it('fillSeries throws for single-row range with vertical direction', async () => {
      const range = { startRow: 5, startCol: 0, endRow: 5, endCol: 3 };
      const options: FillSeriesOptions = {
        direction: 'down',
        seriesType: 'linear',
        stepValue: 1,
      };

      await expect(realFillOps.fillSeries(ctx, SHEET_ID, range, options)).rejects.toThrow(
        'Fill series requires at least 2 rows for vertical fill',
      );
    });

    it('fillSeries throws for single-col range with horizontal direction', async () => {
      const range = { startRow: 0, startCol: 3, endRow: 5, endCol: 3 };
      const options: FillSeriesOptions = {
        direction: 'right',
        seriesType: 'linear',
        stepValue: 1,
      };

      await expect(realFillOps.fillSeries(ctx, SHEET_ID, range, options)).rejects.toThrow(
        'Fill series requires at least 2 columns for horizontal fill',
      );
    });
  });

  describe('return value', () => {
    let realFillOps: typeof FillOps;

    beforeEach(async () => {
      realFillOps = await importActualFillOps();
      ctx = createMockCtx();
    });

    it('autoFill returns filledCellCount from bridge result', async () => {
      ctx.computeBridge.autoFill.mockResolvedValue({
        data: { patternType: 'linear', filledCellCount: 7, warnings: [] },
      });

      const source = { startRow: 0, startCol: 0, endRow: 2, endCol: 0 };
      const target = { startRow: 3, startCol: 0, endRow: 9, endCol: 0 };

      const result = await realFillOps.autoFill(ctx, SHEET_ID, source, target, 'auto');

      expect(result.filledCellCount).toBe(7);
    });

    it('autoFill returns patternType from bridge result', async () => {
      ctx.computeBridge.autoFill.mockResolvedValue({
        data: { patternType: 'linear', filledCellCount: 7, warnings: [] },
      });

      const source = { startRow: 0, startCol: 0, endRow: 2, endCol: 0 };
      const target = { startRow: 3, startCol: 0, endRow: 9, endCol: 0 };

      const result = await realFillOps.autoFill(ctx, SHEET_ID, source, target, 'auto');

      expect(result.patternType).toBe('linear');
    });

    it('autoFill returns warnings from bridge result', async () => {
      const warnings = [
        { row: 3, col: 0, kind: { type: 'sourceCellEmpty' as const } },
        { row: 5, col: 0, kind: { type: 'sourceCellEmpty' as const } },
      ];
      ctx.computeBridge.autoFill.mockResolvedValue({
        data: { patternType: 'linear', filledCellCount: 7, warnings },
      });

      const source = { startRow: 0, startCol: 0, endRow: 2, endCol: 0 };
      const target = { startRow: 3, startCol: 0, endRow: 9, endCol: 0 };

      const result = await realFillOps.autoFill(ctx, SHEET_ID, source, target, 'auto');

      expect(result.warnings).toEqual(warnings);
    });
  });
});
