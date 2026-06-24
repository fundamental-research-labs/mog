/**
 * Test Sheet Context
 *
 * Creates a minimal Map-backed IDomainContext for integration testing.
 * Promoted from grid-editing/testing/ to shared testing foundation.
 *
 * Usage:
 * const ctx = createTestSheetContext({
 * cells: { '0,0': 'hello', '0,1': 42 },
 * merges: [{ startRow: 3, startCol: 0, endRow: 4, endCol: 1 }],
 * hiddenRows: [2, 3],
 * columnWidths: { 0: 120, 1: 200 },
 * rowHeights: { 0: 30 },
 * frozenPanes: { rows: 1, cols: 1 },
 * });
 *
 * @module systems/testing-foundation
 */

import { createGridKey } from '@mog/spreadsheet-utils/cell-identity';
import { type CellRange, type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import { asFormattedText } from '@mog-sdk/contracts/core';
import type { IDomainContext } from '@mog-sdk/contracts/kernel';

// =============================================================================
// Types
// =============================================================================

/**
 * Declarative configuration for a test sheet.
 */
export interface TestSheetConfig {
  /** Cell values keyed by "row,col" string. Values can be string, number, boolean, or null. */
  cells?: Record<string, string | number | boolean | null>;

  /** Merged regions to create. Each is a CellRange with startRow/startCol/endRow/endCol. */
  merges?: CellRange[];

  /** Row indices that should be hidden. */
  hiddenRows?: number[];

  /** Column indices that should be hidden. */
  hiddenCols?: number[];

  /** Initial active cell position (defaults to { row: 0, col: 0 }). */
  activeCell?: { row: number; col: number };

  /** Sheet ID to use (defaults to 'sheet-1'). */
  sheetId?: string;

  /** Custom column widths keyed by column index. */
  columnWidths?: Record<number, number>;

  /** Custom row heights keyed by row index. */
  rowHeights?: Record<number, number>;

  /** Frozen panes configuration. Stored for later use by simulators. */
  frozenPanes?: { rows: number; cols: number };
}

/**
 * Result of createTestSheetContext - provides the context and sheet ID.
 */
export interface TestSheetContextResult {
  /** The IDomainContext backed by plain Maps */
  ctx: IDomainContext;

  /** The sheet ID used */
  sheetId: SheetId;
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a minimal Map-backed IDomainContext for integration tests.
 *
 * Populates:
 * - cells Map: cellId -> { id, row, col, r: value }
 * - grid Map: createGridKey(sheetId, row, col) -> cellId
 * - merges Map: topLeftCellId -> { topLeftId, bottomRightId }
 * - hiddenRows array: row indices
 * - hiddenCols array: column indices
 * - colWidths Map: column index string -> width (if columnWidths provided)
 * - rowHeights Map: row index string -> height (if rowHeights provided)
 */
export function createTestSheetContext(config: TestSheetConfig = {}): TestSheetContextResult {
  const sheetId: SheetId = config.sheetId ? toSheetId(config.sheetId) : toSheetId('sheet-1');

  // -------------------------------------------------------------------------
  // 1. Create top-level maps
  // -------------------------------------------------------------------------

  const sheetsRoot = new Map<string, Map<string, unknown>>();

  // -------------------------------------------------------------------------
  // 2. Create the sheet container with required sub-maps
  // -------------------------------------------------------------------------

  const sheetMap = new Map<string, unknown>();

  // Meta
  const meta = new Map<string, unknown>();
  meta.set('id', sheetId);
  meta.set('name', 'Sheet1');
  sheetMap.set('meta', meta);

  // Cell data maps
  const cellsMap = new Map<string, unknown>();
  const gridMap = new Map<string, string>();
  const propertiesMap = new Map<string, unknown>();
  const mergesMap = new Map<string, unknown>();
  const rowHeightsMap = new Map<string, number>();
  const colWidthsMap = new Map<string, number>();

  sheetMap.set('cells', cellsMap);
  sheetMap.set('grid', gridMap);
  sheetMap.set('properties', propertiesMap);
  sheetMap.set('merges', mergesMap);
  sheetMap.set('rowHeights', rowHeightsMap);
  sheetMap.set('colWidths', colWidthsMap);

  // Hidden rows/cols (use arrays instead of Y.Array)
  const hiddenRowsArr: number[] = [];
  const hiddenColsArr: number[] = [];
  sheetMap.set('hiddenRows', hiddenRowsArr);
  sheetMap.set('hiddenCols', hiddenColsArr);

  // Register sheet
  sheetsRoot.set(sheetId, sheetMap);

  // -------------------------------------------------------------------------
  // 3. Populate cells
  // -------------------------------------------------------------------------

  // Track cellId for each position (needed for merges)
  const cellIdByPos = new Map<string, string>();

  if (config.cells) {
    for (const [key, value] of Object.entries(config.cells)) {
      const [rowStr, colStr] = key.split(',');
      const row = parseInt(rowStr, 10);
      const col = parseInt(colStr, 10);

      const cellId = crypto.randomUUID();
      const gridKey = createGridKey(sheetId, row, col);

      cellsMap.set(cellId, {
        id: cellId,
        row,
        col,
        r: value,
      });
      gridMap.set(gridKey, cellId);
      cellIdByPos.set(key, cellId);
    }
  }

  // -------------------------------------------------------------------------
  // 4. Populate merges
  // -------------------------------------------------------------------------

  if (config.merges) {
    for (const merge of config.merges) {
      const tlKey = `${merge.startRow},${merge.startCol}`;
      const brKey = `${merge.endRow},${merge.endCol}`;

      // Ensure cells exist at merge boundaries
      let topLeftId = cellIdByPos.get(tlKey);
      if (!topLeftId) {
        topLeftId = crypto.randomUUID();
        const gridKey = createGridKey(sheetId, merge.startRow, merge.startCol);
        cellsMap.set(topLeftId, {
          id: topLeftId,
          row: merge.startRow,
          col: merge.startCol,
          r: null,
        });
        gridMap.set(gridKey, topLeftId);
        cellIdByPos.set(tlKey, topLeftId);
      }

      let bottomRightId = cellIdByPos.get(brKey);
      if (!bottomRightId) {
        bottomRightId = crypto.randomUUID();
        const gridKey = createGridKey(sheetId, merge.endRow, merge.endCol);
        cellsMap.set(bottomRightId, {
          id: bottomRightId,
          row: merge.endRow,
          col: merge.endCol,
          r: null,
        });
        gridMap.set(gridKey, bottomRightId);
        cellIdByPos.set(brKey, bottomRightId);
      }

      mergesMap.set(topLeftId, { topLeftId, bottomRightId });
    }
  }

  // -------------------------------------------------------------------------
  // 5. Populate hidden rows/cols
  // -------------------------------------------------------------------------

  if (config.hiddenRows && config.hiddenRows.length > 0) {
    hiddenRowsArr.push(...config.hiddenRows);
  }

  if (config.hiddenCols && config.hiddenCols.length > 0) {
    hiddenColsArr.push(...config.hiddenCols);
  }

  // -------------------------------------------------------------------------
  // 5b. Populate column widths and row heights
  // -------------------------------------------------------------------------

  if (config.columnWidths) {
    for (const [colIdx, width] of Object.entries(config.columnWidths)) {
      colWidthsMap.set(String(colIdx), width);
    }
  }

  if (config.rowHeights) {
    for (const [rowIdx, height] of Object.entries(config.rowHeights)) {
      rowHeightsMap.set(String(rowIdx), height);
    }
  }

  // -------------------------------------------------------------------------
  // 6. Build IDomainContext
  // -------------------------------------------------------------------------

  const eventBus = {
    emit: () => {},
    on: () => () => {},
    off: () => {},
  };

  const undoManager = {
    undo: () => {},
    redo: () => {},
    on: () => {},
    off: () => {},
    destroy: () => {},
    stopCapturing: () => {},
  };

  // -------------------------------------------------------------------------
  // 6b. Build mock ViewportBuffer
  // Provides sync viewport-scoped reads that action handlers depend on.
  // -------------------------------------------------------------------------

  // Build viewport merges from config (ViewportMerge uses snake_case fields)
  const viewportMerges = (config.merges ?? []).map((m) => ({
    start_row: m.startRow,
    start_col: m.startCol,
    end_row: m.endRow,
    end_col: m.endCol,
  }));

  // Build cell data lookup from config cells
  const viewportCellMap = new Map<string, unknown>();
  if (config.cells) {
    for (const [key, value] of Object.entries(config.cells)) {
      const [rowStr, colStr] = key.split(',');
      const row = parseInt(rowStr, 10);
      const col = parseInt(colStr, 10);
      const cellId = cellIdByPos.get(key) ?? '';

      // Convert config value to CellValue primitive (string | number | boolean | null)
      const cellValue = value ?? null;

      viewportCellMap.set(key, {
        row,
        col,
        cellId: cellId,
        value: cellValue,
        displayText: value != null ? asFormattedText(String(value)) : null,
        hasFormula: false,
      });
    }
  }

  const viewportBuffer = {
    getMerges: () => viewportMerges,
    getCellData: (row: number, col: number) => viewportCellMap.get(`${row},${col}`) ?? null,
    getActiveCellData: () => null,
    getActiveCellFormula: () => null,
    getRowDimension: (row: number) => {
      if (hiddenRowsArr.includes(row)) {
        return { row, height: 0, hidden: true };
      }
      return null; // Default dimensions handled by callers
    },
    getColDimension: (col: number) => {
      if (hiddenColsArr.includes(col)) {
        return { col, width: 0, hidden: true };
      }
      return null;
    },
    hasComment: () => false,
    hasSparkline: () => false,
    getBounds: () => null,
    isInViewport: () => true,
  };

  const worksheet = {
    viewport: viewportBuffer,
    protection: {
      canEditCellFast: () => true,
      canEditCell: async () => true,
      isProtected: async () => false,
    },
    layout: {
      getHiddenRowsBitmap: async () => new Set(hiddenRowsArr),
      getFilterHiddenRowsBitmap: async () => new Set<number>(),
      getHiddenColumnsBitmap: async () => new Set(hiddenColsArr),
      isRowHidden: async (row: number) => hiddenRowsArr.includes(row),
      isColumnHidden: async (col: number) => hiddenColsArr.includes(col),
    },
    structure: {
      getMergedRegions: async () => config.merges ?? [],
    },
  };

  // -------------------------------------------------------------------------
  // 6c. Build IDomainContext
  // -------------------------------------------------------------------------

  // Extra fields (undoManager, viewportBuffer) are not on IDomainContext
  // but are accessed at runtime by action handlers via `as any` casts.
  // We include them here for test fidelity.
  const ctx = {
    eventBus: eventBus as any,
    undoManager: undoManager as any,
    viewportBuffer: viewportBuffer as any,
    setPendingUndoDescription: () => {},
    getPendingUndoDescription: () => null,
    clearPendingUndoDescription: () => {},
    setPendingSelectionCheckpoint: () => {},
    getPendingSelectionCheckpoint: () => null,
    clearPendingSelectionCheckpoint: () => {},
    activeSheet: worksheet,
    getSheetById: () => worksheet,
    getSheetNames: async () => ['Sheet1'],
    on: () => () => {},
  } as unknown as IDomainContext;

  return { ctx, sheetId };
}
