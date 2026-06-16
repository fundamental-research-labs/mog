import { describe, expect, it, jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';

import { EXECUTE_FILL_SERIES } from '../fill-series-dialog';
import { executeFillViaWorksheet } from '../types';

const sourceRange = { startRow: 0, startCol: 0, endRow: 1, endCol: 0 };
const targetRange = { startRow: 2, startCol: 0, endRow: 3, endCol: 0 };

function autoFillReceipt(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'autofill.apply',
    status: 'applied',
    effects: [],
    diagnostics: [],
    mode: 'auto',
    patternType: 'linear',
    filledCellCount: 2,
    warnings: [],
    changes: [],
    ...overrides,
  };
}

function autoFillPreviewReceipt(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'autofill.preview',
    status: 'completed',
    effects: [],
    diagnostics: [],
    mode: 'auto',
    worksheetChanged: false,
    undoChanged: false,
    patternType: 'linear',
    filledCellCount: 2,
    warnings: [],
    changes: [],
    formulas: [],
    referenceDiagnostics: [],
    ...overrides,
  };
}

function fillSeriesReceipt(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'fillSeries.apply',
    status: 'applied',
    effects: [],
    diagnostics: [],
    mode: 'series',
    options: {
      direction: 'down',
      seriesType: 'linear',
      stepValue: 1,
    },
    patternType: 'linear',
    filledCellCount: 2,
    warnings: [],
    changes: [],
    ...overrides,
  };
}

function createFillSeriesDeps(fillSeries: jest.Mock): ActionDependencies {
  const closeFillSeriesDialog = jest.fn();
  return {
    uiStore: {
      getState: () => ({
        fillSeriesDialog: {
          sourceRange: { startRow: 0, startCol: 0, endRow: 2, endCol: 0 },
          pendingOptions: {
            direction: 'down',
            seriesType: 'linear',
            step: 1,
          },
        },
        closeFillSeriesDialog,
      }),
    },
    getActiveSheetId: () => 'sheet-1',
    workbook: {
      getSheetById: jest.fn().mockReturnValue({
        protection: {
          canEditCell: jest.fn().mockResolvedValue(true),
        },
        fillSeries,
      }),
    },
  } as unknown as ActionDependencies;
}

describe('fill receipt consumers', () => {
  it('threads autofill preview diagnostics into the computed fill result', async () => {
    const autoFillPreview = jest.fn().mockResolvedValue(
      autoFillPreviewReceipt({
        diagnostics: [
          {
            severity: 'warning',
            code: 'AUTOFILL_FORMULA_REFERENCE_OUT_OF_BOUNDS',
            message: 'A formula reference will move out of bounds.',
            target: { row: 2, col: 0 },
          },
        ],
        referenceDiagnostics: [
          {
            refIndex: 1,
            row: 3,
            col: 0,
            targetRow: -1,
            targetCol: 0,
            targetEndRow: null,
            targetEndCol: null,
            outOfBounds: true,
          },
        ],
      }),
    );
    const autoFill = jest.fn().mockResolvedValue(
      autoFillReceipt({
        warnings: [{ row: 3, col: 0, kind: { type: 'sourceCellEmpty' } }],
      }),
    );

    const result = await executeFillViaWorksheet(
      { autoFill, autoFillPreview } as any,
      sourceRange,
      targetRange,
      'sheet-1',
      {
        direction: 'down',
        fillType: 'all',
        seriesType: 'auto',
        includeFormulas: true,
        includeValues: true,
        includeFormats: true,
        smartFill: true,
      },
    );

    expect(autoFillPreview).toHaveBeenCalledWith('A1:A2', 'A3:A4', 'auto');
    expect(autoFill).toHaveBeenCalledWith('A1:A2', 'A3:A4', 'auto');
    expect(result.success).toBe(true);
    expect(result.updates.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          row: 2,
          col: 0,
          error: 'A formula reference will move out of bounds.',
          type: 'warning',
        }),
        expect.objectContaining({
          row: 3,
          col: 0,
          error: 'Formula reference out of bounds (ref 1)',
          type: 'warning',
        }),
        expect.objectContaining({
          row: 3,
          col: 0,
          error: 'Source cell is empty',
          type: 'warning',
        }),
      ]),
    );
  });

  it('reports non-success autofill apply receipts instead of treating them as success', async () => {
    const autoFillPreview = jest.fn().mockResolvedValue(autoFillPreviewReceipt());
    const autoFill = jest.fn().mockResolvedValue(
      autoFillReceipt({
        status: 'partial',
        diagnostics: [
          {
            severity: 'error',
            code: 'AUTOFILL_PARTIAL',
            message: 'Only part of the range was filled.',
            target: { row: 2, col: 0 },
          },
        ],
      }),
    );

    const result = await executeFillViaWorksheet(
      { autoFill, autoFillPreview } as any,
      sourceRange,
      targetRange,
      'sheet-1',
      {
        direction: 'down',
        fillType: 'all',
        seriesType: 'auto',
        includeFormulas: true,
        includeValues: true,
        includeFormats: true,
        smartFill: true,
      },
    );

    expect(result.success).toBe(false);
    expect(result.updates.errors).toEqual([
      {
        row: 2,
        col: 0,
        error: 'Only part of the range was filled.',
        type: 'error',
      },
    ]);
  });

  it('reports partial Fill Series receipts instead of closing as a successful fill', async () => {
    const fillSeries = jest.fn().mockResolvedValue(
      fillSeriesReceipt({
        status: 'partial',
        diagnostics: [
          {
            severity: 'error',
            code: 'FILL_SERIES_PARTIAL',
            message: 'Only part of the series was filled.',
          },
        ],
      }),
    );
    const deps = createFillSeriesDeps(fillSeries);

    await expect(EXECUTE_FILL_SERIES(deps)).resolves.toEqual({
      handled: true,
      error: 'Only part of the series was filled.',
    });

    expect(fillSeries).toHaveBeenCalledWith(
      'A1:A3',
      expect.objectContaining({
        direction: 'down',
        seriesType: 'linear',
        stepValue: 1,
      }),
    );
  });
});
