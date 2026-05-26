/**
 * WorksheetImpl.getFormulaArray() Unit Tests
 *
 * Tests the getFormulaArray method which returns the array formula
 * for cells that are part of a dynamic array spill:
 * - Spill source cells return their own formula
 * - Spill member (projected) cells return the source cell's formula
 * - Regular formula cells return null
 * - Empty cells return null
 * - Both A1 and numeric overloads work correctly
 */

import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import type { WorksheetImpl as WorksheetImplClass } from '../worksheet/worksheet-impl';
import { installWorksheetImplEsmMocks } from './helpers/worksheet-impl-esm-mocks';

// ---------------------------------------------------------------------------
// Mock operation modules
// ---------------------------------------------------------------------------

installWorksheetImplEsmMocks();

const { WorksheetImpl } = await import('../worksheet/worksheet-impl');
const CellOps = await import('../worksheet/operations/cell-operations');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SHEET_ID = sheetId('sheet-1');

function createMockCtx(): any {
  return {
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
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorksheetImpl.getFormulaArray', () => {
  let ws: WorksheetImplClass;
  let ctx: any;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx = createMockCtx();
    ws = new WorksheetImpl(SHEET_ID, ctx);
  });

  it('returns the formula for a spill source cell (cell with =SEQUENCE(5) that has projections)', async () => {
    // Cell A1 (0,0) is NOT a projected position — it is the source
    (CellOps.isProjectedPosition as jest.Mock).mockResolvedValue(false);
    // Cell has a projection range, indicating it is a spill source
    (CellOps.getProjectionRange as jest.Mock).mockResolvedValue({
      startRow: 0,
      startCol: 0,
      endRow: 4,
      endCol: 0,
    });
    (CellOps.getFormula as jest.Mock).mockResolvedValue('=SEQUENCE(5)');

    const result = await ws.getFormulaArray('A1');

    expect(result).toBe('=SEQUENCE(5)');
    expect(CellOps.isProjectedPosition).toHaveBeenCalledWith(ctx, SHEET_ID, 0, 0);
    expect(CellOps.getProjectionRange).toHaveBeenCalledWith(ctx, SHEET_ID, 0, 0);
    expect(CellOps.getFormula).toHaveBeenCalledWith(ctx, SHEET_ID, 0, 0);
  });

  it('returns the source formula for a spill member (projected) cell', async () => {
    // Cell A3 (2,0) is a projected position — spill member
    (CellOps.isProjectedPosition as jest.Mock).mockResolvedValue(true);
    // Its source is A1 (0,0)
    (CellOps.getProjectionSource as jest.Mock).mockResolvedValue({ row: 0, col: 0 });
    (CellOps.getFormula as jest.Mock).mockResolvedValue('=SEQUENCE(5)');

    const result = await ws.getFormulaArray('A3');

    expect(result).toBe('=SEQUENCE(5)');
    expect(CellOps.isProjectedPosition).toHaveBeenCalledWith(ctx, SHEET_ID, 2, 0);
    expect(CellOps.getProjectionSource).toHaveBeenCalledWith(ctx, SHEET_ID, 2, 0);
    // Formula is fetched from the source cell
    expect(CellOps.getFormula).toHaveBeenCalledWith(ctx, SHEET_ID, 0, 0);
  });

  it('returns null for a cell with a regular (non-array) formula', async () => {
    // Cell B1 (0,1) is not projected
    (CellOps.isProjectedPosition as jest.Mock).mockResolvedValue(false);
    // Cell has no projection range (not a spill source)
    (CellOps.getProjectionRange as jest.Mock).mockResolvedValue(null);

    const result = await ws.getFormulaArray('B1');

    expect(result).toBeNull();
    expect(CellOps.getFormula).not.toHaveBeenCalled();
  });

  it('returns null for an empty cell', async () => {
    (CellOps.isProjectedPosition as jest.Mock).mockResolvedValue(false);
    (CellOps.getProjectionRange as jest.Mock).mockResolvedValue(null);

    const result = await ws.getFormulaArray('C5');

    expect(result).toBeNull();
  });

  it('works with numeric (row, col) overload', async () => {
    // Row 2, col 0 = A3 — a projected spill member
    (CellOps.isProjectedPosition as jest.Mock).mockResolvedValue(true);
    (CellOps.getProjectionSource as jest.Mock).mockResolvedValue({ row: 0, col: 0 });
    (CellOps.getFormula as jest.Mock).mockResolvedValue('=SEQUENCE(5)');

    const result = await ws.getFormulaArray(2, 0);

    expect(result).toBe('=SEQUENCE(5)');
    expect(CellOps.isProjectedPosition).toHaveBeenCalledWith(ctx, SHEET_ID, 2, 0);
    expect(CellOps.getProjectionSource).toHaveBeenCalledWith(ctx, SHEET_ID, 2, 0);
    expect(CellOps.getFormula).toHaveBeenCalledWith(ctx, SHEET_ID, 0, 0);
  });

  it('works with A1 overload for spill source', async () => {
    (CellOps.isProjectedPosition as jest.Mock).mockResolvedValue(false);
    (CellOps.getProjectionRange as jest.Mock).mockResolvedValue({
      startRow: 0,
      startCol: 0,
      endRow: 4,
      endCol: 0,
    });
    (CellOps.getFormula as jest.Mock).mockResolvedValue('=SEQUENCE(5)');

    const result = await ws.getFormulaArray(0, 0);

    expect(result).toBe('=SEQUENCE(5)');
    expect(CellOps.isProjectedPosition).toHaveBeenCalledWith(ctx, SHEET_ID, 0, 0);
    expect(CellOps.getProjectionRange).toHaveBeenCalledWith(ctx, SHEET_ID, 0, 0);
    expect(CellOps.getFormula).toHaveBeenCalledWith(ctx, SHEET_ID, 0, 0);
  });

  it('returns null when projected but getProjectionSource returns null', async () => {
    // Edge case: isProjectedPosition is true but getProjectionSource fails
    (CellOps.isProjectedPosition as jest.Mock).mockResolvedValue(true);
    (CellOps.getProjectionSource as jest.Mock).mockResolvedValue(null);

    const result = await ws.getFormulaArray('A2');

    expect(result).toBeNull();
    expect(CellOps.getFormula).not.toHaveBeenCalled();
  });

  it('returns null when spill source formula is undefined', async () => {
    // Spill source cell where getFormula returns undefined (edge case)
    (CellOps.isProjectedPosition as jest.Mock).mockResolvedValue(false);
    (CellOps.getProjectionRange as jest.Mock).mockResolvedValue({
      startRow: 0,
      startCol: 0,
      endRow: 4,
      endCol: 0,
    });
    (CellOps.getFormula as jest.Mock).mockResolvedValue(undefined);

    const result = await ws.getFormulaArray('A1');

    expect(result).toBeNull();
  });
});
