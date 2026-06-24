/**
 * WorksheetImpl Extended Methods -- Unit Tests
 *
 * Tests the "extended" methods on WorksheetImpl: gap-closure methods,
 * calculated-column methods, and filter-migration methods.
 *
 * Every test verifies the delegation pattern: the WorksheetImpl method calls
 * the correct underlying function (computeBridge or operation-module) with
 * the correct arguments and returns the expected result.
 *
 * NOTE: Many sub-APIs have been flattened to call computeBridge directly.
 * Tests for those paths mock and assert against `ctx.computeBridge.*` methods.
 * Sub-APIs that still delegate through operations modules (GroupingOps, CFOps,
 * FormatOps, CellOps, QueryOps) continue to mock those modules.
 */

import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import {
  worksheetTableOpsMock,
  worksheetValidationOpsMock,
} from './helpers/worksheet-impl-esm-mocks';

// ---------------------------------------------------------------------------
// Mock transitive dependencies first to prevent ESM import chain issues
// ---------------------------------------------------------------------------
jest.unstable_mockModule('../../floating-objects', () => ({
  createSpreadsheetObjectManager: jest.fn(),
}));
jest.unstable_mockModule('../../context', () => ({}));
jest.unstable_mockModule('../workbook/operations/sheet-crud-operations', () => ({
  renameSheet: jest.fn(),
  setSheetHidden: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Mock operation modules (still transitively loaded by production code).
// ESM Jest no longer turns automocked TS module exports into jest.fn reliably,
// so keep these suites on explicit factories.
// ---------------------------------------------------------------------------
jest.unstable_mockModule('../worksheet/operations/cell-operations', () => ({
  getCell: jest.fn(),
  getValue: jest.fn(),
  getDisplayValue: jest.fn(),
  getFormula: jest.fn(),
  getFormat: jest.fn(),
  getRawCellData: jest.fn(),
  getFormulaBarValue: jest.fn(),
  getValueForEditing: jest.fn(),
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
jest.unstable_mockModule(
  '../worksheet/operations/validation-operations',
  () => worksheetValidationOpsMock,
);
jest.unstable_mockModule('../worksheet/operations/filter-operations', () => ({}));
jest.unstable_mockModule('../worksheet/operations/shape-operations', () => ({}));
jest.unstable_mockModule('../worksheet/operations/floating-object-operations', () => ({}));
jest.unstable_mockModule('../worksheet/operations/sort-operations', () => ({}));
jest.unstable_mockModule('../worksheet/operations/cf-operations', () => ({
  cloneConditionalFormatsForPaste: jest.fn(),
}));
jest.unstable_mockModule('../worksheet/operations/grouping-operations', () => ({
  toggleGroupCollapsed: jest.fn(),
  expandAllGroups: jest.fn(),
  collapseAllGroups: jest.fn(),
  subtotal: jest.fn(),
}));
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
jest.unstable_mockModule('../worksheet/operations/table-operations', () => worksheetTableOpsMock);
jest.unstable_mockModule('../worksheet/operations/drawing-operations', () => ({}));

// Domain modules used directly by WorksheetImpl
jest.unstable_mockModule('../../domain/cells/cell-viewport-iteration', () => ({}));
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
jest.unstable_mockModule('../../domain/charts/chart-store', () => ({ getAll: jest.fn() }));
jest.unstable_mockModule('../../domain/formulas/named-ranges', () => ({
  getVisible: jest.fn(),
  getRefersToA1: jest.fn(),
}));
jest.unstable_mockModule('../../domain/sheets/sheet-meta', () => ({ getMeta: jest.fn() }));
jest.unstable_mockModule('../../domain/tables/core', () => ({
  getTablesInSheet: jest.fn(),
  getTable: jest.fn(),
}));
// ---------------------------------------------------------------------------
// Import mocked modules for assertions after ESM mocks are registered.
// ---------------------------------------------------------------------------
const { WorksheetImpl } = await import('../worksheet/worksheet-impl');
const CellOps = await import('../worksheet/operations/cell-operations');
const CFOps = await import('../worksheet/operations/cf-operations');
const FormatOps = await import('../worksheet/operations/format-operations');
const GroupingOps = await import('../worksheet/operations/grouping-operations');
const QueryOps = await import('../worksheet/operations/query-operations');
const TableOps = await import('../worksheet/operations/table-operations');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SHEET_ID = sheetId('sheet-1');

function expectVersionOperationOptions(operationIdPrefix: string, domainIds: readonly string[]) {
  return expect.objectContaining({
    operationContext: expect.objectContaining({
      operationId: expect.stringMatching(
        new RegExp(`^${operationIdPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`),
      ),
      kind: 'mutation',
      author: expect.objectContaining({ actorKind: 'user' }),
      sheetIds: [SHEET_ID],
      domainIds,
      capturePolicy: 'commitEligible',
      writeAdmissionMode: 'capture',
    }),
  });
}

function createMockCtx(): any {
  const eventHandlers = new Map<string, Set<(event: any) => void>>();
  const eventBus = {
    on: jest.fn((type: string, handler: (event: any) => void) => {
      if (!eventHandlers.has(type)) eventHandlers.set(type, new Set());
      eventHandlers.get(type)!.add(handler);
      return () => eventHandlers.get(type)?.delete(handler);
    }),
    onMany: jest.fn((types: string[], handler: (event: any) => void) => {
      const unsubscribers = types.map((type) => eventBus.on(type, handler));
      return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
    }),
    emit: jest.fn((event: any) => {
      for (const handler of eventHandlers.get(event.type) ?? []) {
        handler(event);
      }
    }),
  };
  return {
    eventBus,
    mirror: {
      getSheetSettings: jest.fn().mockReturnValue({ isProtected: false }),
      getFrozenPanes: jest.fn().mockReturnValue({ rows: 0, cols: 0 }),
      getViewOptions: jest.fn().mockReturnValue({
        showGridlines: true,
        showRowHeaders: true,
        showColumnHeaders: true,
      }),
    },
    writeGate: {
      assertWritable: jest.fn(),
    },
    awaitMaterialized: jest.fn().mockResolvedValue(undefined),
    getMaterializationState: jest.fn(() => ({
      phase: 'AllSheetsReady',
      isDeferred: false,
      isMaterialized: true,
    })),
    computeBridge: {
      getSheetProtectionOptions: jest.fn().mockResolvedValue(null),
      hasSheetProtectionPassword: jest.fn().mockResolvedValue(false),
      getTabColor: jest.fn().mockResolvedValue(null),
      getTabColorQuery: jest.fn().mockResolvedValue(null),
      setTabColor: jest.fn().mockResolvedValue(undefined),
      renameTable: jest.fn().mockResolvedValue(undefined),
      toggleBandedRows: jest.fn().mockResolvedValue(undefined),
      toggleBandedCols: jest.fn().mockResolvedValue(undefined),
      toggleHeaderRow: jest.fn().mockResolvedValue(undefined),
      toggleTotalsRow: jest.fn().mockResolvedValue(undefined),
      setTable: jest.fn().mockResolvedValue(undefined),
      setTableStyle: jest.fn().mockResolvedValue(undefined),
      updateSlicerConfig: jest.fn().mockResolvedValue(undefined),
      getSlicerState: jest.fn().mockResolvedValue(null),
      getAllSlicers: jest.fn().mockResolvedValue([]),
      getAllTablesWorkbook: jest.fn().mockResolvedValue([]),
      resizeTable: jest.fn().mockResolvedValue(undefined),
      addTableColumn: jest.fn().mockResolvedValue(undefined),
      removeTableColumn: jest.fn().mockResolvedValue(undefined),
      getDataBounds: jest.fn().mockResolvedValue({ maxRow: 100, maxCol: 50 }),
      isSheetProtected: jest.fn().mockResolvedValue(false),
      canEditCell: jest.fn().mockResolvedValue(true),
      canDoStructureOp: jest.fn().mockResolvedValue(true),
      getViewOptions: jest.fn().mockResolvedValue({
        show_gridlines: true,
        show_row_headers: true,
        show_column_headers: true,
      }),
      getViewOptionsQuery: jest.fn().mockResolvedValue({
        showGridlines: true,
        showRowHeaders: true,
        showColumnHeaders: true,
      }),
      getCellIdAtPosition: jest.fn().mockResolvedValue(null),
      getCellIdAt: jest.fn().mockResolvedValue(null),
      getActiveCell: jest.fn().mockResolvedValue(null),
      refreshActiveCell: jest.fn().mockResolvedValue(undefined),
      getValueForEditing: jest.fn().mockResolvedValue(''),
      getCellFormat: jest.fn().mockResolvedValue(null),
      prepareDateValue: jest.fn().mockResolvedValue({
        serial: 44561,
        formatToApply: 'mm/dd/yyyy',
      }),
      prepareTimeValue: jest.fn().mockResolvedValue({
        serial: 0.5,
        formatToApply: 'h:mm:ss',
      }),
      structureChange: jest.fn().mockResolvedValue({ structureChanges: [] }),
      setCell: jest.fn().mockResolvedValue(undefined),
      setCellValueParsed: jest.fn().mockResolvedValue(undefined),
      setCellFormat: jest.fn().mockResolvedValue(undefined),
      setCells: jest.fn().mockResolvedValue(undefined),
      setCellsByPosition: jest.fn().mockResolvedValue(undefined),
      autoFill: jest.fn().mockResolvedValue({ data: { patternType: 'copy', filledCellCount: 0 } }),
      beginUndoGroup: jest.fn().mockResolvedValue(undefined),
      endUndoGroup: jest.fn().mockResolvedValue(undefined),
      getProjectionRange: jest.fn().mockResolvedValue(null),
      getProjectionSource: jest.fn().mockResolvedValue(null),
      isProjectedPosition: jest.fn().mockResolvedValue(false),
      hideRows: jest.fn().mockResolvedValue(undefined),
      hideColumns: jest.fn().mockResolvedValue(undefined),
      unhideRows: jest.fn().mockResolvedValue(undefined),
      unhideColumns: jest.fn().mockResolvedValue(undefined),
      isRowHiddenQuery: jest.fn().mockResolvedValue(false),
      isColHiddenQuery: jest.fn().mockResolvedValue(false),
      getFiltersInSheet: jest.fn().mockResolvedValue([]),
      getFilterHeaderInfo: jest.fn().mockResolvedValue([]),
      applyFilter: jest.fn().mockResolvedValue(undefined),
      setColumnFilter: jest.fn().mockResolvedValue(undefined),
      clearColumnFilter: jest.fn().mockResolvedValue(undefined),
      clearAllColumnFilters: jest.fn().mockResolvedValue(undefined),
      getUniqueColumnValues: jest.fn().mockResolvedValue([]),
      setFrozenPanes: jest.fn().mockResolvedValue(undefined),
      freezeRows: jest.fn().mockResolvedValue(undefined),
      freezeColumns: jest.fn().mockResolvedValue(undefined),
      getFrozenPanes: jest.fn().mockResolvedValue({ rows: 0, cols: 0 }),
      getFrozenPanesQuery: jest.fn().mockResolvedValue({ rows: 0, cols: 0 }),
      insertCellsWithShift: jest.fn().mockResolvedValue(undefined),
      deleteCellsWithShift: jest.fn().mockResolvedValue(undefined),
      relocateCells: jest.fn().mockResolvedValue(undefined),
      getRowHeightsBatch: jest.fn().mockResolvedValue([]),
      getColWidthsBatch: jest.fn().mockResolvedValue([]),
      getTableAtCell: jest.fn().mockResolvedValue(null),
      getTableByName: jest.fn().mockResolvedValue(null),
      tableValidateTableName: jest.fn().mockResolvedValue({ valid: true }),
      getAllTablesInSheet: jest.fn().mockResolvedValue([]),
      deleteTable: jest.fn().mockResolvedValue(undefined),
      createTable: jest.fn().mockResolvedValue(undefined),
      createTableLifecycle: jest.fn().mockResolvedValue(undefined),
      detectAutoExpansion: jest.fn().mockResolvedValue({
        shouldExpand: false,
        newEndRow: 9,
        newEndCol: 3,
      }),
      applyAutoExpansion: jest.fn().mockResolvedValue(undefined),
      queryRange: jest.fn().mockResolvedValue({ cells: [], merges: [] }),
      getCellPosition: jest.fn().mockResolvedValue(null),
      deleteFilter: jest.fn().mockResolvedValue(undefined),
      createFilter: jest.fn().mockResolvedValue(undefined),
      createSlicer: jest.fn().mockResolvedValue(undefined),
      deleteSlicer: jest.fn().mockResolvedValue(undefined),
      clearSlicerSelection: jest.fn().mockResolvedValue(undefined),
      toggleSlicerItem: jest.fn().mockResolvedValue(undefined),
      protectSheet: jest.fn().mockResolvedValue(undefined),
      unprotectSheet: jest.fn().mockResolvedValue(undefined),
      getSplitConfig: jest.fn().mockResolvedValue(null),
      setSplitConfig: jest.fn().mockResolvedValue(undefined),
      getHiddenRows: jest.fn().mockResolvedValue([]),
      getFilterHiddenRows: jest.fn().mockResolvedValue([]),
      getHiddenColumns: jest.fn().mockResolvedValue([]),
      getRowHeightQuery: jest.fn().mockResolvedValue(20),
      setRowHeight: jest.fn().mockResolvedValue(undefined),
      getColWidthQuery: jest.fn().mockResolvedValue(100),
      setColWidth: jest.fn().mockResolvedValue(undefined),
      setColWidths: jest.fn().mockResolvedValue(undefined),
      getColWidthCharsQuery: jest.fn().mockResolvedValue(8.43),
      setColWidthChars: jest.fn().mockResolvedValue(undefined),
      setColWidthsChars: jest.fn().mockResolvedValue(undefined),
      getColWidthsBatch: jest.fn().mockResolvedValue([]),
      getColWidthsBatchChars: jest.fn().mockResolvedValue([]),
      getDefaultColWidthChars: jest.fn().mockResolvedValue(8.43),
      getSheetVisibility: jest.fn().mockResolvedValue('visible'),
      updateCalculatedColumn: jest.fn().mockResolvedValue(undefined),
      removeCalculatedColumn: jest.fn().mockResolvedValue(undefined),
    },
  };
}

// =============================================================================
// Test Groups
// =============================================================================

describe('WorksheetImpl Extended Methods', () => {
  let ws: InstanceType<typeof WorksheetImpl>;
  let ctx: any;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx = createMockCtx();
    ctx.computeBridge.getTableByName.mockResolvedValue({ raw: 'bridge-table' });
    (TableOps.bridgeTableToTableInfo as jest.Mock).mockReturnValue({
      id: 'Table1',
      name: 'Table1',
      range: 'A1:D10',
      hasHeaderRow: true,
      hasTotalsRow: false,
      columns: [
        { id: '1', name: 'A', index: 0 },
        { id: '2', name: 'B', index: 1 },
        { id: '3', name: 'Price', index: 2 },
      ],
    });
    ws = new WorksheetImpl(SHEET_ID, ctx);
  });

  // =========================================================================
  // Group 1: Visibility & Sheet Properties
  // =========================================================================
  describe('Group 1: Visibility & Sheet Properties', () => {
    it('isProtected delegates to computeBridge.isSheetProtected', async () => {
      ctx.computeBridge.isSheetProtected.mockResolvedValue(true);

      const result = await ws.protection.isProtected();

      expect(ctx.computeBridge.isSheetProtected).toHaveBeenCalledWith(SHEET_ID);
      expect(result).toBe(true);
    });

    it('getProtectionConfig delegates to computeBridge.getSheetProtectionOptions', async () => {
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
        useAutoFilter: true,
        usePivotTableReports: false,
      });

      const result = await ws.protection.getConfig();

      expect(ctx.computeBridge.getSheetProtectionOptions).toHaveBeenCalledWith(SHEET_ID);
      expect(result.isProtected).toBe(true);
      expect(result.allowSort).toBe(true);
      expect(result.allowPivotTables).toBe(false);
    });

    it('getProtectionConfig returns defaults when bridge returns null', async () => {
      ctx.computeBridge.getSheetProtectionOptions.mockResolvedValue(null);

      const result = await ws.protection.getConfig();

      expect(result.isProtected).toBe(false);
      expect(result.allowSort).toBeUndefined();
    });

    it('isRowHidden delegates to computeBridge.isRowHiddenQuery', async () => {
      ctx.computeBridge.isRowHiddenQuery.mockResolvedValue(true);

      const result = await ws.layout.isRowHidden(5);

      expect(ctx.computeBridge.isRowHiddenQuery).toHaveBeenCalledWith(SHEET_ID, 5);
      expect(result).toBe(true);
    });

    it('isColumnHidden delegates to computeBridge.isColHiddenQuery', async () => {
      ctx.computeBridge.isColHiddenQuery.mockResolvedValue(false);

      const result = await ws.layout.isColumnHidden(3);

      expect(ctx.computeBridge.isColHiddenQuery).toHaveBeenCalledWith(SHEET_ID, 3);
      expect(result).toBe(false);
    });

    it('getFilterHiddenRowsBitmap delegates to computeBridge.getFilterHiddenRows', async () => {
      ctx.computeBridge.getFilterHiddenRows.mockResolvedValue([2, 4]);

      const result = await ws.layout.getFilterHiddenRowsBitmap();

      expect(ctx.computeBridge.getFilterHiddenRows).toHaveBeenCalledWith(SHEET_ID);
      expect(result).toEqual(new Set([2, 4]));
    });

    it('getTabColor delegates to computeBridge.getTabColorQuery', async () => {
      ctx.computeBridge.getTabColorQuery.mockResolvedValue('#FF0000');

      const result = await ws.view.getTabColor();

      expect(ctx.computeBridge.getTabColorQuery).toHaveBeenCalledWith(SHEET_ID);
      expect(result).toBe('#FF0000');
    });

    it('setTabColor delegates to computeBridge.setTabColor', async () => {
      await ws.view.setTabColor('#00FF00');

      expect(ctx.computeBridge.setTabColor).toHaveBeenCalledWith(
        SHEET_ID,
        '#00FF00',
        expectVersionOperationOptions('worksheet.view.setTabColor', ['sheets']),
      );
    });

    it('setTabColor with null clears the color', async () => {
      await ws.view.setTabColor(null);

      expect(ctx.computeBridge.setTabColor).toHaveBeenCalledWith(
        SHEET_ID,
        null,
        expectVersionOperationOptions('worksheet.view.setTabColor', ['sheets']),
      );
    });

    it('getVisibility returns visible or hidden based on cached value', async () => {
      expect(await ws.getVisibility()).toBe('visible');
    });

    it('unhideRows delegates to computeBridge.unhideRows', async () => {
      await ws.layout.unhideRows(2, 5);

      // layout.ts expands (startRow, endRow) into an array of row indices
      expect(ctx.computeBridge.unhideRows).toHaveBeenCalledWith(SHEET_ID, [2, 3, 4, 5]);
    });

    it('unhideColumns delegates to computeBridge.unhideColumns', async () => {
      await ws.layout.unhideColumns(1, 3);

      // layout.ts expands (startCol, endCol) into an array of column indices
      expect(ctx.computeBridge.unhideColumns).toHaveBeenCalledWith(SHEET_ID, [1, 2, 3]);
    });
  });

  // =========================================================================
  // Group 2: Grouping Expand/Collapse
  // =========================================================================
  describe('Group 2: Grouping Expand/Collapse', () => {
    it('toggleGroupCollapsed delegates to GroupingOps.toggleGroupCollapsed', async () => {
      (GroupingOps.toggleGroupCollapsed as jest.Mock).mockResolvedValue({
        success: true,
        data: undefined,
      });

      await ws.outline.toggleCollapsed('group-1');

      expect(GroupingOps.toggleGroupCollapsed).toHaveBeenCalledWith(ctx, SHEET_ID, 'group-1');
    });

    it('expandAllGroups delegates to GroupingOps.expandAllGroups', async () => {
      (GroupingOps.expandAllGroups as jest.Mock).mockResolvedValue({
        success: true,
        data: undefined,
      });

      await ws.outline.expandAll();

      expect(GroupingOps.expandAllGroups).toHaveBeenCalledWith(ctx, SHEET_ID);
    });

    it('collapseAllGroups delegates to GroupingOps.collapseAllGroups', async () => {
      (GroupingOps.collapseAllGroups as jest.Mock).mockResolvedValue({
        success: true,
        data: undefined,
      });

      await ws.outline.collapseAll();

      expect(GroupingOps.collapseAllGroups).toHaveBeenCalledWith(ctx, SHEET_ID);
    });

    it('subtotal returns the typed result from GroupingOps.subtotal', async () => {
      const config = {
        range: { startRow: 0, startCol: 0, endRow: 4, endCol: 1 },
        hasHeaders: true,
        groupByColumn: 0,
        subtotalColumns: [1],
        aggregation: 'sum',
        replace: true,
        summaryBelowData: true,
      };
      const subtotalResult = {
        groupsCreated: 2,
        subtotalRowsInserted: 2,
        affectedRange: { startRow: 0, startCol: 0, endRow: 6, endCol: 1, address: 'A1:B7' },
      };
      (GroupingOps.subtotal as jest.Mock).mockResolvedValue({
        success: true,
        data: subtotalResult,
      });

      const result = await ws.outline.subtotal(config as any);

      expect(GroupingOps.subtotal).toHaveBeenCalledWith(ctx, SHEET_ID, config);
      expect(result).toEqual(subtotalResult);
    });
  });

  // =========================================================================
  // Group 3: View Options
  // =========================================================================
  describe('Group 3: View Options', () => {
    it('getViewOptions reads from the kernel mirror', async () => {
      const mockOptions = {
        showGridlines: true,
        showRowHeaders: false,
        showColumnHeaders: true,
      };
      ctx.mirror.getViewOptions.mockReturnValue(mockOptions);

      const result = await ws.view.getViewOptions();

      expect(ctx.mirror.getViewOptions).toHaveBeenCalledWith(SHEET_ID);
      expect(ctx.computeBridge.getViewOptionsQuery).not.toHaveBeenCalled();
      expect(result).toEqual(mockOptions);
    });
  });

  // =========================================================================
  // Group 4: CellId-Aware Filter Operations
  // =========================================================================
  describe('Group 4: CellId-Aware Filter Operations', () => {
    const mockAutoFilter = {
      id: 'filter-1',
      type: 'autoFilter',
      headerStartCellId: 'c-start',
      headerEndCellId: 'c-end',
      dataEndCellId: 'c-data-end',
      columnFilters: {},
    };

    it('setFilterCriteria delegates to computeBridge.setColumnFilter', async () => {
      ctx.computeBridge.getFiltersInSheet.mockResolvedValue([mockAutoFilter]);
      const criteria = { type: 'value', values: ['A', 'B'] };
      await ws.filters.setCriteria('filter-1', 0, criteria as any);

      expect(ctx.computeBridge.setColumnFilter).toHaveBeenCalledWith(SHEET_ID, 'filter-1', 0, {
        type: 'values',
        values: ['A', 'B'],
        includeBlanks: false,
      });
    });

    it('clearFilterCriteria delegates to computeBridge.clearColumnFilter', async () => {
      ctx.computeBridge.getFiltersInSheet.mockResolvedValue([mockAutoFilter]);
      await ws.filters.clearCriteria('filter-1', 1);

      expect(ctx.computeBridge.clearColumnFilter).toHaveBeenCalledWith(SHEET_ID, 'filter-1', 1);
    });

    it('clearAllFilterCriteria delegates to computeBridge.clearAllColumnFilters', async () => {
      ctx.computeBridge.getFiltersInSheet.mockResolvedValue([
        { ...mockAutoFilter, columnFilters: { 'c-start': { type: 'values', values: ['A'] } } },
      ]);
      await ws.filters.clearAllCriteria('filter-1');

      expect(ctx.computeBridge.clearAllColumnFilters).toHaveBeenCalledWith(SHEET_ID, 'filter-1');
    });

    it('listFilters delegates to computeBridge.getFiltersInSheet and returns full detail', async () => {
      ctx.computeBridge.getFiltersInSheet.mockResolvedValue([
        {
          id: 'f1',
          type: 'autoFilter',
          headerStartCellId: 'c-start',
          headerEndCellId: 'c-end',
          dataEndCellId: 'c-data-end',
          columnFilters: {},
        },
      ]);
      ctx.computeBridge.getCellPosition
        .mockResolvedValueOnce({ row: 0, col: 0 }) // headerStartCellId
        .mockResolvedValueOnce({ row: 0, col: 3 }) // headerEndCellId
        .mockResolvedValueOnce({ row: 9, col: 3 }); // dataEndCellId

      const result = await ws.filters.list();

      expect(ctx.computeBridge.getFiltersInSheet).toHaveBeenCalledWith(SHEET_ID);
      expect(result).toEqual([
        {
          id: 'f1',
          filterKind: 'autoFilter',
          range: { startRow: 0, startCol: 0, endRow: 9, endCol: 3 },
          columnFilters: {},
        },
      ]);
    });

    it('listSummaries returns compact range and activity metadata', async () => {
      ctx.computeBridge.getFiltersInSheet.mockResolvedValue([
        {
          id: 'f1',
          type: 'autoFilter',
          headerStartCellId: 'c-start',
          headerEndCellId: 'c-end',
          dataEndCellId: 'c-data-end',
          columnFilters: { 'c-b': { type: 'values', values: ['KeepCo'], includeBlanks: false } },
        },
      ]);
      ctx.computeBridge.getCellPosition
        .mockResolvedValueOnce({ row: 0, col: 0 })
        .mockResolvedValueOnce({ row: 0, col: 3 })
        .mockResolvedValueOnce({ row: 11, col: 3 });

      const result = await ws.filters.listSummaries();

      expect(ctx.awaitMaterialized).toHaveBeenCalledWith(SHEET_ID);
      expect(result).toEqual([
        {
          id: 'f1',
          filterKind: 'autoFilter',
          range: { startRow: 0, startCol: 0, endRow: 11, endCol: 3 },
          activeColumnCount: 1,
          hasActiveCriteria: true,
          hasActiveFilter: true,
          clearable: true,
          detailsReady: true,
          capability: 'supported',
          unsupportedReasons: [],
        },
      ]);
    });

    it('listSummaries treats unsupported imported shell header state as active and clearable', async () => {
      ctx.computeBridge.getFiltersInSheet.mockResolvedValue([
        {
          id: 'f1',
          type: 'autoFilter',
          headerStartCellId: 'c-start',
          headerEndCellId: 'c-end',
          dataEndCellId: 'c-data-end',
          columnFilters: {},
        },
      ]);
      ctx.computeBridge.getFilterHeaderInfo.mockResolvedValue([
        {
          filterId: 'f1',
          filterKind: 'autoFilter',
          range: { startRow: 0, startCol: 0, endRow: 11, endCol: 3 },
          row: 0,
          col: 2,
          headerCellId: 'c-vendor',
          hasActiveFilter: true,
          sourceType: 'sheetAutoFilter',
          capability: 'unsupported',
          unsupportedReasons: ['iconFilterUnsupported'],
          buttonVisible: true,
          hiddenButton: false,
          showButton: true,
        },
      ]);
      ctx.computeBridge.getCellPosition
        .mockResolvedValueOnce({ row: 0, col: 0 })
        .mockResolvedValueOnce({ row: 0, col: 3 })
        .mockResolvedValueOnce({ row: 11, col: 3 });

      const result = await ws.filters.listSummaries();

      expect(result).toEqual([
        {
          id: 'f1',
          filterKind: 'autoFilter',
          range: { startRow: 0, startCol: 0, endRow: 11, endCol: 3 },
          activeColumnCount: 0,
          hasActiveCriteria: true,
          hasActiveFilter: true,
          clearable: true,
          detailsReady: true,
          capability: 'unsupported',
          unsupportedReasons: ['iconFilterUnsupported'],
        },
      ]);
    });

    it('listHeaderInfo returns renderer-ready header entries', async () => {
      ctx.computeBridge.getFilterHeaderInfo.mockResolvedValue([
        {
          id: 'f1',
          filterId: 'f1',
          filterKind: 'autoFilter',
          range: { startRow: 0, startCol: 0, endRow: 11, endCol: 2 },
          row: 0,
          col: 0,
          headerCellId: 'c-start',
          hasActiveFilter: false,
          sourceType: 'sheetAutoFilter',
          capability: 'unsupported',
          unsupportedReasons: ['iconFilterUnsupported'],
          buttonVisible: false,
          hiddenButton: true,
          showButton: false,
        },
        {
          filterId: 'f1',
          filterKind: 'autoFilter',
          range: { startRow: 0, startCol: 0, endRow: 11, endCol: 2 },
          row: 0,
          col: 1,
          headerCellId: 'c-b',
          hasActiveFilter: true,
          sourceType: 'sheetAutoFilter',
          capability: 'supported',
          unsupportedReasons: [],
          buttonVisible: true,
          hiddenButton: false,
          showButton: true,
        },
        {
          filterId: 'f1',
          filterKind: 'autoFilter',
          range: { startRow: 0, startCol: 0, endRow: 11, endCol: 2 },
          row: 0,
          col: 2,
          headerCellId: 'c-end',
          hasActiveFilter: false,
          sourceType: 'sheetAutoFilter',
          capability: 'supported',
          unsupportedReasons: [],
          buttonVisible: true,
          hiddenButton: false,
          showButton: true,
        },
      ]);

      const result = await ws.filters.listHeaderInfo();

      expect(ctx.computeBridge.getFilterHeaderInfo).toHaveBeenCalledWith(SHEET_ID);
      expect(result).toEqual([
        {
          row: 0,
          col: 0,
          filterId: 'f1',
          filterKind: 'autoFilter',
          range: { startRow: 0, startCol: 0, endRow: 11, endCol: 2 },
          headerCellId: 'c-start',
          hasActiveFilter: false,
          sourceType: 'sheetAutoFilter',
          capability: 'unsupported',
          unsupportedReasons: ['iconFilterUnsupported'],
          buttonVisible: false,
          hiddenButton: true,
          showButton: false,
        },
        {
          row: 0,
          col: 1,
          filterId: 'f1',
          filterKind: 'autoFilter',
          range: { startRow: 0, startCol: 0, endRow: 11, endCol: 2 },
          headerCellId: 'c-b',
          hasActiveFilter: true,
          sourceType: 'sheetAutoFilter',
          capability: 'supported',
          unsupportedReasons: [],
          buttonVisible: true,
          hiddenButton: false,
          showButton: true,
        },
        {
          row: 0,
          col: 2,
          filterId: 'f1',
          filterKind: 'autoFilter',
          range: { startRow: 0, startCol: 0, endRow: 11, endCol: 2 },
          headerCellId: 'c-end',
          hasActiveFilter: false,
          sourceType: 'sheetAutoFilter',
          capability: 'supported',
          unsupportedReasons: [],
          buttonVisible: true,
          hiddenButton: false,
          showButton: true,
        },
      ]);
    });
  });

  // =========================================================================
  // Group 5: Slicer Config Updates
  // =========================================================================
  describe('Group 5: Slicer Config Updates', () => {
    it('updateSlicerConfig delegates to computeBridge.updateSlicerConfig', async () => {
      const updates = { caption: 'New Caption' };

      await ws.slicers.update('slicer-1', updates as any);

      expect(ctx.computeBridge.updateSlicerConfig).toHaveBeenCalledWith(
        SHEET_ID,
        'slicer-1',
        updates,
      );
    });

    it('getSlicerState delegates to computeBridge.getSlicerState', async () => {
      const mockState = {
        caption: 'Slicer 1',
        source: { type: 'table', tableId: 'T1', columnCellId: 'C1' },
        selectedValues: ['A'],
        position: { x: 0, y: 0, width: 200, height: 300 },
        style: null,
        zIndex: 0,
        locked: false,
        showHeader: true,
      };
      ctx.computeBridge.getSlicerState.mockResolvedValue(mockState);
      ctx.computeBridge.getTableByName.mockResolvedValue(null);

      const result = await ws.slicers.getState('slicer-1');

      expect(ctx.computeBridge.getSlicerState).toHaveBeenCalledWith(SHEET_ID, 'slicer-1');
      expect(result).toEqual({
        items: [],
        isConnected: false,
        selectedValues: ['A'],
        periods: undefined,
      });
    });

    it('getAllSlicersInSheet delegates to computeBridge.getAllSlicers', async () => {
      const mockSlicers = [
        {
          id: 'slicer-1',
          caption: 'Slicer 1',
          source: { type: 'table', tableId: 'Table1', columnCellId: 'Col1' },
        },
      ];
      ctx.computeBridge.getAllSlicers.mockResolvedValue(mockSlicers);

      const result = await ws.slicers.list();

      expect(ctx.computeBridge.getAllSlicers).toHaveBeenCalledWith(SHEET_ID);
      expect(result).toEqual([
        {
          id: 'slicer-1',
          name: 'Slicer 1',
          caption: 'Slicer 1',
          tableName: 'Table1',
          columnName: 'Col1',
          source: { type: 'table', tableId: 'Table1', columnCellId: 'Col1' },
        },
      ]);
    });
  });

  // =========================================================================
  // Group 6: Table Metadata Operations
  // =========================================================================
  describe('Group 6: Table Metadata Operations', () => {
    it('getTableAtCell delegates to computeBridge.getTableAtCell', async () => {
      // The bridge returns raw table data; bridgeTableToTableInfo converts it.
      // We mock bridgeTableToTableInfo via the table-operations mock.
      const mockTable = { name: 'Table1', range: 'A1:D10', hasHeaders: true };
      (TableOps.bridgeTableToTableInfo as jest.Mock).mockReturnValue(mockTable);
      ctx.computeBridge.getTableAtCell.mockResolvedValue({ raw: 'bridge-data' });

      const result = await ws.tables.getAtCell(0, 0);

      expect(ctx.computeBridge.getTableAtCell).toHaveBeenCalledWith(SHEET_ID, 0, 0);
      expect(TableOps.bridgeTableToTableInfo).toHaveBeenCalledWith({ raw: 'bridge-data' });
      expect(result).toEqual(mockTable);
    });

    it('getTableAtCell returns null when no table', async () => {
      ctx.computeBridge.getTableAtCell.mockResolvedValue(null);

      const result = await ws.tables.getAtCell(50, 50);

      expect(result).toBeNull();
    });

    it('renameTable validates before delegating to computeBridge.renameTable', async () => {
      await ws.tables.rename('OldName', 'NewName');

      expect(ctx.computeBridge.tableValidateTableName).toHaveBeenCalledWith('NewName', []);
      expect(ctx.computeBridge.renameTable).toHaveBeenCalledWith(
        'OldName',
        'NewName',
        expectVersionOperationOptions('tables.rename', ['tables']),
      );
    });

    it('renameTable rejects invalid names before compute rename', async () => {
      ctx.computeBridge.tableValidateTableName.mockResolvedValueOnce({
        valid: false,
        reason: 'Table name can only contain letters, digits, and underscores',
      });

      await expect(ws.tables.rename('Table1', 'Bad Name')).rejects.toMatchObject({
        code: 'TABLE_INVALID_NAME',
        message: 'Table name can only contain letters, digits, and underscores',
      });
      expect(ctx.computeBridge.renameTable).not.toHaveBeenCalled();
    });

    it('renameTable excludes the current table from duplicate validation', async () => {
      ctx.computeBridge.getAllTablesInSheet.mockResolvedValueOnce([
        { name: 'Table1', range: 'A1:B2' },
        { name: 'OtherTable', range: 'D1:E2' },
      ]);
      (TableOps.bridgeTableToTableInfo as jest.Mock)
        .mockReturnValueOnce({ name: 'Table1', range: 'A1:B2' })
        .mockReturnValueOnce({ name: 'OtherTable', range: 'D1:E2' });

      await ws.tables.rename('Table1', 'table1');

      expect(ctx.computeBridge.tableValidateTableName).toHaveBeenCalledWith('table1', [
        'OtherTable',
      ]);
      expect(ctx.computeBridge.renameTable).toHaveBeenCalledWith(
        'Table1',
        'table1',
        expectVersionOperationOptions('tables.rename', ['tables']),
      );
    });

    it('addTable with style delegates to one Rust lifecycle command', async () => {
      const tableInfo = {
        id: 'StyledPeople',
        name: 'StyledPeople',
        range: 'A1:B2',
        hasHeaderRow: true,
        hasTotalsRow: false,
        columns: [
          { id: '1', name: 'Name', index: 0 },
          { id: '2', name: 'Age', index: 1 },
        ],
        style: 'TableStyleMedium4',
        bandedRows: true,
        bandedColumns: false,
        emphasizeFirstColumn: false,
        emphasizeLastColumn: false,
        showFilterButtons: true,
      };
      ctx.computeBridge.getTableAtCell.mockResolvedValue({ raw: 'created-table' });
      (TableOps.bridgeTableToTableInfo as jest.Mock).mockReturnValue(tableInfo);

      const result = await ws.tables.add('A1:B2', {
        name: 'StyledPeople',
        hasHeaders: true,
        style: 'TableStyleMedium4',
      });

      expect(ctx.computeBridge.createTableLifecycle).toHaveBeenCalledWith(
        SHEET_ID,
        'StyledPeople',
        0,
        0,
        1,
        1,
        [],
        true,
        'TableStyleMedium4',
        expectVersionOperationOptions('tables.add', ['tables']),
      );
      expect(ctx.computeBridge.createTable).not.toHaveBeenCalled();
      expect(ctx.computeBridge.setTableStyle).not.toHaveBeenCalled();
      expect(ctx.computeBridge.setCellsByPosition).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ kind: 'tableAdd', table: tableInfo }));
      expect(ctx.eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'table:created',
          tableId: 'StyledPeople',
        }),
      );
    });

    it('addTable without headers leaves generated-header lifecycle in Rust', async () => {
      const tableInfo = {
        id: 'GeneratedHeaders',
        name: 'GeneratedHeaders',
        range: 'A1:B3',
        hasHeaderRow: true,
        hasTotalsRow: false,
        columns: [
          { id: '1', name: 'Column1', index: 0 },
          { id: '2', name: 'Column2', index: 1 },
        ],
        style: 'TableStyleMedium2',
        bandedRows: true,
        bandedColumns: false,
        emphasizeFirstColumn: false,
        emphasizeLastColumn: false,
        showFilterButtons: true,
      };
      ctx.computeBridge.getTableAtCell.mockResolvedValue({ raw: 'created-table' });
      (TableOps.bridgeTableToTableInfo as jest.Mock).mockReturnValue(tableInfo);

      await ws.tables.add('A1:B2', { name: 'GeneratedHeaders', hasHeaders: false });

      expect(ctx.computeBridge.createTableLifecycle).toHaveBeenCalledWith(
        SHEET_ID,
        'GeneratedHeaders',
        0,
        0,
        1,
        1,
        [],
        false,
        null,
        expectVersionOperationOptions('tables.add', ['tables']),
      );
      expect(ctx.computeBridge.createTable).not.toHaveBeenCalled();
      expect(ctx.computeBridge.setTableStyle).not.toHaveBeenCalled();
      expect(ctx.computeBridge.setCellsByPosition).not.toHaveBeenCalled();
    });

    it('updateTable with style updates calls computeBridge.setTableStyle', async () => {
      await ws.tables.update('Table1', { style: 'TableStyleLight1' });

      expect(ctx.computeBridge.setTableStyle).toHaveBeenCalledWith(
        'Table1',
        'TableStyleLight1',
        expectVersionOperationOptions('tables.update', ['tables']),
      );
    });

    it('updateTable rejects invalid renamed names before compute rename', async () => {
      ctx.computeBridge.getTableByName.mockResolvedValueOnce({ raw: 'bridge-table' });
      (TableOps.bridgeTableToTableInfo as jest.Mock).mockReturnValueOnce({
        name: 'Table1',
        range: 'A1:B2',
        hasHeaderRow: true,
        hasTotalsRow: false,
        columns: [],
      });
      ctx.computeBridge.tableValidateTableName.mockResolvedValueOnce({
        valid: false,
        reason: 'Table name cannot be a cell reference',
      });

      await expect(ws.tables.update('Table1', { name: 'A1' })).rejects.toMatchObject({
        code: 'TABLE_INVALID_NAME',
        message: 'Table name cannot be a cell reference',
      });
      expect(ctx.computeBridge.renameTable).not.toHaveBeenCalled();
    });

    it('setTableStylePreset delegates to computeBridge.setTableStyle', async () => {
      await ws.tables.setStylePreset('Table1', 'TableStyleMedium2');

      expect(ctx.computeBridge.setTableStyle).toHaveBeenCalledWith(
        'Table1',
        'TableStyleMedium2',
        expectVersionOperationOptions('tables.setStylePreset', ['tables']),
      );
    });

    it('setShowTotals delegates to computeBridge.toggleTotalsRow when state differs', async () => {
      await ws.tables.setShowTotals('Table1', true);

      expect(ctx.computeBridge.toggleTotalsRow).toHaveBeenCalledWith(
        'Table1',
        expectVersionOperationOptions('tables.setShowTotals', ['tables']),
      );
    });

    it('setShowHeaders delegates to computeBridge.toggleHeaderRow when state differs', async () => {
      await ws.tables.setShowHeaders('Table1', false);

      expect(ctx.computeBridge.toggleHeaderRow).toHaveBeenCalledWith(
        'Table1',
        expectVersionOperationOptions('tables.setShowHeaders', ['tables']),
      );
    });

    it('applyAutoExpansion delegates to computeBridge.applyAutoExpansion', async () => {
      ctx.computeBridge.detectAutoExpansion.mockResolvedValue({
        shouldExpand: true,
        newEndRow: 10,
        newEndCol: 3,
      });

      await ws.tables.applyAutoExpansion('Table1');

      expect(ctx.computeBridge.applyAutoExpansion).toHaveBeenCalledWith(
        SHEET_ID,
        'Table1',
        expectVersionOperationOptions('tables.applyAutoExpansion', ['tables']),
      );
    });

    it('resizeTable delegates to computeBridge.resizeTable', async () => {
      await ws.tables.resize('Table1', 'A1:E20');

      expect(ctx.computeBridge.resizeTable).toHaveBeenCalledWith(
        'Table1',
        0,
        0,
        19,
        4,
        expectVersionOperationOptions('tables.resize', ['tables']),
      );
    });

    it('addTableColumn inserts a worksheet column and normalizes the table range', async () => {
      await ws.tables.addColumn('Table1', 'NewCol', 2);

      expect(ctx.computeBridge.beginUndoGroup).toHaveBeenCalledTimes(1);
      expect(ctx.computeBridge.structureChange).toHaveBeenCalledWith(SHEET_ID, {
        InsertCols: { at: 2, count: 1, new_col_ids: [] },
      });
      expect(ctx.computeBridge.addTableColumn).toHaveBeenCalledWith(
        'Table1',
        'NewCol',
        2,
        expectVersionOperationOptions('tables.addColumn', ['tables']),
      );
      expect(ctx.computeBridge.resizeTable).toHaveBeenCalledWith(
        'Table1',
        0,
        0,
        9,
        4,
        expectVersionOperationOptions('tables.addColumn', ['tables']),
      );
      expect(ctx.computeBridge.endUndoGroup).toHaveBeenCalledTimes(1);
    });

    it('addTableColumn appends at the end by default', async () => {
      await ws.tables.addColumn('Table1', 'NewCol');

      expect(ctx.computeBridge.structureChange).toHaveBeenCalledWith(SHEET_ID, {
        InsertCols: { at: 3, count: 1, new_col_ids: [] },
      });
      expect(ctx.computeBridge.addTableColumn).toHaveBeenCalledWith(
        'Table1',
        'NewCol',
        3,
        expectVersionOperationOptions('tables.addColumn', ['tables']),
      );
      expect(ctx.computeBridge.resizeTable).toHaveBeenCalledWith(
        'Table1',
        0,
        0,
        9,
        4,
        expectVersionOperationOptions('tables.addColumn', ['tables']),
      );
    });

    it('removeTableColumn deletes the worksheet column and normalizes the table range', async () => {
      await ws.tables.removeColumn('Table1', 2);

      expect(ctx.computeBridge.beginUndoGroup).toHaveBeenCalledTimes(1);
      expect(ctx.computeBridge.structureChange).toHaveBeenCalledWith(SHEET_ID, {
        DeleteCols: { at: 2, count: 1, deleted_cell_ids: [] },
      });
      expect(ctx.computeBridge.removeTableColumn).toHaveBeenCalledWith(
        'Table1',
        2,
        expectVersionOperationOptions('tables.removeColumn', ['tables']),
      );
      expect(ctx.computeBridge.resizeTable).toHaveBeenCalledWith(
        'Table1',
        0,
        0,
        9,
        2,
        expectVersionOperationOptions('tables.removeColumn', ['tables']),
      );
      expect(ctx.computeBridge.endUndoGroup).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // Group 8: Utility Operations
  // =========================================================================
  describe('Group 8: Utility Operations', () => {
    it('applyFormatPattern delegates to FormatOps.applyFormatToRange', async () => {
      const format = { bold: true } as any;
      const sourceRange = { startRow: 0, startCol: 0, endRow: 0, endCol: 0 } as any;
      const targetRange = { startRow: 1, startCol: 0, endRow: 5, endCol: 3 } as any;

      await ws.formats.applyPattern(format, sourceRange, targetRange);

      expect(FormatOps.applyFormatToRange).toHaveBeenCalledWith(
        ctx,
        SHEET_ID,
        format,
        sourceRange,
        targetRange,
        expectVersionOperationOptions('formats.applyFormatToRange', ['cells.formats.direct']),
      );
    });

    it('applyFormatPattern with null sourceRange delegates correctly', async () => {
      const format = { italic: true } as any;
      const targetRange = { startRow: 0, startCol: 0, endRow: 10, endCol: 5 } as any;

      await ws.formats.applyPattern(format, null, targetRange);

      expect(FormatOps.applyFormatToRange).toHaveBeenCalledWith(
        ctx,
        SHEET_ID,
        format,
        null,
        targetRange,
        expectVersionOperationOptions('formats.applyFormatToRange', ['cells.formats.direct']),
      );
    });

    it('cloneConditionalFormatsForPaste delegates to CFOps.cloneConditionalFormatsForPaste', async () => {
      (CFOps.cloneConditionalFormatsForPaste as jest.Mock).mockResolvedValue(undefined);

      const relativeCFs = [
        {
          rules: [
            {
              type: 'cellValue',
              operator: 'greaterThan',
              value1: 5,
              style: { backgroundColor: '#fff2cc' },
            },
          ],
          rangeOffsets: [
            { startRowOffset: 0, startColOffset: 0, endRowOffset: 5, endColOffset: 3 },
          ],
        },
      ];
      const origin = { row: 10, col: 2 };

      await ws.conditionalFormats.cloneForPaste('sourceSheet', relativeCFs, origin, true);

      expect(CFOps.cloneConditionalFormatsForPaste).toHaveBeenCalledWith(
        ctx,
        'sourceSheet',
        SHEET_ID,
        relativeCFs,
        origin,
        true,
        expect.any(Function),
      );
    });

    it('canEditCell returns true when sheet is not protected', async () => {
      ctx.computeBridge.isSheetProtected.mockResolvedValue(false);

      const result = await ws.protection.canEditCell(0, 0);

      expect(result).toBe(true);
    });

    it('canEditCell returns false when sheet is protected and cell is locked (default)', async () => {
      ctx.computeBridge.canEditCell.mockResolvedValue(false);

      const result = await ws.protection.canEditCell(0, 0);

      expect(result).toBe(false);
    });

    it('canEditCell returns true when sheet is protected but cell is unlocked', async () => {
      ctx.computeBridge.canEditCell.mockResolvedValue(true);

      const result = await ws.protection.canEditCell(0, 0);

      expect(result).toBe(true);
    });

    it('getSelectionAggregates delegates to QueryOps.getSelectionAggregates', async () => {
      (QueryOps.getSelectionAggregates as jest.Mock).mockResolvedValue({
        sum: 100,
        count: 10,
        numericCount: 8,
        average: 10,
        min: 1,
        max: 20,
      });

      const ranges = [{ startRow: 0, startCol: 0, endRow: 9, endCol: 0 }] as any;
      const result = await ws.getSelectionAggregates(ranges);

      expect(QueryOps.getSelectionAggregates).toHaveBeenCalledWith(ctx, SHEET_ID, [
        { startRow: 0, startCol: 0, endRow: 9, endCol: 0 },
      ]);
      expect(result.sum).toBe(100);
      expect(result.count).toBe(10);
      expect(result.numericCount).toBe(8);
      expect(result.average).toBe(10);
      expect(result.min).toBe(1);
      expect(result.max).toBe(20);
    });

    it('formatValues delegates to QueryOps.formatValues', async () => {
      (QueryOps.formatValues as jest.Mock).mockResolvedValue(['$100.00', '50%']);

      const entries = [
        { value: { type: 'number', value: 100 }, formatCode: '$#,##0.00' },
        { value: { type: 'number', value: 0.5 }, formatCode: '0%' },
      ];
      const result = await ws.formatValues(entries);

      expect(QueryOps.formatValues).toHaveBeenCalledWith(ctx, [
        { value: 100, format_code: '$#,##0.00' },
        { value: 0.5, format_code: '0%' },
      ]);
      expect(result).toEqual(['$100.00', '50%']);
    });

    it('getRowHeightsBatch delegates to computeBridge.getRowHeightsBatch', async () => {
      ctx.computeBridge.getRowHeightsBatch.mockResolvedValue([
        [0, 20],
        [1, 25],
      ]);

      const result = await ws.layout.getRowHeightsBatch(0, 1);

      expect(ctx.computeBridge.getRowHeightsBatch).toHaveBeenCalledWith(SHEET_ID, 0, 1);
      expect(result).toEqual([
        [0, 20],
        [1, 25],
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
        [1, 12.0],
      ]);

      const result = await ws.layout.getColWidthsBatchChars(0, 1);

      expect(ctx.computeBridge.getColWidthsBatchChars).toHaveBeenCalledWith(SHEET_ID, 0, 1);
      expect(result).toEqual([
        [0, 8.43],
        [1, 12.0],
      ]);
    });
  });

  // =========================================================================
  // Group 9: Data Operations
  // =========================================================================
  describe('Group 9: Data Operations', () => {
    it('setCells delegates to CellOps.setCells', async () => {
      (CellOps.setCells as jest.Mock).mockResolvedValue({ cellsWritten: 2 });

      const updates = [
        { row: 0, col: 0, value: '=SUM(A2:A10)' },
        { row: 1, col: 0, value: '=AVERAGE(B2:B10)' },
      ];
      const result = await ws.setCells(updates);

      expect(CellOps.setCells).toHaveBeenCalledWith(
        ctx,
        SHEET_ID,
        updates,
        expectVersionOperationOptions('worksheet.setCells', ['cells']),
      );
      expect(result).toEqual({ cellsWritten: 2 });
    });

    it('setDateValue delegates to CellOps.setDateValue with decomposed date', async () => {
      (CellOps.setDateValue as jest.Mock).mockResolvedValue(undefined);

      const date = new Date(2024, 0, 15); // Jan 15, 2024
      await ws.setDateValue(0, 0, date);

      expect(CellOps.setDateValue).toHaveBeenCalledWith(
        ctx,
        SHEET_ID,
        0,
        0,
        {
          year: 2024,
          month: 1,
          day: 15,
        },
        expectVersionOperationOptions('worksheet.setDateValue', ['cells']),
      );
    });

    it('setDateValue extracts month as 1-based', async () => {
      (CellOps.setDateValue as jest.Mock).mockResolvedValue(undefined);

      const date = new Date(2023, 11, 25); // Dec 25, 2023
      await ws.setDateValue(3, 2, date);

      expect(CellOps.setDateValue).toHaveBeenCalledWith(
        ctx,
        SHEET_ID,
        3,
        2,
        {
          year: 2023,
          month: 12,
          day: 25,
        },
        expectVersionOperationOptions('worksheet.setDateValue', ['cells']),
      );
    });

    it('setTimeValue delegates to CellOps.setTimeValue with decomposed time', async () => {
      (CellOps.setTimeValue as jest.Mock).mockResolvedValue(undefined);

      const date = new Date(2024, 0, 1, 14, 30, 45);
      await ws.setTimeValue(0, 0, date);

      expect(CellOps.setTimeValue).toHaveBeenCalledWith(
        ctx,
        SHEET_ID,
        0,
        0,
        {
          hours: 14,
          minutes: 30,
          seconds: 45,
        },
        expectVersionOperationOptions('worksheet.setTimeValue', ['cells']),
      );
    });

    it('setTimeValue handles midnight', async () => {
      (CellOps.setTimeValue as jest.Mock).mockResolvedValue(undefined);

      const date = new Date(2024, 0, 1, 0, 0, 0);
      await ws.setTimeValue(1, 1, date);

      expect(CellOps.setTimeValue).toHaveBeenCalledWith(
        ctx,
        SHEET_ID,
        1,
        1,
        {
          hours: 0,
          minutes: 0,
          seconds: 0,
        },
        expectVersionOperationOptions('worksheet.setTimeValue', ['cells']),
      );
    });
  });

  // =========================================================================
  // Group 10: Projection Detection
  // =========================================================================
  describe('Group 10: Projection Detection', () => {
    it('getProjectionRange delegates to CellOps.getProjectionRange', async () => {
      const mockRange = { sheetId: SHEET_ID, startRow: 0, startCol: 0, endRow: 5, endCol: 3 };
      (CellOps.getProjectionRange as jest.Mock).mockResolvedValue(mockRange);

      const result = await ws.bindings.getProjectionRange(0, 0);

      expect(CellOps.getProjectionRange).toHaveBeenCalledWith(ctx, SHEET_ID, 0, 0);
      expect(result).toEqual({ startRow: 0, startCol: 0, endRow: 5, endCol: 3, address: 'A1:D6' });
      expect(result).not.toHaveProperty('sheetId');
    });

    it('getProjectionRange returns null when no projection', async () => {
      (CellOps.getProjectionRange as jest.Mock).mockResolvedValue(null);

      const result = await ws.bindings.getProjectionRange(5, 5);

      expect(result).toBeNull();
    });

    it('getProjectionSource delegates to CellOps.getProjectionSource', async () => {
      (CellOps.getProjectionSource as jest.Mock).mockResolvedValue({ row: 0, col: 0 });

      const result = await ws.bindings.getProjectionSource(2, 1);

      expect(CellOps.getProjectionSource).toHaveBeenCalledWith(ctx, SHEET_ID, 2, 1);
      expect(result).toEqual({ row: 0, col: 0 });
    });

    it('getProjectionSource returns null when no source', async () => {
      (CellOps.getProjectionSource as jest.Mock).mockResolvedValue(null);

      const result = await ws.bindings.getProjectionSource(0, 0);

      expect(result).toBeNull();
    });

    it('isProjectedPosition delegates to CellOps.isProjectedPosition', async () => {
      (CellOps.isProjectedPosition as jest.Mock).mockResolvedValue(true);

      const result = await ws.bindings.isProjectedPosition(2, 1);

      expect(CellOps.isProjectedPosition).toHaveBeenCalledWith(ctx, SHEET_ID, 2, 1);
      expect(result).toBe(true);
    });

    it('isProjectedPosition returns false when not projected', async () => {
      (CellOps.isProjectedPosition as jest.Mock).mockResolvedValue(false);

      const result = await ws.bindings.isProjectedPosition(0, 0);

      expect(result).toBe(false);
    });
  });

  // =========================================================================
  // canDoStructureOp and canSort
  // =========================================================================
  describe('canDoStructureOp and canSort', () => {
    it('canDoStructureOp returns true when sheet is not protected', async () => {
      ctx.computeBridge.canDoStructureOp.mockResolvedValue(true);

      const result = await ws.protection.canDoStructureOp('insertRows');

      expect(ctx.computeBridge.canDoStructureOp).toHaveBeenCalledWith(SHEET_ID, 'insertRows');
      expect(result).toBe(true);
    });

    it('canDoStructureOp returns true when operation allowed in protection options', async () => {
      ctx.computeBridge.canDoStructureOp.mockResolvedValue(true);

      const result = await ws.protection.canDoStructureOp('insertRows');

      expect(result).toBe(true);
    });

    it('canDoStructureOp returns false when operation not allowed', async () => {
      ctx.computeBridge.canDoStructureOp.mockResolvedValue(false);

      const result = await ws.protection.canDoStructureOp('deleteColumns');

      expect(result).toBe(false);
    });

    it('canDoStructureOp returns false when protection options are null', async () => {
      ctx.computeBridge.canDoStructureOp.mockResolvedValue(false);

      const result = await ws.protection.canDoStructureOp('deleteColumns');

      expect(result).toBe(false);
    });

    it('canSort returns true when sheet is not protected', async () => {
      ctx.computeBridge.canDoStructureOp.mockResolvedValue(true);

      const result = await ws.protection.canSort();

      expect(result).toBe(true);
    });

    it('canSort returns true when sort allowed in protection options', async () => {
      ctx.computeBridge.canDoStructureOp.mockResolvedValue(true);

      const result = await ws.protection.canSort();

      expect(result).toBe(true);
    });

    it('canSort returns false when sort not allowed', async () => {
      ctx.computeBridge.canDoStructureOp.mockResolvedValue(false);

      const result = await ws.protection.canSort();

      expect(result).toBe(false);
    });
  });

  // =========================================================================
  // Calculated Column Operations
  // =========================================================================
  describe('Calculated Column Operations', () => {
    it('setCalculatedColumn seeds the first data cell then autofills the rest without formats', async () => {
      const mockTableInfo = {
        name: 'Table1',
        range: 'A1:D10',
        hasHeaders: true,
        hasTotals: false,
        columns: [
          { name: 'A', index: 0 },
          { name: 'B', index: 1 },
          { name: 'Price', index: 2 },
        ],
      };
      ctx.computeBridge.getTableByName.mockResolvedValue({ raw: 'bridge-data' });
      (TableOps.bridgeTableToTableInfo as jest.Mock).mockReturnValue(mockTableInfo);
      (TableOps.getTableColumnDataCellsFromInfo as jest.Mock).mockReturnValue([
        { row: 1, col: 2 },
        { row: 2, col: 2 },
        { row: 3, col: 2 },
      ]);

      await ws.tables.setCalculatedColumn('Table1', 2, '=A2+B2');

      expect(ctx.computeBridge.getTableByName).toHaveBeenCalledWith('Table1');
      expect(TableOps.getTableColumnDataCellsFromInfo).toHaveBeenCalledWith(mockTableInfo, 2);
      expect(ctx.computeBridge.beginUndoGroup).toHaveBeenCalledTimes(1);
      expect(ctx.computeBridge.updateCalculatedColumn).toHaveBeenCalledWith(
        'Table1',
        2,
        '=A2+B2',
        expectVersionOperationOptions('tables.setCalculatedColumn', ['tables']),
      );
      expect(ctx.computeBridge.setCellsByPosition).toHaveBeenCalledWith(
        SHEET_ID,
        [{ row: 1, col: 2, input: { kind: 'parse', text: '=A2+B2' } }],
        expectVersionOperationOptions('tables.setCalculatedColumn', ['tables']),
      );
      expect(ctx.computeBridge.autoFill).toHaveBeenCalledWith(SHEET_ID, {
        sourceRange: { startRow: 1, startCol: 2, endRow: 1, endCol: 2 },
        targetRange: { startRow: 2, startCol: 2, endRow: 3, endCol: 2 },
        direction: 'down',
        mode: 'withoutFormats',
        stepValue: 1,
        includeFormulas: true,
        includeValues: true,
        includeFormats: false,
      });
      expect(ctx.computeBridge.endUndoGroup).toHaveBeenCalledTimes(1);
      const updateOrder = ctx.computeBridge.updateCalculatedColumn.mock.invocationCallOrder[0];
      const seedOrder = ctx.computeBridge.setCellsByPosition.mock.invocationCallOrder[0];
      const fillOrder = ctx.computeBridge.autoFill.mock.invocationCallOrder[0];
      expect(updateOrder).toBeLessThan(seedOrder);
      expect(seedOrder).toBeLessThan(fillOrder);
    });

    it('clearCalculatedColumn fetches table then clears column cells', async () => {
      const mockTableInfo = {
        name: 'Table1',
        range: 'A1:D10',
        hasHeaders: true,
        hasTotals: false,
        columns: [
          { name: 'A', index: 0 },
          { name: 'B', index: 1 },
          { name: 'Price', index: 2 },
        ],
      };
      ctx.computeBridge.getTableByName.mockResolvedValue({ raw: 'bridge-data' });
      (TableOps.bridgeTableToTableInfo as jest.Mock).mockReturnValue(mockTableInfo);
      (TableOps.getTableColumnDataCellsFromInfo as jest.Mock).mockReturnValue([
        { row: 1, col: 2 },
        { row: 2, col: 2 },
      ]);

      await ws.tables.clearCalculatedColumn('Table1', 2);

      expect(ctx.computeBridge.getTableByName).toHaveBeenCalledWith('Table1');
      expect(ctx.computeBridge.removeCalculatedColumn).toHaveBeenCalledWith(
        'Table1',
        2,
        expectVersionOperationOptions('tables.clearCalculatedColumn', ['tables']),
      );
      expect(ctx.computeBridge.setCellsByPosition).toHaveBeenCalledWith(
        SHEET_ID,
        [
          { row: 1, col: 2, input: { kind: 'clear' } },
          { row: 2, col: 2, input: { kind: 'clear' } },
        ],
        expectVersionOperationOptions('tables.clearCalculatedColumn', ['tables']),
      );
    });
  });

  // =========================================================================
  // Filter Migration Methods
  // =========================================================================
  describe('Filter Migration Methods', () => {
    it('applyFilter delegates to computeBridge.applyFilter', async () => {
      ctx.computeBridge.getFiltersInSheet.mockResolvedValue([
        {
          id: 'filter-1',
          type: 'autoFilter',
          headerStartCellId: 'cell-start',
          headerEndCellId: 'cell-end',
          dataEndCellId: 'cell-data-end',
          columnFilters: {},
        },
      ]);

      await ws.filters.apply('filter-1');

      expect(ctx.computeBridge.applyFilter).toHaveBeenCalledWith(SHEET_ID, 'filter-1');
    });

    it('getFilterInfo returns info when filter exists', async () => {
      const mockFilter = {
        id: 'filter-1',
        type: 'autoFilter',
        headerStartCellId: 'cell-start',
        headerEndCellId: 'cell-end',
        dataEndCellId: 'cell-data-end',
        columnFilters: { A: { type: 'values', values: ['X'], includeBlanks: false } },
      };
      ctx.computeBridge.getFiltersInSheet.mockResolvedValue([mockFilter]);
      ctx.computeBridge.getCellPosition
        .mockResolvedValueOnce({ sheetId: SHEET_ID, row: 0, col: 0 }) // headerStartCellId
        .mockResolvedValueOnce({ sheetId: SHEET_ID, row: 0, col: 5 }) // headerEndCellId
        .mockResolvedValueOnce({ sheetId: SHEET_ID, row: 10, col: 5 }); // dataEndCellId

      const result = await ws.filters.getInfo('filter-1');

      expect(ctx.computeBridge.getFiltersInSheet).toHaveBeenCalledWith(SHEET_ID);
      expect(result).toEqual({
        id: 'filter-1',
        filterKind: 'autoFilter',
        range: { startRow: 0, startCol: 0, endRow: 10, endCol: 5 },
        columnFilters: { A: { type: 'value', values: ['X'], includeBlanks: false } },
      });
    });

    it('getFilterInfo returns null when filter not found', async () => {
      ctx.computeBridge.getFiltersInSheet.mockResolvedValue([]);

      const result = await ws.filters.getInfo('nonexistent');

      expect(result).toBeNull();
    });

    it('getFilterUniqueValues delegates to computeBridge.getUniqueColumnValues', async () => {
      ctx.computeBridge.getUniqueColumnValues.mockResolvedValue(['Apple', 'Banana', 'Cherry']);

      const result = await ws.filters.getFilterUniqueValues('filter-1', 0);

      expect(ctx.computeBridge.getUniqueColumnValues).toHaveBeenCalledWith(SHEET_ID, 'filter-1', 0);
      expect(result).toEqual(['Apple', 'Banana', 'Cherry']);
    });

    it('getCellIdAt delegates to CellOps.getCellIdAt', async () => {
      (CellOps.getCellIdAt as jest.Mock).mockResolvedValue('cell-sheet1-5-3');

      const result = await ws._internal.getCellIdAt(5, 3);

      expect(CellOps.getCellIdAt).toHaveBeenCalledWith(ctx, SHEET_ID, 5, 3);
      expect(result).toBe('cell-sheet1-5-3');
    });

    it('getCellIdAt returns null when no cell exists', async () => {
      (CellOps.getCellIdAt as jest.Mock).mockResolvedValue(null);

      const result = await ws._internal.getCellIdAt(100, 100);

      expect(result).toBeNull();
    });

    it('getValueForEditing delegates to the Rust-backed CellOps contract', async () => {
      (CellOps.getValueForEditing as jest.Mock).mockResolvedValue('=A1+B1');

      const result = await ws._internal.getValueForEditing(4, 2, 'ignored-edit-text');

      expect(CellOps.getValueForEditing).toHaveBeenCalledWith(ctx, SHEET_ID, 4, 2);
      expect(ctx.computeBridge.getCellIdAt).not.toHaveBeenCalled();
      expect(ctx.computeBridge.getActiveCell).not.toHaveBeenCalled();
      expect(result).toBe('=A1+B1');
    });

    it('public getValueForEditing returns the same delegated edit source as internal', async () => {
      (CellOps.getValueForEditing as jest.Mock).mockResolvedValue('raw text');

      const result = await ws.getValueForEditing(7, 8);

      expect(CellOps.getValueForEditing).toHaveBeenCalledWith(ctx, SHEET_ID, 7, 8);
      expect(result).toBe('raw text');
    });

    it('refreshActiveCellEditSource populates a fresh synchronous active-cell source', async () => {
      (CellOps.getValueForEditing as jest.Mock).mockResolvedValue('=A1+B1');

      expect(ws.getActiveCellEditSource(4, 2)).toBeNull();

      await ws.refreshActiveCellEditSource(4, 2);

      expect(CellOps.getValueForEditing).toHaveBeenCalledWith(ctx, SHEET_ID, 4, 2);
      expect(ws.getActiveCellEditSource(4, 2)).toEqual({
        sheetId: SHEET_ID,
        row: 4,
        col: 2,
        source: '=A1+B1',
        version: 1,
        fresh: true,
      });
      expect(ws.getActiveCellEditSource(4, 3)).toBeNull();
    });

    it('getActiveCellEditSource returns a defensive copy', async () => {
      (CellOps.getValueForEditing as jest.Mock).mockResolvedValue('=A1+B1');

      await ws.refreshActiveCellEditSource(4, 2);

      const cached = ws.getActiveCellEditSource(4, 2);
      expect(cached).not.toBeNull();
      cached!.fresh = false;
      cached!.source = 'mutated by caller';

      expect(ws.getActiveCellEditSource(4, 2)).toEqual({
        sheetId: SHEET_ID,
        row: 4,
        col: 2,
        source: '=A1+B1',
        version: 1,
        fresh: true,
      });
    });

    it('does not publish superseded active-cell edit-source refreshes', async () => {
      let resolveFirst!: (value: string) => void;
      (CellOps.getValueForEditing as jest.Mock)
        .mockImplementationOnce(
          () =>
            new Promise<string>((resolve) => {
              resolveFirst = resolve;
            }),
        )
        .mockResolvedValueOnce('new value');

      const first = ws.refreshActiveCellEditSource(4, 2);
      await ws.refreshActiveCellEditSource(4, 3);
      resolveFirst('old value');
      await first;

      expect(ws.getActiveCellEditSource(4, 2)).toBeNull();
      expect(ws.getActiveCellEditSource(4, 3)).toEqual({
        sheetId: SHEET_ID,
        row: 4,
        col: 3,
        source: 'new value',
        version: 1,
        fresh: true,
      });
    });

    it('invalidates active-cell edit source on same-sheet cell mutations', async () => {
      (CellOps.getValueForEditing as jest.Mock).mockResolvedValue('old value');
      (CellOps.setCell as jest.Mock).mockResolvedValue(undefined);

      await ws.refreshActiveCellEditSource(4, 2);
      expect(ws.getActiveCellEditSource(4, 2)?.source).toBe('old value');

      await ws.setCell(4, 2, 'new value');

      expect(ws.getActiveCellEditSource(4, 2)).toBeNull();
    });

    it('invalidates active-cell edit source on same-sheet external cell change events', async () => {
      (CellOps.getValueForEditing as jest.Mock).mockResolvedValue('old value');

      await ws.refreshActiveCellEditSource(4, 2);
      expect(ws.getActiveCellEditSource(4, 2)?.source).toBe('old value');

      ctx.eventBus.emit({
        type: 'cell:changed',
        sheetId: SHEET_ID,
        row: 4,
        col: 2,
      });

      expect(ws.getActiveCellEditSource(4, 2)).toBeNull();
    });

    it('invalidates active-cell edit source on same-sheet batch cell change events', async () => {
      (CellOps.getValueForEditing as jest.Mock).mockResolvedValue('old value');

      await ws.refreshActiveCellEditSource(4, 2);
      expect(ws.getActiveCellEditSource(4, 2)?.source).toBe('old value');

      ctx.eventBus.emit({
        type: 'cells:batch-changed',
        sheetId: SHEET_ID,
        changes: [
          { row: 1, col: 1, oldValue: undefined, newValue: 'other' },
          { row: 4, col: 2, oldValue: undefined, newValue: 'new value' },
        ],
        source: 'formula',
      });

      expect(ws.getActiveCellEditSource(4, 2)).toBeNull();
    });

    it('invalidates active-cell edit source on structure events that can move the cached cell', async () => {
      (CellOps.getValueForEditing as jest.Mock).mockResolvedValue('old value');

      await ws.refreshActiveCellEditSource(4, 2);
      expect(ws.getActiveCellEditSource(4, 2)?.source).toBe('old value');

      ctx.eventBus.emit({
        type: 'rows:inserted',
        sheetId: SHEET_ID,
        startRow: 2,
        count: 1,
        source: 'user',
      });

      expect(ws.getActiveCellEditSource(4, 2)).toBeNull();
    });

    it('refreshActiveCellData refreshes active metadata without warming edit source', async () => {
      ctx.computeBridge.getCellIdAt.mockResolvedValue('cell-4-2');
      (CellOps.getValueForEditing as jest.Mock).mockResolvedValue('raw text');

      await ws.refreshActiveCellData(4, 2);

      expect(ctx.computeBridge.getCellIdAt).toHaveBeenCalledWith(SHEET_ID, 4, 2);
      expect(ctx.computeBridge.refreshActiveCell).toHaveBeenCalledWith(SHEET_ID, 'cell-4-2');
      expect(CellOps.getValueForEditing).not.toHaveBeenCalled();
      expect(ws.getActiveCellEditSource(4, 2)).toBeNull();
    });

    it('refreshActiveCellData coalesces concurrent refreshes for the same cell', async () => {
      let resolveCellId!: (cellId: string) => void;
      ctx.computeBridge.getCellIdAt.mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveCellId = resolve;
          }),
      );

      const first = ws.refreshActiveCellData(4, 2);
      const second = ws.refreshActiveCellData(4, 2);

      expect(ctx.computeBridge.getCellIdAt).toHaveBeenCalledTimes(1);

      resolveCellId('cell-4-2');
      await Promise.all([first, second]);

      expect(ctx.computeBridge.getCellIdAt).toHaveBeenCalledWith(SHEET_ID, 4, 2);
      expect(ctx.computeBridge.refreshActiveCell).toHaveBeenCalledTimes(1);
      expect(ctx.computeBridge.refreshActiveCell).toHaveBeenCalledWith(SHEET_ID, 'cell-4-2');
    });

    it('hideRows delegates to computeBridge.hideRows', async () => {
      await ws.layout.hideRows([1, 3, 5]);

      expect(ctx.computeBridge.hideRows).toHaveBeenCalledWith(SHEET_ID, [1, 3, 5]);
    });

    it('hideRows with empty array returns early', async () => {
      await ws.layout.hideRows([]);

      // layout.ts returns early for empty arrays without calling computeBridge
      expect(ctx.computeBridge.hideRows).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // clampRangeToDataBounds
  // =========================================================================
  describe('clampRangeToDataBounds', () => {
    it('returns non-full ranges as-is', async () => {
      const range = {
        startRow: 0,
        startCol: 0,
        endRow: 10,
        endCol: 5,
      } as any;

      const result = await ws._internal.clampRangeToDataBounds(range);

      expect(result).toEqual(range);
    });

    it('clamps full-column range to data bounds + buffer', async () => {
      ctx.computeBridge.getDataBounds.mockResolvedValue({ maxRow: 50, maxCol: 20 });

      const range = {
        startRow: 0,
        startCol: 0,
        endRow: 1048575,
        endCol: 5,
        isFullColumn: true,
        isFullRow: false,
      } as any;

      const result = await ws._internal.clampRangeToDataBounds(range);

      // maxRow (50) + buffer (100) = 150
      expect(result.endRow).toBe(150);
      expect(result.endCol).toBe(5);
      expect(result.isFullColumn).toBe(false);
    });

    it('clamps full-row range to data bounds + buffer', async () => {
      ctx.computeBridge.getDataBounds.mockResolvedValue({ maxRow: 50, maxCol: 20 });

      const range = {
        startRow: 0,
        startCol: 0,
        endRow: 10,
        endCol: 16383,
        isFullColumn: false,
        isFullRow: true,
      } as any;

      const result = await ws._internal.clampRangeToDataBounds(range);

      expect(result.endRow).toBe(10);
      // maxCol (20) + buffer (100) = 120
      expect(result.endCol).toBe(120);
      expect(result.isFullRow).toBe(false);
    });

    it('handles null data bounds gracefully', async () => {
      ctx.computeBridge.getDataBounds.mockResolvedValue(null);

      const range = {
        startRow: 0,
        startCol: 0,
        endRow: 1048575,
        endCol: 5,
        isFullColumn: true,
        isFullRow: false,
      } as any;

      const result = await ws._internal.clampRangeToDataBounds(range);

      // maxRow defaults to 0, so 0 + 100 = 100
      expect(result.endRow).toBe(100);
    });

    it('ensures endRow is at least startRow', async () => {
      ctx.computeBridge.getDataBounds.mockResolvedValue({ maxRow: 0, maxCol: 0 });

      const range = {
        startRow: 5,
        startCol: 0,
        endRow: 1048575,
        endCol: 5,
        isFullColumn: true,
        isFullRow: false,
      } as any;

      const result = await ws._internal.clampRangeToDataBounds(range);

      // max(5, min(1048575, 0 + 100)) = max(5, 100) = 100
      expect(result.endRow).toBe(100);
    });
  });
});
