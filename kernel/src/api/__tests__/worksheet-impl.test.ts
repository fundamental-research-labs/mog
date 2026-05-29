/**
 * WorksheetImpl Core Unit Tests
 *
 * Tests the core operations of WorksheetImpl:
 * 1. Cell read/write with A1 overload
 * 2. Cell read/write with numeric overload
 * 3. Range operations
 * 4. Formatting
 * 5. Structure (insert/delete rows/columns)
 * 6. Protection checks
 * 7. describe() — LLM presentation
 * 8. describeRange() — tabular formatted string
 * 9. summarize() — sheet overview
 *
 * All operation modules are mocked. This tests WorksheetImpl's delegation
 * logic, overload resolution, and unwrap behavior.
 */

import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import { KernelError } from '../../errors';

// ---------------------------------------------------------------------------
// Mock operation modules
// ---------------------------------------------------------------------------

// Mock transitive dependencies first to prevent ESM import chain issues
jest.unstable_mockModule('../../floating-objects', () => ({
  createSpreadsheetObjectManager: jest.fn(),
}));
jest.unstable_mockModule('../../context', () => ({}));
jest.unstable_mockModule('../workbook/operations/sheet-crud-operations', () => ({
  renameSheet: jest.fn(),
  setSheetHidden: jest.fn(),
}));

// Mock operation modules (still transitively loaded by production code).
// ESM Jest no longer turns automocked TS module exports into jest.fn reliably,
// so keep these suites on explicit factories.
jest.unstable_mockModule('../worksheet/operations/cell-operations', () => ({
  getCell: jest.fn(),
  getValue: jest.fn(),
  getDisplayValue: jest.fn(),
  getFormula: jest.fn(),
  getFormat: jest.fn(),
  getRawCellData: jest.fn(),
  getFormulaBarValue: jest.fn(),
  setCell: jest.fn(),
  setCells: jest.fn(),
  setFormula: jest.fn(),
  setDateValue: jest.fn(),
  setTimeValue: jest.fn(),
  getCellIdAt: jest.fn(),
  getProjectionRange: jest.fn(),
  getProjectionSource: jest.fn(),
  isProjectedPosition: jest.fn(),
}));
jest.unstable_mockModule('../worksheet/operations/range-operations', () => ({
  getRange: jest.fn(),
  setRange: jest.fn(),
  clearRange: jest.fn(),
}));
jest.unstable_mockModule('../worksheet/operations/format-operations', () => ({
  setFormat: jest.fn(),
  setRangeFormat: jest.fn(),
  setFormatForRanges: jest.fn(),
  setRowFormat: jest.fn(),
  setColFormat: jest.fn(),
  clearFormat: jest.fn(),
  applyFormatToRange: jest.fn(),
  getRowProperties: jest.fn(),
  setRowProperties: jest.fn(),
  getColumnProperties: jest.fn(),
  setColumnProperties: jest.fn(),
  getCellProperties: jest.fn(),
  setCellProperties: jest.fn(),
  getDisplayedCellProperties: jest.fn(),
  getDisplayedRangeProperties: jest.fn(),
}));
jest.unstable_mockModule('../worksheet/operations/merge-operations', () => ({
  getMergeAt: jest.fn(),
}));
jest.unstable_mockModule('../worksheet/operations/query-operations', () => ({
  getUsedRange: jest.fn(),
  findCells: jest.fn(),
  findByValue: jest.fn(),
  findByFormula: jest.fn(),
  getSelectionAggregates: jest.fn(),
  formatValues: jest.fn(),
}));
jest.unstable_mockModule('../worksheet/operations/hyperlink-operations', () => ({
  getHyperlink: jest.fn(),
  setHyperlink: jest.fn(),
  removeHyperlink: jest.fn(),
}));
jest.unstable_mockModule('../worksheet/operations/dependency-operations', () => ({
  getPrecedents: jest.fn(),
  getDependents: jest.fn(),
}));
jest.unstable_mockModule('../worksheet/operations/validation-operations', () => ({
  getDropdownItems: jest.fn(),
  resolveDropdownItems: jest.fn(),
}));
jest.unstable_mockModule('../worksheet/operations/filter-operations', () => ({}));
jest.unstable_mockModule('../worksheet/operations/shape-operations', () => ({}));
jest.unstable_mockModule('../worksheet/operations/floating-object-operations', () => ({}));
jest.unstable_mockModule('../worksheet/operations/sort-operations', () => ({}));
jest.unstable_mockModule('../worksheet/operations/cf-operations', () => ({}));
jest.unstable_mockModule('../worksheet/operations/grouping-operations', () => ({}));
jest.unstable_mockModule('../worksheet/operations/equation-operations', () => ({
  DEFAULT_EQUATION_WIDTH: 150,
  DEFAULT_EQUATION_HEIGHT: 50,
}));
jest.unstable_mockModule('../worksheet/operations/text-effects-operations', () => ({
  DEFAULT_TEXT_EFFECT_WIDTH: 300,
  DEFAULT_TEXT_EFFECT_HEIGHT: 100,
  createDefaultApiTextEffectConfig: jest.fn(() => ({})),
  createTextEffect: jest.fn(),
  updateTextEffect: jest.fn(),
  convertToTextEffect: jest.fn(),
  convertToTextBox: jest.fn(),
}));
jest.unstable_mockModule('../worksheet/operations/sheet-management-operations', () => ({}));
jest.unstable_mockModule('../worksheet/operations/table-operations', () => ({
  bridgeTableToTableInfo: jest.fn(),
  getTableAtCell: jest.fn(),
  getTableByName: jest.fn(),
  getAllTablesInSheet: jest.fn(),
  getTableHitRegion: jest.fn(),
  removeTable: jest.fn(),
  resizeTable: jest.fn(),
  setTableStyle: jest.fn(),
  renameTable: jest.fn(),
  addTableColumn: jest.fn(),
  removeTableColumn: jest.fn(),
  createTable: jest.fn(),
  toggleTotalsRow: jest.fn(),
  toggleHeaderRow: jest.fn(),
  applyAutoExpansion: jest.fn(),
  getTableColumnDataCellsFromInfo: jest.fn(),
  getDataBodyRangeFromInfo: jest.fn(),
  getHeaderRowRangeFromInfo: jest.fn(),
  getTotalRowRangeFromInfo: jest.fn(),
  setCalculatedColumnFormula: jest.fn(),
  clearCalculatedColumnFormula: jest.fn(),
}));
jest.unstable_mockModule('../worksheet/operations/drawing-operations', () => ({}));
jest.unstable_mockModule('../worksheet/operations/fill-operations', () => ({}));

jest.unstable_mockModule('../../domain/cells/cell-iteration', () => ({
  computeValueToRaw: jest.fn((value) => value ?? null),
  computeValueToCellValue: jest.fn((value) => value),
  clearRange: jest.fn(),
  clearRangeAndReturnIds: jest.fn(),
  relocateCells: jest.fn(),
  forEach: jest.fn(),
  forEachInRange: jest.fn(),
  getCurrentRegion: jest.fn(),
  getDataBoundsForRange: jest.fn(),
}));
jest.unstable_mockModule('../../domain/charts', () => ({ getAll: jest.fn() }));
jest.unstable_mockModule('../../domain/formulas/named-ranges', () => ({
  getVisible: jest.fn(async (ctx: any) => ctx?.__apiTestNamedRanges ?? []),
  getRefersToA1: jest.fn(async (ctx: any, name: unknown) => {
    const resolveA1 = ctx?.__apiTestNamedRangeA1;
    return typeof resolveA1 === 'function' ? await resolveA1(name) : '';
  }),
}));
jest.unstable_mockModule('../../domain/sheets/sheet-meta', () => ({ getMeta: jest.fn() }));
jest.unstable_mockModule('../../domain/tables/core', () => ({
  getTablesInSheet: jest.fn(async (ctx: any, sheetId: unknown) => {
    const getAllTablesInSheet = ctx?.computeBridge?.getAllTablesInSheet;
    return typeof getAllTablesInSheet === 'function' ? await getAllTablesInSheet(sheetId) : [];
  }),
  getTable: jest.fn(),
}));
jest.unstable_mockModule('../../domain/sheets/structures', () => ({
  insertRows: jest.fn(),
  deleteRows: jest.fn(),
  insertColumns: jest.fn(),
  deleteColumns: jest.fn(),
}));
jest.unstable_mockModule('../../domain/formatting/merges', () => ({
  getAll: jest.fn(),
  mergeRange: jest.fn(),
  unmergeRange: jest.fn(),
}));
jest.unstable_mockModule('../internal/format-utils', () => ({
  MAX_RANGE_CELLS: 10_000,
  MAX_RANGE_BOUNDING_BOX: 500_000,
  MAX_DESCRIBE_OUTPUT_CHARS: 50_000,
  MAX_SUMMARY_NAMED_RANGES: 20,
  analyzeFormulas: jest.fn(),
  buildStyleHintsFromFormat: jest.fn(),
  extractTintAndShade: jest.fn(),
  getFontTintAndShade: jest.fn(),
  getBackgroundTintAndShade: jest.fn(),
  getPatternForegroundTintAndShade: jest.fn(),
  generateFormulaDocumentation: jest.fn(),
  getStyleHints: jest.fn(),
  normalizeFormula: jest.fn(),
}));

// Import mocked modules for assertions after ESM mocks are registered.
const { WorksheetImpl } = await import('../worksheet/worksheet-impl');
const Charts = await import('../../domain/charts');
const { getMeta } = await import('../../domain/sheets/sheet-meta');
const { analyzeFormulas, generateFormulaDocumentation, getStyleHints } =
  await import('../internal/format-utils');
const CellOps = await import('../worksheet/operations/cell-operations');
const DependencyOps = await import('../worksheet/operations/dependency-operations');
const HyperlinkOps = await import('../worksheet/operations/hyperlink-operations');
const MergeOps = await import('../worksheet/operations/merge-operations');
const QueryOps = await import('../worksheet/operations/query-operations');
const RangeOps = await import('../worksheet/operations/range-operations');
const Structures = await import('../../domain/sheets/structures');
const Merges = await import('../../domain/formatting/merges');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SHEET_ID = sheetId('sheet-1');

