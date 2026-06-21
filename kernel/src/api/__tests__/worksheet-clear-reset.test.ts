/**
 * Tests for WorksheetImpl.clearOrResetContents()
 *
 * Verifies that:
 * 1. Cells not linked to form controls are cleared normally
 * 2. Checkbox-linked cells are reset to false
 * 3. ComboBox-linked cells are reset to empty string
 * 4. Mixed ranges handle both linked and non-linked cells
 * 5. Invalid ranges throw
 */

import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import { KernelError } from '../../errors';
import type { WorksheetImpl as WorksheetImplClass } from '../worksheet/worksheet-impl';
import { installWorksheetImplEsmMocks } from './helpers/worksheet-impl-esm-mocks';

// ---------------------------------------------------------------------------
// Mock operation modules (same pattern as worksheet-impl.test.ts)
// ---------------------------------------------------------------------------

installWorksheetImplEsmMocks();

const { WorksheetImpl } = await import('../worksheet/worksheet-impl');
const CellOps = await import('../worksheet/operations/cell-operations');
const RangeQueryOps = await import('../worksheet/operations/range-query-operations');

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
      getResolvedFormat: jest.fn().mockResolvedValue({}),
      addComment: jest.fn().mockResolvedValue(undefined),
      getCommentsForCell: jest.fn().mockResolvedValue([]),
      deleteComment: jest.fn().mockResolvedValue(undefined),
      getAllComments: jest.fn().mockResolvedValue([]),
      getComment: jest.fn().mockResolvedValue(null),
      updateComment: jest.fn().mockResolvedValue(undefined),
      setThreadResolved: jest.fn().mockResolvedValue(undefined),
      getCommentThread: jest.fn().mockResolvedValue([]),
      getCellPosition: jest.fn().mockResolvedValue(null),
    },
  };
}

interface MockFormControlManager {
  getControlsForSheet: jest.Mock;
  getControl: jest.Mock;
  getControlsAtPosition: jest.Mock;
}

function createMockWorkbook(formControlManager: MockFormControlManager): any {
  return {
    getFormControlManager: () => formControlManager,
  };
}