function createMockCtx(): any {
  return {
    __apiTestNamedRanges: [],
    __apiTestNamedRangeA1: jest.fn().mockResolvedValue(''),
    writeGate: {
      assertWritable: jest.fn(),
    },
    eventBus: {
      onMany: jest.fn(() => jest.fn()),
    },
    mirror: {
      getFrozenPanes: jest.fn().mockReturnValue({ rows: 0, cols: 0 }),
      getSheetSettings: jest.fn().mockReturnValue({ isProtected: false }),
      getViewOptions: jest.fn().mockReturnValue({
        showGridlines: true,
        showRowHeaders: true,
        showColumnHeaders: true,
      }),
    },
    computeBridge: {
      setCell: jest.fn().mockResolvedValue({ success: true }),
      getCell: jest.fn().mockResolvedValue(undefined),
      getSheetName: jest.fn().mockResolvedValue(null),
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
      setColWidths: jest.fn().mockResolvedValue(undefined),
      getColWidthCharsQuery: jest.fn().mockResolvedValue(8.43),
      setColWidthChars: jest.fn().mockResolvedValue(undefined),
      setColWidthsChars: jest.fn().mockResolvedValue(undefined),
      getColWidthsBatch: jest.fn().mockResolvedValue([]),
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
      setFormatForRanges: jest.fn().mockResolvedValue({ propertyChanges: [] }),
      clearFormatForRanges: jest.fn().mockResolvedValue(undefined),
      getFrozenPanes: jest.fn().mockResolvedValue({ rows: 0, cols: 0 }),
      getFrozenPanesQuery: jest.fn().mockResolvedValue({ rows: 0, cols: 0 }),
      setFrozenPanes: jest.fn().mockResolvedValue(undefined),
      freezeRows: jest.fn().mockResolvedValue(undefined),
      freezeColumns: jest.fn().mockResolvedValue(undefined),
      getSheetProtectionOptions: jest.fn().mockResolvedValue(null),
      hasSheetProtectionPassword: jest.fn().mockResolvedValue(false),
      isSheetProtected: jest.fn().mockResolvedValue(false),
      canEditCell: jest.fn().mockResolvedValue(true),
      canDoStructureOp: jest.fn().mockResolvedValue(true),
      protectSheet: jest.fn().mockResolvedValue(undefined),
      unprotectSheet: jest.fn().mockResolvedValue(undefined),
      structureChange: jest.fn().mockResolvedValue({ structureChanges: [] }),
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
      addCommentByPosition: jest.fn().mockResolvedValue(undefined),
      getCommentsForCell: jest.fn().mockResolvedValue([]),
      getCommentsForCellByPosition: jest.fn().mockResolvedValue([]),
      deleteComment: jest.fn().mockResolvedValue(undefined),
      getAllComments: jest.fn().mockResolvedValue([]),
      getComment: jest.fn().mockResolvedValue(null),
      updateComment: jest.fn().mockResolvedValue(undefined),
      setThreadResolved: jest.fn().mockResolvedValue(undefined),
      getCommentThread: jest.fn().mockResolvedValue([]),
      getSheetVisibility: jest.fn().mockResolvedValue('visible'),
      tableValidateTableName: jest.fn().mockResolvedValue({ valid: true }),
      getAllTablesInSheet: jest.fn().mockResolvedValue([]),
      mergeRange: jest.fn().mockResolvedValue(undefined),
      unmergeRange: jest.fn().mockResolvedValue(undefined),
      getAllMergesInSheet: jest.fn().mockResolvedValue([]),
      invalidateAllViewportPrefetch: jest.fn(),
      forceRefreshAllViewports: jest.fn().mockResolvedValue(undefined),
    },
  };
}

function _createWorksheet(ctx?: any): InstanceType<typeof WorksheetImpl> {
  return new WorksheetImpl(SHEET_ID, ctx ?? createMockCtx());
}

// ---------------------------------------------------------------------------
// Test Groups
// ---------------------------------------------------------------------------