function createMockFormControlManager(): MockFormControlManager {
  return {
    getControlsForSheet: jest.fn().mockReturnValue([]),
    getControl: jest.fn().mockReturnValue(undefined),
    getControlsAtPosition: jest.fn().mockReturnValue([]),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorksheetImpl.clearOrResetContents', () => {
  let ws: WorksheetImplClass;
  let ctx: any;
  let fcManager: MockFormControlManager;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx = createMockCtx();
    fcManager = createMockFormControlManager();
    const mockWorkbook = createMockWorkbook(fcManager);
    ws = new WorksheetImpl(SHEET_ID, ctx, { workbook: mockWorkbook });

    // Mock RangeQueryOps.clearWithMode to succeed
    (RangeQueryOps.clearWithMode as jest.Mock).mockResolvedValue({ cleared: true });
  });

  it('clears contents normally when no form controls exist', async () => {
    fcManager.getControlsForSheet.mockReturnValue([]);

    await ws.clearOrResetContents('A1:C3');

    // Should call clear with 'contents' mode
    expect(RangeQueryOps.clearWithMode).toHaveBeenCalledWith(
      ctx,
      SHEET_ID,
      expect.objectContaining({
        sheetId: SHEET_ID,
        startRow: 0,
        startCol: 0,
        endRow: 2,
        endCol: 2,
      }),
      'contents',
      expect.objectContaining({
        operationContext: expect.objectContaining({
          operationId: expect.stringMatching(/^worksheet\.clear:/),
          domainIds: ['cells'],
          capturePolicy: 'commitEligible',
          writeAdmissionMode: 'capture',
        }),
      }),
    );

    // Should NOT call setCell for resets since there are no controls
    expect(CellOps.setCell).not.toHaveBeenCalled();
  });

  it('resets checkbox-linked cell to false after clearing', async () => {
    const checkboxControl = {
      id: 'ctrl-1',
      type: 'checkbox' as const,
      sheetId: SHEET_ID,
      linkedCellId: 'cell-id-b2',
      anchor: { cellId: 'anchor-1' },
      width: 20,
      height: 20,
      enabled: true,
      zIndex: 0,
    };

    fcManager.getControlsForSheet.mockReturnValue([checkboxControl]);

    // linkedCellId 'cell-id-b2' resolves to row 1, col 1 (B2)
    ctx.computeBridge.getCellPosition.mockResolvedValue({ row: 1, col: 1 });

    await ws.clearOrResetContents('A1:C3');

    // Should clear contents
    expect(RangeQueryOps.clearWithMode).toHaveBeenCalledWith(
      ctx,
      SHEET_ID,
      expect.objectContaining({ startRow: 0, startCol: 0, endRow: 2, endCol: 2 }),
      'contents',
      expect.objectContaining({
        operationContext: expect.objectContaining({
          operationId: expect.stringMatching(/^worksheet\.clear:/),
          domainIds: ['cells'],
          capturePolicy: 'commitEligible',
          writeAdmissionMode: 'capture',
        }),
      }),
    );

    // Should reset checkbox cell to false
    expect(CellOps.setCell).toHaveBeenCalledWith(ctx, SHEET_ID, 1, 1, false);
  });

  it('resets comboBox-linked cell to empty string after clearing', async () => {
    const comboControl = {
      id: 'ctrl-2',
      type: 'comboBox' as const,
      sheetId: SHEET_ID,
      linkedCellId: 'cell-id-a1',
      items: ['Option A', 'Option B'],
      anchor: { cellId: 'anchor-2' },
      width: 100,
      height: 24,
      enabled: true,
      zIndex: 0,
    };

    fcManager.getControlsForSheet.mockReturnValue([comboControl]);

    // linkedCellId resolves to row 0, col 0 (A1)
    ctx.computeBridge.getCellPosition.mockResolvedValue({ row: 0, col: 0 });

    await ws.clearOrResetContents('A1:A1');

    // Should clear contents
    expect(RangeQueryOps.clearWithMode).toHaveBeenCalled();

    // Should reset comboBox cell to empty string
    expect(CellOps.setCell).toHaveBeenCalledWith(ctx, SHEET_ID, 0, 0, '');
  });

  it('handles mixed range: clears non-linked cells, resets linked cells', async () => {
    const checkboxControl = {
      id: 'ctrl-1',
      type: 'checkbox' as const,
      sheetId: SHEET_ID,
      linkedCellId: 'cell-id-b2',
      anchor: { cellId: 'anchor-1' },
      width: 20,
      height: 20,
      enabled: true,
      zIndex: 0,
    };

    const buttonControl = {
      id: 'ctrl-3',
      type: 'button' as const,
      sheetId: SHEET_ID,
      linkedCellId: 'cell-id-c3',
      label: 'Click me',
      anchor: { cellId: 'anchor-3' },
      width: 80,
      height: 24,
      enabled: true,
      zIndex: 1,
    };

    fcManager.getControlsForSheet.mockReturnValue([checkboxControl, buttonControl]);

    // checkbox linked to B2 (row 1, col 1) — inside range
    // button linked to C3 (row 2, col 2) — inside range
    ctx.computeBridge.getCellPosition
      .mockResolvedValueOnce({ row: 1, col: 1 }) // checkbox
      .mockResolvedValueOnce({ row: 2, col: 2 }); // button

    await ws.clearOrResetContents('A1:C3');

    // Should clear all contents
    expect(RangeQueryOps.clearWithMode).toHaveBeenCalledTimes(1);

    // Should reset checkbox to false, but NOT reset button (buttons have no value to reset)
    expect(CellOps.setCell).toHaveBeenCalledTimes(1);
    expect(CellOps.setCell).toHaveBeenCalledWith(ctx, SHEET_ID, 1, 1, false);
  });

  it('does not reset linked cells outside the cleared range', async () => {
    const checkboxControl = {
      id: 'ctrl-1',
      type: 'checkbox' as const,
      sheetId: SHEET_ID,
      linkedCellId: 'cell-id-d4',
      anchor: { cellId: 'anchor-1' },
      width: 20,
      height: 20,
      enabled: true,
      zIndex: 0,
    };

    fcManager.getControlsForSheet.mockReturnValue([checkboxControl]);

    // linkedCellId resolves to row 3, col 3 (D4) — OUTSIDE range A1:C3
    ctx.computeBridge.getCellPosition.mockResolvedValue({ row: 3, col: 3 });

    await ws.clearOrResetContents('A1:C3');

    // Should clear contents
    expect(RangeQueryOps.clearWithMode).toHaveBeenCalled();

    // Should NOT reset the checkbox since it's outside the range
    expect(CellOps.setCell).not.toHaveBeenCalled();
  });

  it('throws on invalid range string', async () => {
    await expect(ws.clearOrResetContents('INVALID')).rejects.toThrow(KernelError);
  });
});