describe('WorksheetImpl', () => {
  let ws: InstanceType<typeof WorksheetImpl>;
  let ctx: any;

  beforeEach(() => {
    jest.clearAllMocks();
    (Charts.getAll as jest.Mock).mockResolvedValue([]);
    (getMeta as jest.Mock).mockResolvedValue({
      name: 'TestSheet',
      frozenRows: 0,
      frozenCols: 0,
    });
    ctx = createMockCtx();
    ws = new WorksheetImpl(SHEET_ID, ctx);
  });

  // =========================================================================
  // 1. Cell read/write — A1 overload
  // =========================================================================

  describe('Cell read/write — A1 overload', () => {
    it('setCell("A1", value) resolves to (0, 0) and delegates to CellOps.setCell', async () => {
      (CellOps.setCell as jest.Mock).mockResolvedValue(undefined);

      await ws.setCell('A1', 'hello');

      expect(CellOps.setCell).toHaveBeenCalledWith(ctx, SHEET_ID, 0, 0, 'hello');
    });

    it('setCell("B3", 42) resolves to (2, 1) and delegates to CellOps.setCell', async () => {
      (CellOps.setCell as jest.Mock).mockResolvedValue(undefined);

      await ws.setCell('B3', 42);

      expect(CellOps.setCell).toHaveBeenCalledWith(ctx, SHEET_ID, 2, 1, 42);
    });

    it('setCell("A1", value, { asFormula: true }) prepends = to non-formula string', async () => {
      (CellOps.setCell as jest.Mock).mockResolvedValue(undefined);

      await ws.setCell('A1', 'SUM(A1:A10)', { asFormula: true });

      expect(CellOps.setCell).toHaveBeenCalledWith(ctx, SHEET_ID, 0, 0, '=SUM(A1:A10)');
    });

    it('setCell("A1", "=SUM(A1:A10)", { asFormula: true }) does not double-prepend =', async () => {
      (CellOps.setCell as jest.Mock).mockResolvedValue(undefined);

      await ws.setCell('A1', '=SUM(A1:A10)', { asFormula: true });

      expect(CellOps.setCell).toHaveBeenCalledWith(ctx, SHEET_ID, 0, 0, '=SUM(A1:A10)');
    });

    it('setCell throws KernelError when operation fails', async () => {
      (CellOps.setCell as jest.Mock).mockRejectedValue(
        new KernelError('COMPUTE_ERROR', 'write failed'),
      );

      await expect(ws.setCell('A1', 'value')).rejects.toThrow(KernelError);
      await expect(ws.setCell('A1', 'value')).rejects.toThrow('write failed');
    });

    it('getCell("A1") resolves to (0, 0) and delegates to CellOps.getCell', async () => {
      (CellOps.getCell as jest.Mock).mockResolvedValue({ value: 'hello', formula: undefined });

      const result = await ws.getCell('A1');

      expect(CellOps.getCell).toHaveBeenCalledWith(ctx, SHEET_ID, 0, 0);
      expect(result).toEqual({ value: 'hello', formula: undefined });
    });

    it('getCell("A1") returns { value: null } when cell is empty', async () => {
      (CellOps.getCell as jest.Mock).mockResolvedValue(undefined);

      const result = await ws.getCell('A1');

      expect(result).toEqual({ value: null });
    });

    it('getFormula("A1") resolves to (0, 0) and returns formula', async () => {
      (CellOps.getFormula as jest.Mock).mockResolvedValue('SUM(B1:B10)');

      const result = await ws.getFormula('A1');

      expect(CellOps.getFormula).toHaveBeenCalledWith(ctx, SHEET_ID, 0, 0);
      expect(result).toBe('SUM(B1:B10)');
    });

    it('getFormula("A1") returns null when no formula', async () => {
      (CellOps.getFormula as jest.Mock).mockResolvedValue(undefined);

      const result = await ws.getFormula('A1');

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // 2. Cell read/write — numeric overload
  // =========================================================================

  describe('Cell read/write — numeric overload', () => {
    it('setCell(0, 0, value) uses direct numeric path', async () => {
      (CellOps.setCell as jest.Mock).mockResolvedValue(undefined);

      await ws.setCell(0, 0, 'hello');

      expect(CellOps.setCell).toHaveBeenCalledWith(ctx, SHEET_ID, 0, 0, 'hello');
    });

    it('setCell(5, 3, 100) passes correct row/col', async () => {
      (CellOps.setCell as jest.Mock).mockResolvedValue(undefined);

      await ws.setCell(5, 3, 100);

      expect(CellOps.setCell).toHaveBeenCalledWith(ctx, SHEET_ID, 5, 3, 100);
    });

    it('setCell(0, 0, value, { asFormula: true }) prepends =', async () => {
      (CellOps.setCell as jest.Mock).mockResolvedValue(undefined);

      await ws.setCell(0, 0, 'A1+B1', { asFormula: true });

      expect(CellOps.setCell).toHaveBeenCalledWith(ctx, SHEET_ID, 0, 0, '=A1+B1');
    });

    it('getCell(0, 0) uses numeric path', async () => {
      (CellOps.getCell as jest.Mock).mockResolvedValue({ value: 42, formula: undefined });

      const result = await ws.getCell(0, 0);

      expect(CellOps.getCell).toHaveBeenCalledWith(ctx, SHEET_ID, 0, 0);
      expect(result).toEqual({ value: 42, formula: undefined });
    });

    it('getCell(2, 3) returns data for correct cell', async () => {
      (CellOps.getCell as jest.Mock).mockResolvedValue({ value: true, formula: undefined });

      const result = await ws.getCell(2, 3);

      expect(CellOps.getCell).toHaveBeenCalledWith(ctx, SHEET_ID, 2, 3);
      expect(result).toEqual({ value: true, formula: undefined });
    });

    it('getFormula(1, 2) uses numeric path', async () => {
      (CellOps.getFormula as jest.Mock).mockResolvedValue('A1+B1');

      const result = await ws.getFormula(1, 2);

      expect(CellOps.getFormula).toHaveBeenCalledWith(ctx, SHEET_ID, 1, 2);
      expect(result).toBe('A1+B1');
    });

    it('setDateValue delegates to CellOps.setDateValue with year/month/day', async () => {
      (CellOps.setDateValue as jest.Mock).mockResolvedValue(undefined);

      const date = new Date(2024, 0, 15); // Jan 15, 2024
      await ws.setDateValue(0, 0, date);

      expect(CellOps.setDateValue).toHaveBeenCalledWith(ctx, SHEET_ID, 0, 0, {
        year: 2024,
        month: 1,
        day: 15,
      });
    });

    it('setTimeValue delegates to CellOps.setTimeValue with hours/minutes/seconds', async () => {
      (CellOps.setTimeValue as jest.Mock).mockResolvedValue(undefined);

      const date = new Date(2024, 0, 1, 14, 30, 45);
      await ws.setTimeValue(0, 0, date);

      expect(CellOps.setTimeValue).toHaveBeenCalledWith(ctx, SHEET_ID, 0, 0, {
        hours: 14,
        minutes: 30,
        seconds: 45,
      });
    });
  });

  // =========================================================================
  // 3. Range operations
  // =========================================================================

  describe('Range operations', () => {
    it('getRange("A1:B2") resolves A1 range and delegates to RangeOps.getRange', async () => {
      const mockData = [
        [{ value: 1 }, { value: 2 }],
        [{ value: 3 }, { value: 4 }],
      ];
      (RangeOps.getRange as jest.Mock).mockResolvedValue(mockData);

      const result = await ws.getRange('A1:B2');

      expect(RangeOps.getRange).toHaveBeenCalledWith(ctx, SHEET_ID, {
        sheetId: SHEET_ID,
        startRow: 0,
        startCol: 0,
        endRow: 1,
        endCol: 1,
      });
      expect(result).toEqual(mockData);
    });

    it('getRange(0, 0, 1, 1) uses numeric bounds directly', async () => {
      const mockData = [
        [{ value: 'a' }, { value: 'b' }],
        [{ value: 'c' }, { value: 'd' }],
      ];
      (RangeOps.getRange as jest.Mock).mockResolvedValue(mockData);

      const result = await ws.getRange(0, 0, 1, 1);

      expect(RangeOps.getRange).toHaveBeenCalledWith(ctx, SHEET_ID, {
        sheetId: SHEET_ID,
        startRow: 0,
        startCol: 0,
        endRow: 1,
        endCol: 1,
      });
      expect(result).toEqual(mockData);
    });

    it('setRange("A1:B2", values) resolves A1 range and delegates to RangeOps.setRange', async () => {
      (RangeOps.setRange as jest.Mock).mockResolvedValue(undefined);

      const values = [
        ['a', 'b'],
        ['c', 'd'],
      ];
      await ws.setRange('A1:B2', values);

      expect(RangeOps.setRange).toHaveBeenCalledWith(ctx, SHEET_ID, 0, 0, values);
    });

    it('setRange(0, 0, values) uses numeric path', async () => {
      (RangeOps.setRange as jest.Mock).mockResolvedValue(undefined);

      const values = [[1, 2]];
      await ws.setRange(0, 0, values);

      expect(RangeOps.setRange).toHaveBeenCalledWith(ctx, SHEET_ID, 0, 0, values);
    });

    it('setRange throws KernelError on failure', async () => {
      (RangeOps.setRange as jest.Mock).mockRejectedValue(
        new KernelError('COMPUTE_ERROR', 'range write failed'),
      );

      await expect(ws.setRange('A1:B2', [['x']])).rejects.toThrow(KernelError);
    });

    it('setRange with invalid A1 range throws KernelError', async () => {
      await expect(ws.setRange('invalid', [['x']])).rejects.toThrow(KernelError);
      await expect(ws.setRange('invalid', [['x']])).rejects.toThrow('Invalid range');
    });

    it('clearData("A1:B2") resolves A1 range and delegates to RangeOps.clearRange', async () => {
      (RangeOps.clearRange as jest.Mock).mockResolvedValue({ cellCount: 4 });

      await ws.clearData('A1:B2');

      expect(RangeOps.clearRange).toHaveBeenCalledWith(ctx, SHEET_ID, {
        sheetId: SHEET_ID,
        startRow: 0,
        startCol: 0,
        endRow: 1,
        endCol: 1,
      });
    });

    it('clearData(0, 0, 2, 3) uses numeric bounds directly', async () => {
      (RangeOps.clearRange as jest.Mock).mockResolvedValue({ cellCount: 12 });

      await ws.clearData(0, 0, 2, 3);

      expect(RangeOps.clearRange).toHaveBeenCalledWith(ctx, SHEET_ID, {
        sheetId: SHEET_ID,
        startRow: 0,
        startCol: 0,
        endRow: 2,
        endCol: 3,
      });
    });

    it('clearData throws when clearRange throws', async () => {
      (RangeOps.clearRange as jest.Mock).mockRejectedValue(
        new KernelError('COMPUTE_ERROR', 'range clear failed'),
      );

      await expect(ws.clearData('A1:B2')).rejects.toThrow(KernelError);
    });

    it('clearData with invalid A1 range throws', async () => {
      await expect(ws.clearData('invalid')).rejects.toThrow();
    });

    it('getRawCellData("A1") delegates to CellOps and returns raw data', async () => {
      (CellOps.getValue as jest.Mock).mockResolvedValue(42);
      (CellOps.getFormula as jest.Mock).mockResolvedValue('=1+1');
      (CellOps.getFormat as jest.Mock).mockResolvedValue({ bold: true });
      (HyperlinkOps.getHyperlink as jest.Mock).mockResolvedValue('https://example.com');
      (MergeOps.getMergeAt as jest.Mock).mockResolvedValue(undefined);

      const result = await ws.getRawCellData('A1');

      expect(result).toEqual({
        value: 42,
        formula: '=1+1',
        format: { bold: true },
        hyperlink: 'https://example.com',
        isMerged: false,
        mergedRegion: undefined,
      });
    });

    it('getRawCellData with merged cell includes merge region', async () => {
      (CellOps.getCell as jest.Mock).mockResolvedValue({ value: 'merged' });
      (CellOps.getFormat as jest.Mock).mockResolvedValue(undefined);
      (HyperlinkOps.getHyperlink as jest.Mock).mockResolvedValue(null);
      (MergeOps.getMergeAt as jest.Mock).mockResolvedValue({
        startRow: 0,
        startCol: 0,
        endRow: 1,
        endCol: 1,
      });

      const result = await ws.getRawCellData(0, 0);

      expect(result.isMerged).toBe(true);
      expect(result.mergedRegion).toBe('A1:B2');
    });
  });

  // =========================================================================
  // 4. Formatting
  // =========================================================================

  describe('Formatting', () => {
    it('setFormat("A1", format) resolves A1 and calls computeBridge.setFormatForRanges', async () => {
      const format = { bold: true };
      await ws.formats.set('A1', format);

      expect(ctx.computeBridge.setFormatForRanges).toHaveBeenCalledWith(
        SHEET_ID,
        [[0, 0, 0, 0]],
        format,
      );
    });

    it('setFormat("C5", format) resolves to (4, 2)', async () => {
      const format = { italic: true };
      await ws.formats.set('C5', format);

      expect(ctx.computeBridge.setFormatForRanges).toHaveBeenCalledWith(
        SHEET_ID,
        [[4, 2, 4, 2]],
        format,
      );
    });

    it('setFormat(0, 0, format) uses numeric path', async () => {
      const format = { bold: true, fontColor: '#FF0000' };
      await ws.formats.set(0, 0, format);

      expect(ctx.computeBridge.setFormatForRanges).toHaveBeenCalledWith(
        SHEET_ID,
        [[0, 0, 0, 0]],
        format,
      );
    });

    it('setFormat(3, 2, format) passes correct row/col', async () => {
      const format = { backgroundColor: '#00FF00' };
      await ws.formats.set(3, 2, format);

      expect(ctx.computeBridge.setFormatForRanges).toHaveBeenCalledWith(
        SHEET_ID,
        [[3, 2, 3, 2]],
        format,
      );
    });

    it('setFormat throws when computeBridge rejects', async () => {
      ctx.computeBridge.setFormatForRanges.mockRejectedValue(new Error('format failed'));

      await expect(ws.formats.set('A1', { bold: true })).rejects.toThrow('format failed');
    });

    it('setRangeFormat("A1:B2", format) calls computeBridge.setFormatForRanges', async () => {
      const format = { bold: true };
      await ws.formats.setRange('A1:B2', format);

      expect(ctx.computeBridge.setFormatForRanges).toHaveBeenCalledWith(
        SHEET_ID,
        [[0, 0, 1, 1]],
        format,
      );
    });

    it('setRangeFormat throws KernelError on invalid range', async () => {
      await expect(ws.formats.setRange('invalid', { bold: true })).rejects.toThrow(KernelError);
    });

    it('clearFormat("A1") resolves and calls computeBridge.clearFormatForRanges', async () => {
      await ws.formats.clearCell('A1');

      expect(ctx.computeBridge.clearFormatForRanges).toHaveBeenCalledWith(SHEET_ID, [[0, 0, 0, 0]]);
    });

    it('clearFormat(2, 3) uses numeric path', async () => {
      await ws.formats.clearCell(2, 3);

      expect(ctx.computeBridge.clearFormatForRanges).toHaveBeenCalledWith(SHEET_ID, [[2, 3, 2, 3]]);
    });

    it('getFormat("B2") resolves and returns format from computeBridge', async () => {
      ctx.computeBridge.getResolvedFormat.mockResolvedValue({ bold: true, italic: false });

      const result = await ws.formats.get('B2');

      expect(ctx.computeBridge.getResolvedFormat).toHaveBeenCalledWith(SHEET_ID, 1, 1);
      expect(result).toEqual({ bold: true, italic: false });
    });

    it('getFormat returns resolved format for unformatted cell', async () => {
      ctx.computeBridge.getResolvedFormat.mockResolvedValue({ bold: null, italic: null });

      const result = await ws.formats.get('A1');

      expect(result).toEqual({ bold: null, italic: null });
    });
  });

  describe('formats.clearFill', () => {
    it('preserves bold when clearing backgroundColor', async () => {
      // queryRange returns the sparse cell-level format with both bold and backgroundColor
      ctx.computeBridge.queryRange.mockResolvedValueOnce({
        cells: [{ row: 0, col: 0, format: { bold: true, backgroundColor: '#FF0000' } }],
        merges: [],
      });

      await ws.formats.clearFill('A1');

      // 1) queryRange is called to read the sparse format
      expect(ctx.computeBridge.queryRange).toHaveBeenCalledWith(SHEET_ID, 0, 0, 0, 0);
      // 2) clearFormatForRanges clears all formatting on the cell
      expect(ctx.computeBridge.clearFormatForRanges).toHaveBeenCalledWith(SHEET_ID, [[0, 0, 0, 0]]);
      // 3) setFormatForRanges re-applies the non-fill properties
      expect(ctx.computeBridge.setFormatForRanges).toHaveBeenCalledWith(SHEET_ID, [[0, 0, 0, 0]], {
        bold: true,
      });
    });

    it('does not promote row-inherited format to cell-level override', async () => {
      // queryRange returns no cell-level format (the cell inherits from the row)
      ctx.computeBridge.queryRange.mockResolvedValueOnce({
        cells: [{ row: 2, col: 0 }],
        merges: [],
      });

      await ws.formats.clearFill(2, 0);

      // queryRange is called to read the sparse format
      expect(ctx.computeBridge.queryRange).toHaveBeenCalledWith(SHEET_ID, 2, 0, 2, 0);
      // clearFormatForRanges is called to clear any cell-level formatting
      expect(ctx.computeBridge.clearFormatForRanges).toHaveBeenCalledWith(SHEET_ID, [[2, 0, 2, 0]]);
      // setFormatForRanges should NOT be called — no cell-level format to re-apply
      expect(ctx.computeBridge.setFormatForRanges).not.toHaveBeenCalled();
    });

    it('leaves no format overrides when cell has only fill properties', async () => {
      // queryRange returns a cell-level format with only fill properties
      ctx.computeBridge.queryRange.mockResolvedValueOnce({
        cells: [{ row: 0, col: 0, format: { backgroundColor: '#00FF00', patternType: 'solid' } }],
        merges: [],
      });

      await ws.formats.clearFill('A1');

      // queryRange + clearFormatForRanges are called
      expect(ctx.computeBridge.queryRange).toHaveBeenCalledWith(SHEET_ID, 0, 0, 0, 0);
      expect(ctx.computeBridge.clearFormatForRanges).toHaveBeenCalledWith(SHEET_ID, [[0, 0, 0, 0]]);
      // setFormatForRanges should NOT be called — stripping fill leaves nothing to re-apply
      expect(ctx.computeBridge.setFormatForRanges).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 5. Structure operations
  // =========================================================================

  describe('Structure operations', () => {
    it('insertRows delegates to computeBridge.structureChange', async () => {
      await ws.structure.insertRows(2, 3);

      expect(ctx.computeBridge.structureChange).toHaveBeenCalledWith(SHEET_ID, {
        InsertRows: { at: 2, count: 3, new_row_ids: [] },
      });
    });

    it('insertRows throws on negative index', async () => {
      await expect(ws.structure.insertRows(-1, 1)).rejects.toThrow('Invalid row index');
    });

    it('deleteRows delegates to computeBridge.structureChange', async () => {
      await ws.structure.deleteRows(5, 2);

      expect(ctx.computeBridge.structureChange).toHaveBeenCalledWith(SHEET_ID, {
        DeleteRows: { at: 5, count: 2, deleted_cell_ids: [] },
      });
    });

    it('deleteRows throws on negative index', async () => {
      await expect(ws.structure.deleteRows(-1, 1)).rejects.toThrow('Invalid row index');
    });

    it('insertColumns delegates to computeBridge.structureChange', async () => {
      await ws.structure.insertColumns(1, 4);

      expect(ctx.computeBridge.structureChange).toHaveBeenCalledWith(SHEET_ID, {
        InsertCols: { at: 1, count: 4, new_col_ids: [] },
      });
    });

    it('insertColumns throws on negative index', async () => {
      await expect(ws.structure.insertColumns(-1, 1)).rejects.toThrow('Invalid column index');
    });

    it('deleteColumns delegates to computeBridge.structureChange', async () => {
      await ws.structure.deleteColumns(0, 2);

      expect(ctx.computeBridge.structureChange).toHaveBeenCalledWith(SHEET_ID, {
        DeleteCols: { at: 0, count: 2, deleted_cell_ids: [] },
      });
    });

    it('deleteColumns throws on negative index', async () => {
      await expect(ws.structure.deleteColumns(-1, 1)).rejects.toThrow('Invalid column index');
    });

    it('getRowCount uses computeBridge.getDataBounds', async () => {
      ctx.computeBridge.getDataBounds.mockResolvedValue({
        minRow: 0,
        minCol: 0,
        maxRow: 99,
        maxCol: 5,
      });

      const result = await ws.structure.getRowCount();

      expect(ctx.computeBridge.getDataBounds).toHaveBeenCalledWith(SHEET_ID);
      expect(result).toBe(100);
    });

    it('getColumnCount uses computeBridge.getDataBounds', async () => {
      ctx.computeBridge.getDataBounds.mockResolvedValue({
        minRow: 0,
        minCol: 0,
        maxRow: 10,
        maxCol: 25,
      });

      const result = await ws.structure.getColumnCount();

      expect(ctx.computeBridge.getDataBounds).toHaveBeenCalledWith(SHEET_ID);
      expect(result).toBe(26);
    });

    it('setRowHeight delegates to computeBridge.setRowHeight', async () => {
      await ws.layout.setRowHeight(0, 30);

      expect(ctx.computeBridge.setRowHeight).toHaveBeenCalledWith(SHEET_ID, 0, 30);
    });

    it('setRowHeight throws KernelError on failure', async () => {
      await expect(ws.layout.setRowHeight(0, -1)).rejects.toThrow();
    });

    it('setColumnWidth delegates to computeBridge.setColWidth', async () => {
      await ws.layout.setColumnWidth(0, 120);

      expect(ctx.computeBridge.setColWidth).toHaveBeenCalledWith(SHEET_ID, 0, 120);
    });

    it('getRowHeight delegates to computeBridge.getRowHeightQuery', async () => {
      ctx.computeBridge.getRowHeightQuery.mockResolvedValue(25);

      const result = await ws.layout.getRowHeight(3);

      expect(ctx.computeBridge.getRowHeightQuery).toHaveBeenCalledWith(SHEET_ID, 3);
      expect(result).toBe(25);
    });

    it('getColumnWidth delegates to computeBridge.getColWidthQuery', async () => {
      ctx.computeBridge.getColWidthQuery.mockResolvedValue(100);

      const result = await ws.layout.getColumnWidth(5);

      expect(ctx.computeBridge.getColWidthQuery).toHaveBeenCalledWith(SHEET_ID, 5);
      expect(result).toBe(100);
    });

    it('setColumnWidthChars delegates to computeBridge.setColWidthChars', async () => {
      await ws.layout.setColumnWidthChars(0, 12);

      expect(ctx.computeBridge.setColWidthChars).toHaveBeenCalledWith(SHEET_ID, 0, 12);
    });

    it('getColumnWidthChars delegates to computeBridge.getColWidthCharsQuery', async () => {
      ctx.computeBridge.getColWidthCharsQuery.mockResolvedValue(8.43);

      const result = await ws.layout.getColumnWidthChars(5);

      expect(ctx.computeBridge.getColWidthCharsQuery).toHaveBeenCalledWith(SHEET_ID, 5);
      expect(result).toBe(8.43);
    });

    it('setColumnWidths delegates to computeBridge.setColWidths', async () => {
      await ws.layout.setColumnWidths([
        [0, 120],
        [1, 140],
      ]);

      expect(ctx.computeBridge.setColWidths).toHaveBeenCalledWith(SHEET_ID, [
        [0, 120],
        [1, 140],
      ]);
    });

    it('setColumnWidthsChars delegates to computeBridge.setColWidthsChars', async () => {
      await ws.layout.setColumnWidthsChars([
        [0, 12],
        [1, 14],
      ]);

      expect(ctx.computeBridge.setColWidthsChars).toHaveBeenCalledWith(SHEET_ID, [
        [0, 12],
        [1, 14],
      ]);
    });

    it('getColWidthsBatch delegates to computeBridge.getColWidthsBatch', async () => {
      ctx.computeBridge.getColWidthsBatch.mockResolvedValue([
        [0, 64],
        [1, 72],
      ]);

      const result = await ws.layout.getColWidthsBatch(0, 1);

      expect(ctx.computeBridge.getColWidthsBatch).toHaveBeenCalledWith(SHEET_ID, 0, 1);
      expect(result).toEqual([
        [0, 64],
        [1, 72],
      ]);
    });

    it('getColWidthsBatchChars delegates to computeBridge.getColWidthsBatchChars', async () => {
      ctx.computeBridge.getColWidthsBatchChars.mockResolvedValue([
        [0, 8.43],
        [1, 12],
      ]);

      const result = await ws.layout.getColWidthsBatchChars(0, 1);

      expect(ctx.computeBridge.getColWidthsBatchChars).toHaveBeenCalledWith(SHEET_ID, 0, 1);
      expect(result).toEqual([
        [0, 8.43],
        [1, 12],
      ]);
    });

    it('setRowVisible(row, false) calls computeBridge.hideRows', async () => {
      await ws.layout.setRowVisible(2, false);

      expect(ctx.computeBridge.hideRows).toHaveBeenCalledWith(SHEET_ID, [2]);
    });

    it('setColumnVisible(col, true) calls computeBridge.unhideColumns', async () => {
      await ws.layout.setColumnVisible(1, true);

      expect(ctx.computeBridge.unhideColumns).toHaveBeenCalledWith(SHEET_ID, [1]);
    });

    it('insertCellsWithShift delegates to computeBridge', async () => {
      await ws.structure.insertCellsWithShift(0, 0, 1, 1, 'right');

      expect(ctx.computeBridge.insertCellsWithShift).toHaveBeenCalledWith(
        SHEET_ID,
        0,
        0,
        2,
        2,
        true,
      );
    });

    it('insertCellsWithShift with "down" direction', async () => {
      await ws.structure.insertCellsWithShift(0, 0, 1, 1, 'down');

      expect(ctx.computeBridge.insertCellsWithShift).toHaveBeenCalledWith(
        SHEET_ID,
        0,
        0,
        2,
        2,
        false,
      );
    });

    it('deleteCellsWithShift delegates to computeBridge', async () => {
      await ws.structure.deleteCellsWithShift(0, 0, 1, 1, 'left');

      expect(ctx.computeBridge.deleteCellsWithShift).toHaveBeenCalledWith(
        SHEET_ID,
        0,
        0,
        2,
        2,
        true,
      );
    });

    it('deleteCellsWithShift with "up" direction', async () => {
      await ws.structure.deleteCellsWithShift(0, 0, 1, 1, 'up');

      expect(ctx.computeBridge.deleteCellsWithShift).toHaveBeenCalledWith(
        SHEET_ID,
        0,
        0,
        2,
        2,
        false,
      );
    });
  });

  // =========================================================================
  // 6. Protection checks
  // =========================================================================

  describe('Protection checks', () => {
    it('isProtected delegates to computeBridge.isSheetProtected', async () => {
      ctx.computeBridge.isSheetProtected.mockResolvedValue(true);

      const result = await ws.protection.isProtected();

      expect(ctx.computeBridge.isSheetProtected).toHaveBeenCalledWith(SHEET_ID);
      expect(result).toBe(true);
    });

    it('protect delegates to computeBridge.protectSheet with hashed password', async () => {
      await ws.protection.protect('password123');

      expect(ctx.computeBridge.protectSheet).toHaveBeenCalledWith(
        SHEET_ID,
        expect.any(String), // hashed password
      );
      // Password should be hashed, not raw
      const callArgs = ctx.computeBridge.protectSheet.mock.calls[0];
      expect(callArgs[1]).not.toBe('password123');
    });

    it('protect without password passes null hash', async () => {
      await ws.protection.protect();

      expect(ctx.computeBridge.protectSheet).toHaveBeenCalledWith(SHEET_ID, null);
    });

    it('protect throws when computeBridge rejects', async () => {
      ctx.computeBridge.protectSheet.mockRejectedValue(new Error('protection failed'));

      await expect(ws.protection.protect()).rejects.toThrow('protection failed');
    });

    it('unprotect delegates to computeBridge.unprotectSheet', async () => {
      const result = await ws.protection.unprotect('password123');

      expect(ctx.computeBridge.unprotectSheet).toHaveBeenCalledWith(SHEET_ID, expect.any(String));
      expect(result).toBe(true);
    });

    it('unprotect always returns true', async () => {
      const result = await ws.protection.unprotect('wrong-password');

      expect(result).toBe(true);
    });

    it('canEditCell returns true when sheet is not protected', async () => {
      ctx.computeBridge.isSheetProtected.mockResolvedValue(false);

      const result = await ws.protection.canEditCell(0, 0);

      expect(result).toBe(true);
    });

    it('canEditCell returns false for locked cell on protected sheet', async () => {
      ctx.computeBridge.canEditCell.mockResolvedValue(false);

      const result = await ws.protection.canEditCell(0, 0);

      expect(result).toBe(false);
    });

    it('canEditCell returns true for unlocked cell on protected sheet', async () => {
      ctx.computeBridge.canEditCell.mockResolvedValue(true);

      const result = await ws.protection.canEditCell(0, 0);

      expect(result).toBe(true);
    });

    it('canEditCell returns false when format.locked is true on protected sheet', async () => {
      ctx.computeBridge.canEditCell.mockResolvedValue(false);

      const result = await ws.protection.canEditCell(0, 0);

      expect(result).toBe(false);
    });

    it('canEditCellFast returns true from mirror when sheet is unprotected', () => {
      ctx.mirror.getSheetSettings.mockReturnValue({ isProtected: false });

      expect(ws.protection.canEditCellFast(0, 0)).toBe(true);
      expect(ctx.mirror.getSheetSettings).toHaveBeenCalledWith(SHEET_ID);
    });

    it('canEditCellFast returns unknown from mirror when sheet is protected', () => {
      ctx.mirror.getSheetSettings.mockReturnValue({ isProtected: true });

      expect(ws.protection.canEditCellFast(0, 0)).toBe('unknown');
      expect(ctx.mirror.getSheetSettings).toHaveBeenCalledWith(SHEET_ID);
    });

    it('getProtectionConfig delegates to computeBridge', async () => {
      ctx.computeBridge.hasSheetProtectionPassword.mockResolvedValue(true);
      ctx.computeBridge.getSheetProtectionOptions.mockResolvedValue({
        selectLockedCells: true,
        selectUnlockedCells: true,
        formatCells: false,
        formatColumns: false,
        formatRows: false,
        insertColumns: false,
        insertRows: false,
        deleteColumns: false,
        deleteRows: false,
        sort: true,
        useAutoFilter: false,
        usePivotTableReports: false,
      });

      const config = await ws.protection.getConfig();

      expect(config.isProtected).toBe(true);
      expect(config.allowSort).toBe(true);
      expect(config.allowAutoFilter).toBe(false);
    });

    it('getProtectionConfig defaults to false when bridge returns null', async () => {
      ctx.computeBridge.getSheetProtectionOptions.mockResolvedValue(null);

      const config = await ws.protection.getConfig();

      expect(config.isProtected).toBe(false);
    });
  });

  // =========================================================================
  // 7. describe()
  // =========================================================================

  describe('describe()', () => {
    it('returns empty string when cell is empty', async () => {
      (CellOps.getCell as jest.Mock).mockResolvedValue(undefined);

      const result = await ws.describe('A1');

      expect(result).toBe('');
    });

    it('returns display value for simple cell', async () => {
      (CellOps.getCell as jest.Mock).mockResolvedValue({ value: 42, formula: undefined });
      (CellOps.getDisplayValue as jest.Mock).mockResolvedValue('42');
      (getStyleHints as jest.Mock).mockResolvedValue('');

      const result = await ws.describe('A1');

      expect(result).toBe('42');
    });

    it('includes formula when present: "displayValue(=formula)"', async () => {
      (CellOps.getCell as jest.Mock).mockResolvedValue({ value: 100, formula: 'SUM(A1:A10)' });
      (CellOps.getDisplayValue as jest.Mock).mockResolvedValue('100');
      (getStyleHints as jest.Mock).mockResolvedValue('');

      const result = await ws.describe('B1');

      expect(result).toBe('100(SUM(A1:A10))');
    });

    it('shows only formula when display value is empty', async () => {
      (CellOps.getCell as jest.Mock).mockResolvedValue({ value: null, formula: 'IF(FALSE,1,)' });
      (CellOps.getDisplayValue as jest.Mock).mockResolvedValue('');
      (getStyleHints as jest.Mock).mockResolvedValue('');

      const result = await ws.describe('A1');

      expect(result).toBe('(IF(FALSE,1,))');
    });

    it('adds [0] indicator when raw value is 0 but displayed differently', async () => {
      (CellOps.getCell as jest.Mock).mockResolvedValue({ value: 0, formula: undefined });
      (CellOps.getDisplayValue as jest.Mock).mockResolvedValue('-');
      (getStyleHints as jest.Mock).mockResolvedValue('');

      const result = await ws.describe('A1');

      expect(result).toBe('0');
    });

    it('does not add [0] when display value is "0"', async () => {
      (CellOps.getCell as jest.Mock).mockResolvedValue({ value: 0, formula: undefined });
      (CellOps.getDisplayValue as jest.Mock).mockResolvedValue('0');
      (getStyleHints as jest.Mock).mockResolvedValue('');

      const result = await ws.describe('A1');

      expect(result).toBe('0');
    });

    it('adds style hints when present', async () => {
      (CellOps.getCell as jest.Mock).mockResolvedValue({ value: 'text', formula: undefined });
      (CellOps.getDisplayValue as jest.Mock).mockResolvedValue('text');
      (getStyleHints as jest.Mock).mockResolvedValue('bold, red');

      const result = await ws.describe('A1');

      expect(result).toBe('text [bold, red]');
    });

    it('combines formula, [0] indicator, and style hints', async () => {
      (CellOps.getCell as jest.Mock).mockResolvedValue({ value: 0, formula: 'A1-A1' });
      (CellOps.getDisplayValue as jest.Mock).mockResolvedValue('$0.00');
      (getStyleHints as jest.Mock).mockResolvedValue('currency');

      const result = await ws.describe('A1');

      expect(result).toBe('0(A1-A1) [currency]');
    });
  });

  // =========================================================================
  // 8. describeRange()
  // =========================================================================

  describe('describeRange()', () => {
    it('returns empty string for invalid range', async () => {
      const result = await ws.describeRange('invalid');

      expect(result).toBe('');
    });

    it('formats cells as "ADDR:value" separated by " | "', async () => {
      // Mock queryRange to return ViewportCell data for A1:B1
      ctx.computeBridge.queryRange.mockResolvedValueOnce({
        cells: [
          {
            row: 0,
            col: 0,
            value: 'Name',
            has_formula: false,
            formatted: 'Name',
          },
          {
            row: 0,
            col: 1,
            value: 'Score',
            has_formula: false,
            formatted: 'Score',
          },
        ],
        merges: [],
      });

      (analyzeFormulas as jest.Mock).mockReturnValue({
        patterns: new Map(),
        formulaToId: new Map(),
        minCellsForAbbreviation: 3,
      });
      (generateFormulaDocumentation as jest.Mock).mockReturnValue([]);

      const result = await ws.describeRange('A1:B1');

      expect(result).toContain('A1:Name');
      expect(result).toContain('B1:Score');
      expect(result).toContain(' | ');
    });

    it('includes formula in cell description for formula cells', async () => {
      // Mock queryRange to return a formula cell
      ctx.computeBridge.queryRange.mockResolvedValueOnce({
        cells: [
          {
            row: 0,
            col: 0,
            value: 100,
            formula: '=SUM(B1:B10)',
            formatted: '100',
          },
        ],
        merges: [],
      });

      (analyzeFormulas as jest.Mock).mockReturnValue({
        patterns: new Map(),
        formulaToId: new Map(),
        minCellsForAbbreviation: 3,
      });
      (generateFormulaDocumentation as jest.Mock).mockReturnValue([]);

      const result = await ws.describeRange('A1:A1');

      expect(result).toContain('100(=SUM(B1:B10))');
    });

    it('uses abbreviated formula references when patterns exist', async () => {
      // Mock queryRange to return a formula cell
      ctx.computeBridge.queryRange.mockResolvedValueOnce({
        cells: [
          {
            row: 0,
            col: 0,
            value: 10,
            formula: 'B1+C1',
            formatted: '10',
          },
        ],
        merges: [],
      });

      const formulaToId = new Map([['0,0', 'F1']]);
      (analyzeFormulas as jest.Mock).mockReturnValue({
        patterns: new Map([['pattern1', { cells: [1, 2, 3] }]]),
        formulaToId,
        minCellsForAbbreviation: 3,
      });
      (generateFormulaDocumentation as jest.Mock).mockReturnValue([
        '',
        'Formula definitions:',
        'F1: =B{row}+C{row}',
      ]);

      const result = await ws.describeRange('A1:A1');

      // Should use abbreviated reference F1 instead of full formula
      expect(result).toContain('10(F1)');
      // Should include abbreviation header
      expect(result).toContain('Common formulas are abbreviated');
      // Should include formula definitions
      expect(result).toContain('Formula definitions:');
    });

    it('includes empty rows in output', async () => {
      // Mock queryRange for A1:A2 where only A1 has data
      ctx.computeBridge.queryRange.mockResolvedValueOnce({
        cells: [
          {
            row: 0,
            col: 0,
            value: 'data',
            has_formula: false,
            formatted: 'data',
          },
          // A2 (row 1) is absent = empty
        ],
        merges: [],
      });

      (analyzeFormulas as jest.Mock).mockReturnValue({
        patterns: new Map(),
        formulaToId: new Map(),
        minCellsForAbbreviation: 3,
      });
      (generateFormulaDocumentation as jest.Mock).mockReturnValue([]);

      const result = await ws.describeRange('A1:A2');
      const lines = result.split('\n').filter((l: string) => l.length > 0);

      // Both rows should appear — A2 is empty but still shown
      expect(lines.length).toBe(2);
      expect(lines[0]).toContain('A1:data');
      expect(lines[1]).toContain('A2:');
    });
  });

  // =========================================================================
  // 9. summarize()
  // =========================================================================

  describe('summarize()', () => {
    it('returns "Sheet not found" when meta is null', async () => {
      (getMeta as jest.Mock).mockResolvedValue(null);

      const result = await ws.summarize();

      expect(result).toContain('Sheet not found');
      expect(result).toContain(SHEET_ID);
    });

    it('returns empty sheet summary when no cells', async () => {
      (getMeta as jest.Mock).mockResolvedValue({
        name: 'Sheet1',
        frozenRows: 0,
        frozenCols: 0,
      });
      // getDataBounds returns null by default (no cells)
      (Charts.getAll as jest.Mock).mockResolvedValue([]);

      const result = await ws.summarize();

      expect(result).toContain('Sheet: Sheet1');
      expect(result).toContain('Used Range: (empty)');
      expect(result).toContain('Dimensions: 0 rows x 0 columns');
    });

    it('computes correct bounding box from cell positions', async () => {
      (getMeta as jest.Mock).mockResolvedValue({
        name: 'Data',
        frozenRows: 0,
        frozenCols: 0,
      });
      // Mock getDataBounds to return bounds equivalent to cells at A1(0,0), C3(2,2), B5(4,1)
      ctx.computeBridge.getDataBounds.mockResolvedValue({
        minRow: 0,
        minCol: 0,
        maxRow: 4,
        maxCol: 2,
      });
      (Charts.getAll as jest.Mock).mockResolvedValue([]);

      const result = await ws.summarize();

      expect(result).toContain('Used Range: A1:C5');
      expect(result).toContain('Dimensions: 5 rows x 3 columns');
    });

    it('includes frozen panes info when present', async () => {
      (getMeta as jest.Mock).mockResolvedValue({
        name: 'Frozen',
        frozenRows: 2,
        frozenCols: 1,
      });
      (Charts.getAll as jest.Mock).mockResolvedValue([]);

      const result = await ws.summarize();

      expect(result).toContain('Frozen: 2 rows, 1 columns');
    });

    it('does not include frozen info when rows=0 and cols=0', async () => {
      (getMeta as jest.Mock).mockResolvedValue({
        name: 'NoFreeze',
        frozenRows: 0,
        frozenCols: 0,
      });
      (Charts.getAll as jest.Mock).mockResolvedValue([]);

      const result = await ws.summarize();

      expect(result).not.toContain('Frozen:');
    });

    it('includes charts info when present', async () => {
      (getMeta as jest.Mock).mockResolvedValue({
        name: 'WithCharts',
        frozenRows: 0,
        frozenCols: 0,
      });
      (Charts.getAll as jest.Mock).mockResolvedValue([{ id: 'chart-1' }, { id: 'chart-2' }]);

      const result = await ws.summarize();

      expect(result).toContain('Charts: 2 (chart-1, chart-2)');
    });

    it('includes tables info with range addresses', async () => {
      (getMeta as jest.Mock).mockResolvedValue({
        name: 'WithTables',
        frozenRows: 0,
        frozenCols: 0,
      });
      (Charts.getAll as jest.Mock).mockResolvedValue([]);
      ctx.computeBridge.getAllTablesInSheet.mockResolvedValue([
        {
          name: 'SalesTable',
          range: { startRow: 0, startCol: 0, endRow: 9, endCol: 3 },
        },
      ]);

      const result = await ws.summarize();

      expect(result).toContain('Tables: 1 (SalesTable at A1:D10)');
    });

    it('includes named ranges info', async () => {
      (getMeta as jest.Mock).mockResolvedValue({
        name: 'WithNames',
        frozenRows: 0,
        frozenCols: 0,
      });
      (Charts.getAll as jest.Mock).mockResolvedValue([]);
      ctx.__apiTestNamedRanges = [
        { name: 'TotalRow', scope: SHEET_ID, refersTo: { template: '{0}', refs: [] } },
        { name: 'GlobalName', scope: undefined, refersTo: { template: '{0}', refs: [] } },
      ];
      ctx.__apiTestNamedRangeA1.mockResolvedValueOnce('A10').mockResolvedValueOnce('B1:B100');

      const result = await ws.summarize();

      expect(result).toContain('Named Ranges: 2');
      expect(result).toContain('TotalRow=A10');
      expect(result).toContain('GlobalName=B1:B100');
    });

    it('excludes named ranges scoped to other sheets', async () => {
      (getMeta as jest.Mock).mockResolvedValue({
        name: 'TestSheet',
        frozenRows: 0,
        frozenCols: 0,
      });
      (Charts.getAll as jest.Mock).mockResolvedValue([]);
      ctx.__apiTestNamedRanges = [
        {
          name: 'OtherSheetName',
          scope: 'other-sheet-id',
          refersTo: { template: '{0}', refs: [] },
        },
      ];

      const result = await ws.summarize();

      expect(result).not.toContain('Named Ranges:');
      expect(result).not.toContain('OtherSheetName');
    });

    it('filters out #REF! named ranges from summary', async () => {
      (getMeta as jest.Mock).mockResolvedValue({
        name: 'RefSheet',
        frozenRows: 0,
        frozenCols: 0,
      });
      (Charts.getAll as jest.Mock).mockResolvedValue([]);
      ctx.__apiTestNamedRanges = [
        { name: 'GoodName', scope: undefined, refersTo: { template: '{0}', refs: [] } },
        { name: 'BrokenName', scope: undefined, refersTo: { template: '#REF!', refs: [] } },
        { name: 'AlsoBroken', scope: undefined, refersTo: { template: '#REF!', refs: [] } },
      ];
      ctx.__apiTestNamedRangeA1.mockResolvedValueOnce('Sheet1!A1');

      const result = await ws.summarize();

      expect(result).toContain('Named Ranges: 1 valid, 2 broken (#REF!) omitted');
      expect(result).toContain('GoodName=Sheet1!A1');
      expect(result).not.toContain('BrokenName');
      expect(result).not.toContain('AlsoBroken');
      // getRefersToA1 should only be called once (for the valid name)
      expect(ctx.__apiTestNamedRangeA1).toHaveBeenCalledTimes(1);
    });

    it('caps named ranges at MAX_SUMMARY_NAMED_RANGES', async () => {
      (getMeta as jest.Mock).mockResolvedValue({
        name: 'ManyNames',
        frozenRows: 0,
        frozenCols: 0,
      });
      (Charts.getAll as jest.Mock).mockResolvedValue([]);
      // Create 30 valid named ranges
      const names = Array.from({ length: 30 }, (_, i) => ({
        name: `Name${i}`,
        scope: undefined,
        refersTo: { template: '{0}', refs: [] },
      }));
      ctx.__apiTestNamedRanges = names;
      ctx.__apiTestNamedRangeA1.mockImplementation((nr: { name: string }) =>
        Promise.resolve(`${nr.name}!A1`),
      );

      const result = await ws.summarize();

      expect(result).toContain('Named Ranges: 30');
      expect(result).toContain('showing 20:');
      expect(result).toContain('10 more not shown');
      // Only 20 A1 resolutions should happen
      expect(ctx.__apiTestNamedRangeA1).toHaveBeenCalledTimes(20);
    });

    it('shows only broken count when all names are #REF!', async () => {
      (getMeta as jest.Mock).mockResolvedValue({
        name: 'AllBroken',
        frozenRows: 0,
        frozenCols: 0,
      });
      (Charts.getAll as jest.Mock).mockResolvedValue([]);
      ctx.__apiTestNamedRanges = [
        { name: 'Bad1', scope: undefined, refersTo: { template: '#REF!', refs: [] } },
        { name: 'Bad2', scope: undefined, refersTo: { template: '#REF!', refs: [] } },
      ];

      const result = await ws.summarize();

      expect(result).toContain('Named Ranges: 0 valid, 2 broken (#REF!) omitted');
      expect(result).not.toContain('Bad1');
      expect(result).not.toContain('Bad2');
      // No A1 resolutions should happen
      expect(ctx.__apiTestNamedRangeA1).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Identity (sync methods)
  // =========================================================================

  describe('Identity (sync methods)', () => {
    it('getSheetId returns the sheetId', () => {
      expect(ws.getSheetId()).toBe(SHEET_ID);
    });

    it('getName throws when no cached name and bridge returns null', async () => {
      await expect(ws.getName()).rejects.toThrow(/Sheet name not available/);
    });

    it('getIndex returns -1 as fallback when no cached index', () => {
      expect(ws.getIndex()).toBe(-1);
    });

    it('getVisibility returns visible as fallback when no cached visibility', async () => {
      expect(await ws.getVisibility()).toBe('visible');
    });
  });

  // =========================================================================
  // Merge operations
  // =========================================================================

  describe('Merge operations', () => {
    it('merge("A1:B2") resolves and delegates to computeBridge.mergeRange', async () => {
      await ws.structure.merge('A1:B2');

      expect(ctx.computeBridge.mergeRange).toHaveBeenCalledWith(SHEET_ID, 0, 0, 1, 1);
    });

    it('merge(0, 0, 1, 1) uses numeric bounds', async () => {
      await ws.structure.merge(0, 0, 1, 1);

      expect(ctx.computeBridge.mergeRange).toHaveBeenCalledWith(SHEET_ID, 0, 0, 1, 1);
    });

    it('unmerge("A1:B2") delegates to computeBridge.unmergeRange', async () => {
      await ws.structure.unmerge('A1:B2');

      expect(ctx.computeBridge.unmergeRange).toHaveBeenCalledWith(SHEET_ID, 0, 0, 1, 1);
    });

    it('getMergedRegions returns formatted merge regions', async () => {
      ctx.computeBridge.getAllMergesInSheet.mockResolvedValue([
        { startRow: 0, startCol: 0, endRow: 1, endCol: 1 },
        { startRow: 3, startCol: 2, endRow: 5, endCol: 4 },
      ]);

      const regions = await ws.structure.getMergedRegions();

      expect(regions).toHaveLength(2);
      expect(regions[0].range).toBe('A1:B2');
      expect(regions[0].startRow).toBe(0);
      expect(regions[1].range).toBe('C4:E6');
    });
  });

  // =========================================================================
  // Hyperlinks
  // =========================================================================

  describe('Hyperlinks', () => {
    it('setHyperlink("A1", url) resolves and delegates to HyperlinkOps', async () => {
      (HyperlinkOps.setHyperlink as jest.Mock).mockResolvedValue({
        success: true,
        data: undefined,
      });

      await ws.hyperlinks.set('A1', 'https://example.com');

      expect(HyperlinkOps.setHyperlink).toHaveBeenCalledWith(
        ctx,
        SHEET_ID,
        0,
        0,
        'https://example.com',
      );
    });

    it('setHyperlink(0, 0, url) uses numeric path', async () => {
      (HyperlinkOps.setHyperlink as jest.Mock).mockResolvedValue({
        success: true,
        data: undefined,
      });

      await ws.hyperlinks.set(0, 0, 'https://example.com');

      expect(HyperlinkOps.setHyperlink).toHaveBeenCalledWith(
        ctx,
        SHEET_ID,
        0,
        0,
        'https://example.com',
      );
    });

    it('getHyperlink("B2") resolves and returns URL', async () => {
      (HyperlinkOps.getHyperlink as jest.Mock).mockResolvedValue('https://example.com');

      const result = await ws.hyperlinks.get('B2');

      expect(HyperlinkOps.getHyperlink).toHaveBeenCalledWith(ctx, SHEET_ID, 1, 1);
      expect(result).toBe('https://example.com');
    });

    it('removeHyperlink("A1") resolves and delegates', async () => {
      (HyperlinkOps.removeHyperlink as jest.Mock).mockResolvedValue({
        success: true,
        data: undefined,
      });

      await ws.hyperlinks.remove('A1');

      expect(HyperlinkOps.removeHyperlink).toHaveBeenCalledWith(ctx, SHEET_ID, 0, 0);
    });
  });

  // =========================================================================
  // Dependencies
  // =========================================================================

  describe('Dependencies', () => {
    it('getDependents("A1") resolves and returns A1 addresses', async () => {
      (DependencyOps.getDependents as jest.Mock).mockResolvedValue(['A2', 'A3']);

      const result = await ws.getDependents('A1');

      expect(DependencyOps.getDependents).toHaveBeenCalledWith(ctx, SHEET_ID, 0, 0);
      expect(result).toEqual(['A2', 'A3']);
    });

    it('getPrecedents(1, 2) uses numeric path and returns A1 addresses', async () => {
      (DependencyOps.getPrecedents as jest.Mock).mockResolvedValue(['A1']);

      const result = await ws.getPrecedents(1, 2);

      expect(DependencyOps.getPrecedents).toHaveBeenCalledWith(ctx, SHEET_ID, 1, 2);
      expect(result).toEqual(['A1']);
    });
  });

  // =========================================================================
  // Comments / Notes
  // =========================================================================

  describe('Comments / Notes', () => {
    it('setNote("A1", text) resolves and delegates to computeBridge.addCommentByPosition', async () => {
      await ws.comments.setNote('A1', 'This is a note');

      expect(ctx.computeBridge.addCommentByPosition).toHaveBeenCalledWith(
        SHEET_ID,
        0,
        0,
        'This is a note',
        'api',
        null,
        null,
        'note',
      );
    });

    it('setNote(0, 0, text) uses numeric path', async () => {
      await ws.comments.setNote(0, 0, 'Note text');

      expect(ctx.computeBridge.addCommentByPosition).toHaveBeenCalledWith(
        SHEET_ID,
        0,
        0,
        'Note text',
        'api',
        null,
        null,
        'note',
      );
    });

    it('getNote("A1") returns first comment text', async () => {
      ctx.computeBridge.getCommentsForCellByPosition.mockResolvedValue([
        { content: 'My note', runs: [], id: 'c1', author: 'api', cellRef: '0:0' },
      ]);

      const result = await ws.comments.getNote('A1');

      expect(ctx.computeBridge.getCommentsForCellByPosition).toHaveBeenCalledWith(SHEET_ID, 0, 0);
      expect(result).toEqual({ content: 'My note', author: 'api', cellAddress: 'A1' });
    });

    it('getNote returns null when no comments', async () => {
      ctx.computeBridge.getCommentsForCellByPosition.mockResolvedValue([]);

      const result = await ws.comments.getNote('A1');

      expect(result).toBeNull();
    });

    it('removeNote("A1") deletes all comments at cell', async () => {
      ctx.computeBridge.getCommentsForCellByPosition.mockResolvedValue([
        { content: [{ text: 'note1' }], id: 'c1' },
        { content: [{ text: 'note2' }], id: 'c2' },
      ]);

      await ws.comments.removeNote('A1');

      expect(ctx.computeBridge.deleteComment).toHaveBeenCalledTimes(2);
      expect(ctx.computeBridge.deleteComment).toHaveBeenCalledWith(SHEET_ID, 'c1');
      expect(ctx.computeBridge.deleteComment).toHaveBeenCalledWith(SHEET_ID, 'c2');
    });
  });

  // =========================================================================
  // Query operations
  // =========================================================================

  describe('Query operations', () => {
    it('getUsedRange returns null when sheet is empty', async () => {
      (QueryOps.getUsedRange as jest.Mock).mockResolvedValue(null);

      const result = await ws.getUsedRange();

      expect(result).toBeNull();
    });

    it('getUsedRange returns the used CellRange when cells exist', async () => {
      (QueryOps.getUsedRange as jest.Mock).mockResolvedValue({
        sheetId: SHEET_ID,
        startRow: 0,
        startCol: 0,
        endRow: 9,
        endCol: 3,
      });

      const result = await ws.getUsedRange();

      expect(result).toEqual({
        sheetId: SHEET_ID,
        startRow: 0,
        startCol: 0,
        endRow: 9,
        endCol: 3,
      });
    });

    it('findCells delegates and returns A1 addresses', async () => {
      const predicate = (cell: any) => cell.value > 10;
      (QueryOps.findCells as jest.Mock).mockResolvedValue([
        { row: 0, col: 0 },
        { row: 1, col: 2 },
      ]);

      const result = await ws.findCells(predicate);

      expect(QueryOps.findCells).toHaveBeenCalledWith(ctx, SHEET_ID, predicate);
      expect(result).toEqual(['A1', 'C2']);
    });

    it('findByValue delegates and returns A1 addresses', async () => {
      (QueryOps.findByValue as jest.Mock).mockResolvedValue([{ row: 3, col: 0 }]);

      const result = await ws.findByValue(42);

      expect(QueryOps.findByValue).toHaveBeenCalledWith(ctx, SHEET_ID, 42);
      expect(result).toEqual(['A4']);
    });

    it('findByFormula delegates and returns A1 addresses', async () => {
      const pattern = /SUM/;
      (QueryOps.findByFormula as jest.Mock).mockResolvedValue([{ row: 0, col: 0 }]);

      const result = await ws.findByFormula(pattern);

      expect(QueryOps.findByFormula).toHaveBeenCalledWith(ctx, SHEET_ID, pattern);
      expect(result).toEqual(['A1']);
    });
  });

  // =========================================================================
  // Freeze panes
  // =========================================================================

  describe('Freeze panes', () => {
    it('getFrozenPanes reads from the kernel mirror', async () => {
      ctx.mirror.getFrozenPanes.mockReturnValue({ rows: 2, cols: 1 });

      const result = await ws.view.getFrozenPanes();

      expect(ctx.mirror.getFrozenPanes).toHaveBeenCalledWith(SHEET_ID);
      expect(ctx.computeBridge.getFrozenPanesQuery).not.toHaveBeenCalled();
      expect(result).toEqual({ rows: 2, cols: 1 });
    });

    it('freezeRows sets frozen panes with rows only', async () => {
      ctx.computeBridge.getFrozenPanesQuery.mockResolvedValue({ rows: 0, cols: 1 });

      await ws.view.freezeRows(3);

      expect(ctx.computeBridge.freezeRows).toHaveBeenCalledWith(SHEET_ID, 3);
    });

    it('freezeColumns sets frozen panes with cols only', async () => {
      ctx.computeBridge.getFrozenPanesQuery.mockResolvedValue({ rows: 2, cols: 0 });

      await ws.view.freezeColumns(2);

      expect(ctx.computeBridge.freezeColumns).toHaveBeenCalledWith(SHEET_ID, 2);
    });

    it('freezePanes sets rows and columns atomically without read-modify-write', async () => {
      await ws.view.freezePanes(3, 2);

      expect(ctx.computeBridge.getFrozenPanesQuery).not.toHaveBeenCalled();
      expect(ctx.computeBridge.setFrozenPanes).toHaveBeenCalledWith(SHEET_ID, 3, 2);
    });

    it('freezePanes rejects negative counts', async () => {
      await expect(ws.view.freezePanes(-1, 2)).rejects.toThrow(
        'Frozen row and column counts cannot be negative',
      );
      await expect(ws.view.freezePanes(1, -2)).rejects.toThrow(
        'Frozen row and column counts cannot be negative',
      );

      expect(ctx.computeBridge.setFrozenPanes).not.toHaveBeenCalled();
    });

    it('unfreeze sets frozen panes to 0, 0', async () => {
      await ws.view.unfreeze();

      expect(ctx.computeBridge.setFrozenPanes).toHaveBeenCalledWith(SHEET_ID, 0, 0);
    });
  });

  // =========================================================================
  // Error propagation from operation modules
  // =========================================================================

  describe('error propagation', () => {
    it('successful operation does not throw', async () => {
      (CellOps.setCell as jest.Mock).mockResolvedValue(undefined);

      // Should not throw
      await ws.setCell('A1', 'test');
    });

    it('operation KernelError propagates directly', async () => {
      (CellOps.setCell as jest.Mock).mockRejectedValue(
        new KernelError('COMPUTE_ERROR', 'Custom error message'),
      );

      await expect(ws.setCell('A1', 'test')).rejects.toThrow('Custom error message');
    });

    it('operation generic error propagates', async () => {
      (CellOps.setCell as jest.Mock).mockRejectedValue(new Error('plain string error'));

      await expect(ws.setCell('A1', 'test')).rejects.toThrow('plain string error');
    });
  });
});

// ===========================================================================
// Convenience Methods (getValue, getData, toCSV, toJSON)
// ===========================================================================

describe('WorksheetImpl - Convenience Methods', () => {
  let ws: InstanceType<typeof WorksheetImpl>;
  let ctx: any;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx = createMockCtx();
    ws = new WorksheetImpl(SHEET_ID, ctx);
  });

  // =========================================================================
  // getValue
  // =========================================================================

  describe('getValue()', () => {
    it('returns the cell value directly for a populated cell', async () => {
      (CellOps.getValue as jest.Mock).mockResolvedValue(42);

      const result = await ws.getValue('A1');

      expect(CellOps.getValue).toHaveBeenCalledWith(ctx, SHEET_ID, 0, 0);
      expect(result).toBe(42);
    });

    it('returns null for empty cells', async () => {
      (CellOps.getValue as jest.Mock).mockResolvedValue(undefined);

      const result = await ws.getValue('A1');

      expect(result).toBeNull();
    });

    it('works with numeric addressing (row, col)', async () => {
      (CellOps.getValue as jest.Mock).mockResolvedValue('hello');

      const result = await ws.getValue(0, 0);

      expect(CellOps.getValue).toHaveBeenCalledWith(ctx, SHEET_ID, 0, 0);
      expect(result).toBe('hello');
    });
  });

  // =========================================================================
  // getData
  // =========================================================================

  describe('getData()', () => {
    it('returns 2D array of values', async () => {
      (QueryOps.getUsedRange as jest.Mock).mockResolvedValue({
        startRow: 0,
        startCol: 0,
        endRow: 1,
        endCol: 1,
      });
      (RangeOps.getRange as jest.Mock).mockResolvedValue([
        [{ value: 'A' }, { value: 'B' }],
        [{ value: 1 }, { value: 2 }],
      ]);

      const result = await ws.getData();

      expect(result).toEqual([
        ['A', 'B'],
        [1, 2],
      ]);
    });

    it('returns empty array when getUsedRange returns null', async () => {
      (QueryOps.getUsedRange as jest.Mock).mockResolvedValue(null);

      const result = await ws.getData();

      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // toCSV
  // =========================================================================

  describe('toCSV()', () => {
    it('produces basic CSV output with comma separator', async () => {
      (QueryOps.getUsedRange as jest.Mock).mockResolvedValue({
        startRow: 0,
        startCol: 0,
        endRow: 1,
        endCol: 1,
      });
      (RangeOps.getRange as jest.Mock).mockResolvedValue([
        [{ value: 'Name' }, { value: 'Age' }],
        [{ value: 'Alice' }, { value: 30 }],
      ]);

      const csv = await ws.toCSV();

      expect(csv).toBe('Name,Age\r\nAlice,30');
    });

    it('returns empty string when sheet is empty', async () => {
      (QueryOps.getUsedRange as jest.Mock).mockResolvedValue(null);

      const csv = await ws.toCSV();

      expect(csv).toBe('');
    });

    it('quotes fields containing commas', async () => {
      (QueryOps.getUsedRange as jest.Mock).mockResolvedValue({
        startRow: 0,
        startCol: 0,
        endRow: 0,
        endCol: 0,
      });
      (RangeOps.getRange as jest.Mock).mockResolvedValue([[{ value: 'hello, world' }]]);

      const csv = await ws.toCSV();

      expect(csv).toBe('"hello, world"');
    });

    it('escapes double quotes as ""', async () => {
      (QueryOps.getUsedRange as jest.Mock).mockResolvedValue({
        startRow: 0,
        startCol: 0,
        endRow: 0,
        endCol: 0,
      });
      (RangeOps.getRange as jest.Mock).mockResolvedValue([[{ value: 'say "hi"' }]]);

      const csv = await ws.toCSV();

      expect(csv).toBe('"say ""hi"""');
    });

    it('quotes fields containing embedded newlines', async () => {
      (QueryOps.getUsedRange as jest.Mock).mockResolvedValue({
        startRow: 0,
        startCol: 0,
        endRow: 0,
        endCol: 2,
      });
      (RangeOps.getRange as jest.Mock).mockResolvedValue([
        [{ value: 'Dave' }, { value: 'line1\nline2' }, { value: 4 }],
      ]);

      const csv = await ws.toCSV();

      expect(csv).toBe('Dave,"line1\nline2",4');
    });

    it('protects formula injection (= + - @ prefixed with tab)', async () => {
      (QueryOps.getUsedRange as jest.Mock).mockResolvedValue({
        startRow: 0,
        startCol: 0,
        endRow: 3,
        endCol: 0,
      });
      (RangeOps.getRange as jest.Mock).mockResolvedValue([
        [{ value: '=cmd' }],
        [{ value: '+danger' }],
        [{ value: '-bad' }],
        [{ value: '@evil' }],
      ]);

      const csv = await ws.toCSV();

      const lines = csv.split('\r\n');
      expect(lines[0]).toBe('\t=cmd');
      expect(lines[1]).toBe('\t+danger');
      expect(lines[2]).toBe('\t-bad');
      expect(lines[3]).toBe('\t@evil');
    });

    it('uses custom separator', async () => {
      (QueryOps.getUsedRange as jest.Mock).mockResolvedValue({
        startRow: 0,
        startCol: 0,
        endRow: 0,
        endCol: 1,
      });
      (RangeOps.getRange as jest.Mock).mockResolvedValue([[{ value: 'A' }, { value: 'B' }]]);

      const csv = await ws.toCSV({ separator: ';' });

      expect(csv).toBe('A;B');
    });
  });

  // =========================================================================
  // toJSON
  // =========================================================================

  describe('toJSON()', () => {
    it('returns array of objects keyed by first row headers', async () => {
      (QueryOps.getUsedRange as jest.Mock).mockResolvedValue({
        startRow: 0,
        startCol: 0,
        endRow: 2,
        endCol: 1,
      });
      (RangeOps.getRange as jest.Mock).mockResolvedValue([
        [{ value: 'Name' }, { value: 'Age' }],
        [{ value: 'Alice' }, { value: 30 }],
        [{ value: 'Bob' }, { value: 25 }],
      ]);

      const result = await ws.toJSON();

      expect(result).toEqual([
        { Name: 'Alice', Age: 30 },
        { Name: 'Bob', Age: 25 },
      ]);
    });

    it('returns empty array for empty sheet', async () => {
      (QueryOps.getUsedRange as jest.Mock).mockResolvedValue(null);

      const result = await ws.toJSON();

      expect(result).toEqual([]);
    });

    it('uses column letters as keys when headerRow is "none"', async () => {
      (QueryOps.getUsedRange as jest.Mock).mockResolvedValue({
        startRow: 0,
        startCol: 0,
        endRow: 1,
        endCol: 1,
      });
      (RangeOps.getRange as jest.Mock).mockResolvedValue([
        [{ value: 1 }, { value: 2 }],
        [{ value: 3 }, { value: 4 }],
      ]);

      const result = await ws.toJSON({ headerRow: 'none' });

      expect(result).toEqual([
        { A: 1, B: 2 },
        { A: 3, B: 4 },
      ]);
    });
  });
});
