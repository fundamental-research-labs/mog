/**
 * Table Bridge — Centralized bridge connecting stateless @mog/table-engine to Store/EventBus.
 *
 * Responsibilities:
 * 1. Type conversion: Contracts types (store-persisted) <-> Table-engine types (pure computation)
 * 2. Per-column bitmap caching: Evaluates each column's filter once, caches the Uint8Array
 * 3. Incremental recomposition: On single-column filter change, re-evaluates that column only
 * 4. CellId -> columnId translation: Converts header CellId to table column index
 * 5. EventBus subscriptions: Cache invalidation on data/structure changes
 *
 * Stateless engine pattern: the bridge owns caching, CellId translation, and EventBus.
 *
 * @packageDocumentation
 */

import {
  buildFilterDropdownData,
  buildSlicerCache as buildSlicerCacheEngine,
  composeBitmaps,
  computeSortOrder,
  convertContractsFilter,
  createRowVisibility,
  evaluateColumnFilter,
  getDataRange,
  resolveStructuredRef as resolveStructuredRefEngine,
  resolveTableCellFormat as resolveTableCellFormatEngine,
  type Slicer as EngineSlicer,
  type SlicerCache as EngineSlicerCache,
  type FilterCriteria,
  type FilterDropdownData,
  type RowVisibility,
  type SortSpec,
  type StructuredRef,
  type Table,
  type TableCellFormat,
} from '@mog/table-engine';

import type { CellRange, CellValue, SheetId } from '@mog-sdk/contracts/core';
import type {
  CellsBatchChangedEvent,
  FilterClearedEvent,
  TableDeletedEvent,
} from '@mog-sdk/contracts/events';
import type { ColumnFilterCriteria } from '@mog-sdk/contracts/filter';
import type { TableConfig, TableStylePreset } from '@mog-sdk/contracts/tables';

import type { DocumentContext } from '../context/types';
import { tableStyleIdForTableEngine } from '../domain/tables/style-normalization';

// =============================================================================
// Type Conversion: Style Preset Mapping
// =============================================================================

/**
 * Map contracts TableStylePreset to table-engine TableStyleId.
 *
 * Contracts stores short forms like 'light1', table-engine uses full form 'TableStyleLight1'.
 */
function mapStylePreset(preset: TableStylePreset | undefined): string {
  return tableStyleIdForTableEngine(preset);
}

// =============================================================================
// Type Conversion: TableConfig -> Table
// =============================================================================

/**
 * Convert contracts TableConfig to table-engine Table.
 *
 * Maps between the two type systems:
 * - hasTotalRow -> hasTotalsRow
 * - style.preset -> TableStyleId (e.g., 'light1' -> 'TableStyleLight1')
 * - style.showBandedRows -> bandedRows
 * - columns.totalFunction -> totalsFunction (null for 'none')
 * - columns.totalFormula -> totalsLabel
 *
 * @param config - Contracts TableConfig (from store)
 * @param range - Resolved CellRange for the table position
 * @returns Table-engine Table
 */
export function convertTableConfig(config: TableConfig, range: CellRange): Table {
  return {
    id: config.id,
    name: config.name,
    sheetId: config.sheetId,
    range,
    hasHeaderRow: config.hasHeaderRow,
    hasTotalsRow: config.hasTotalRow,
    style: mapStylePreset(config.style?.preset),
    bandedRows: config.style?.showBandedRows ?? true,
    bandedColumns: config.style?.showBandedColumns ?? false,
    emphasizeFirstColumn: config.style?.showFirstColumnHighlight ?? false,
    emphasizeLastColumn: config.style?.showLastColumnHighlight ?? false,
    showFilterButtons: config.showFilterButtons,
    autoExpand: config.autoExpand,
    autoCalculatedColumns: config.autoCalculatedColumns,
    columns: config.columns.map((col) => ({
      id: col.id,
      name: col.name,
      index: col.index,
      totalsFunction:
        col.totalFunction === 'none' || col.totalFunction === undefined ? null : col.totalFunction,
      totalsLabel: col.totalFormula ?? null,
      calculatedFormula: col.calculatedFormula,
    })),
  };
}

// =============================================================================
// Type Conversion: ColumnFilterCriteria -> FilterCriteria
// =============================================================================

/**
 * Convert contracts ColumnFilterCriteria to table-engine FilterCriteria.
 *
 * Delegates to @mog/table-engine's convertContractsFilter.
 * This wrapper maintains the existing export API.
 *
 * @param criteria - Contracts ColumnFilterCriteria
 * @returns Table-engine FilterCriteria or null if unsupported type
 */
export function convertFilterCriteria(criteria: ColumnFilterCriteria): FilterCriteria | null {
  return convertContractsFilter(criteria);
}

// =============================================================================
// TableBridge Configuration
// =============================================================================

/**
 * Configuration for creating a TableBridge instance.
 */
export interface TableBridgeConfig {
  /** Store context providing store access and EventBus */
  ctx: DocumentContext;
  /** Callback to get cell values by position */
  getCellValue: (sheetId: SheetId, row: number, col: number) => CellValue | undefined;
}

// =============================================================================
// TableBridge Class
// =============================================================================

/**
 * Centralized bridge connecting the stateless @mog/table-engine to Store/EventBus.
 *
 * The bridge owns:
 * - Per-column bitmap caching (tableId -> columnId -> Uint8Array)
 * - Type conversion between contracts and table-engine types
 * - EventBus subscriptions for cache invalidation
 *
 * All table-engine functions are stateless and pure. The bridge provides the
 * caching layer and event-driven invalidation that makes them reactive.
 */
export class TableBridge {
  /**
   * Per-column bitmap cache.
   * Outer key: tableId, Inner key: columnId, Value: filter bitmap
   */
  private columnBitmapCache = new Map<string, Map<string, Uint8Array>>();

  private ctx: DocumentContext;
  private getCellValue: TableBridgeConfig['getCellValue'];
  private unsubscribers: Array<() => void> = [];

  constructor(config: TableBridgeConfig) {
    this.ctx = config.ctx;
    this.getCellValue = config.getCellValue;
    this.setupEventSubscriptions();
  }

  // ===========================================================================
  // Table access
  // ===========================================================================

  /**
   * Convert a contracts TableConfig + resolved range into a table-engine Table.
   */
  getEngineTable(tableConfig: TableConfig, range: CellRange): Table {
    return convertTableConfig(tableConfig, range);
  }

  // ===========================================================================
  // Filter operations
  // ===========================================================================

  /**
   * Evaluate a column filter and cache the resulting bitmap.
   *
   * If the bitmap is already cached, returns the cached version.
   * Otherwise evaluates via table-engine and caches the result.
   *
   * @param tableId - Table identifier
   * @param columnId - Column identifier within the table
   * @param criteria - Filter criteria to evaluate
   * @param columnData - Raw cell values for the column (one per data row)
   * @returns Bitmap (Uint8Array) where 1=visible, 0=hidden
   */
  evaluateAndCacheColumnFilter(
    tableId: string,
    columnId: string,
    criteria: FilterCriteria,
    columnData: readonly CellValue[],
  ): Uint8Array {
    // Check cache first
    const tableCache = this.columnBitmapCache.get(tableId);
    if (tableCache) {
      const cached = tableCache.get(columnId);
      if (cached) return cached;
    }

    // Evaluate via table-engine
    const bitmap = evaluateColumnFilter(criteria, columnData);

    // Cache the result
    if (!this.columnBitmapCache.has(tableId)) {
      this.columnBitmapCache.set(tableId, new Map());
    }
    this.columnBitmapCache.get(tableId)!.set(columnId, bitmap);

    return bitmap;
  }

  /**
   * Invalidate the cached bitmap for a specific column.
   * Called when data in that column changes.
   *
   * @param tableId - Table identifier
   * @param columnId - Column identifier to invalidate
   */
  invalidateColumnBitmap(tableId: string, columnId: string): void {
    const tableCache = this.columnBitmapCache.get(tableId);
    if (tableCache) {
      tableCache.delete(columnId);
    }
  }

  /**
   * Invalidate all cached bitmaps for a table.
   * Called on structure changes (row insert/delete, table resize, etc.).
   *
   * @param tableId - Table identifier
   */
  invalidateTableBitmaps(tableId: string): void {
    this.columnBitmapCache.delete(tableId);
  }

  /**
   * Compose all cached column bitmaps for a table into a RowVisibility.
   *
   * Returns null if no bitmaps are cached (no filters active).
   *
   * @param tableId - Table identifier
   * @returns RowVisibility or null if no filters are cached
   */
  getRowVisibility(tableId: string): RowVisibility | null {
    const tableCache = this.columnBitmapCache.get(tableId);
    if (!tableCache || tableCache.size === 0) return null;

    const bitmaps = Array.from(tableCache.values());
    const composed = composeBitmaps(bitmaps);
    return createRowVisibility(composed);
  }

  // ===========================================================================
  // Slicer support
  // ===========================================================================

  /**
   * Build a slicer cache for a column using the table-engine.
   *
   * Extracts column data from the sheet, then calls the table-engine's
   * buildSlicerCache function with the slicer configuration and optional
   * cross-filter bitmap from other columns.
   *
   * @param table - Table-engine Table instance
   * @param sheetId - Sheet containing the table
   * @param columnIndex - Column index within the table (0-based)
   * @param slicer - Table-engine Slicer configuration
   * @param otherBitmaps - Optional composed bitmap from other filter columns
   * @returns Computed SlicerCache
   */
  buildSlicerCacheForColumn(
    table: Table,
    sheetId: SheetId,
    columnIndex: number,
    slicer: EngineSlicer,
    otherBitmaps?: Uint8Array,
  ): EngineSlicerCache {
    // Extract column data from the sheet
    const dataRange = getDataRange(table);
    const dataStartRow = dataRange.startRow;
    const dataEndRow = dataRange.endRow;
    const col = table.range.startCol + columnIndex;

    const columnData: CellValue[] = [];
    for (let row = dataStartRow; row <= dataEndRow; row++) {
      columnData.push(this.getCellValue(sheetId, row, col) ?? null);
    }

    return buildSlicerCacheEngine(slicer, columnData, otherBitmaps);
  }

  // ===========================================================================
  // Style resolution
  // ===========================================================================

  /**
   * Resolve the table cell format for a specific cell position.
   *
   * Delegates to table-engine's resolveTableCellFormat which computes
   * the format based on table style, banding, header/totals row, etc.
   *
   * @param table - Table-engine Table instance
   * @param row - Absolute row in the sheet
   * @param col - Absolute column in the sheet
   * @returns TableCellFormat or null if the cell is outside the table
   */
  resolveTableCellFormat(table: Table, row: number, col: number): TableCellFormat | null {
    return resolveTableCellFormatEngine(table, row, col);
  }

  // ===========================================================================
  // Structured references
  // ===========================================================================

  /**
   * Resolve a structured reference against a table.
   *
   * Delegates to table-engine's resolveStructuredRef.
   *
   * @param ref - Parsed structured reference
   * @param table - Table-engine Table instance
   * @param currentRow - Current row for [#This Row] resolution
   * @returns Array of resolved CellRanges
   */
  resolveStructuredRef(
    ref: StructuredRef,
    table: Table,
    currentRow?: number,
  ): readonly CellRange[] {
    return resolveStructuredRefEngine(ref, table, currentRow);
  }

  // ===========================================================================
  // Filter dropdown
  // ===========================================================================

  /**
   * Build data for a filter dropdown UI for a specific table column.
   *
   * Extracts column data from the sheet and delegates to table-engine's
   * buildFilterDropdownData.
   *
   * @param table - Table-engine Table instance
   * @param sheetId - Sheet containing the table
   * @param columnIndex - Column index within the table (0-based)
   * @param currentFilter - Currently applied filter criteria (or null)
   * @returns FilterDropdownData for the UI
   */
  getFilterDropdownData(
    table: Table,
    sheetId: SheetId,
    columnIndex: number,
    currentFilter: FilterCriteria | null,
  ): FilterDropdownData {
    // Extract column data
    const dataRange = getDataRange(table);
    const dataStartRow = dataRange.startRow;
    const dataEndRow = dataRange.endRow;
    const col = table.range.startCol + columnIndex;

    const columnData: CellValue[] = [];
    for (let row = dataStartRow; row <= dataEndRow; row++) {
      columnData.push(this.getCellValue(sheetId, row, col) ?? null);
    }

    // Get visibility from other columns for cross-filter support
    const column = table.columns[columnIndex];
    let otherVisibility: Uint8Array | undefined;
    if (column) {
      const tableCache = this.columnBitmapCache.get(table.id);
      if (tableCache && tableCache.size > 0) {
        // Compose all bitmaps EXCEPT the current column
        const otherBitmaps: Uint8Array[] = [];
        for (const [colId, bitmap] of tableCache.entries()) {
          if (colId !== column.id) {
            otherBitmaps.push(bitmap);
          }
        }
        if (otherBitmaps.length > 0) {
          otherVisibility = composeBitmaps(otherBitmaps);
        }
      }
    }

    return buildFilterDropdownData(columnData, currentFilter, otherVisibility);
  }

  // ===========================================================================
  // Sort
  // ===========================================================================

  /**
   * Compute the sort order for a table based on sort specifications.
   *
   * Extracts column data from the sheet and delegates to table-engine's
   * computeSortOrder.
   *
   * @param table - Table-engine Table instance
   * @param sheetId - Sheet containing the table
   * @param specs - Sort specifications (column + direction)
   * @returns Permutation array mapping new positions to original row indices
   */
  computeSortOrder(table: Table, sheetId: SheetId, specs: readonly SortSpec[]): readonly number[] {
    // Extract data for all columns referenced by sort specs
    const dataRange = getDataRange(table);
    const dataStartRow = dataRange.startRow;
    const dataEndRow = dataRange.endRow;

    // Build column data array (one array per column, indexed by column position)
    const data: CellValue[][] = [];
    for (const col of table.columns) {
      const colData: CellValue[] = [];
      const sheetCol = table.range.startCol + col.index;
      for (let row = dataStartRow; row <= dataEndRow; row++) {
        colData.push(this.getCellValue(sheetId, row, sheetCol) ?? null);
      }
      data.push(colData);
    }

    return computeSortOrder(specs, data);
  }

  // ===========================================================================
  // EventBus subscriptions
  // ===========================================================================

  /**
   * Set up EventBus subscriptions for cache invalidation.
   *
   * Subscribes to:
   * - cells:batch-changed -> invalidate affected column bitmaps
   * - filter:applied -> trigger recomposition
   * - filter:cleared -> clear bitmap cache for the table
   * - table:deleted -> clear cache entry
   * - columns:deleted -> invalidate affected table bitmaps
   * - rows:inserted/deleted -> invalidate all table bitmaps (row counts changed)
   */
  private setupEventSubscriptions(): void {
    const { eventBus } = this.ctx;

    // cells:batch-changed -> invalidate affected column bitmaps
    this.unsubscribers.push(
      eventBus.on<CellsBatchChangedEvent>('cells:batch-changed', (_event) => {
        // Find all tables that might be affected
        for (const [_tableId, tableCache] of this.columnBitmapCache.entries()) {
          // We invalidate columns where any changed cell falls within the column data range
          // Since we don't have the table config here, invalidate all columns for the table
          // that has cached bitmaps. The next access will re-evaluate.
          if (tableCache.size > 0) {
            // Invalidate the entire table cache for simplicity
            // (fine-grained per-column invalidation would require table range lookup)
            tableCache.clear();
          }
        }
      }),
    );

    // filter:applied -> cache is up to date after this (no-op, but useful for logging/metrics)
    this.unsubscribers.push(
      eventBus.on('filter:applied', (_event) => {
        // The filter was just applied. The bitmap cache should be populated
        // by the caller before emitting this event. No action needed.
      }),
    );

    // filter:cleared -> clear bitmap cache for affected table
    this.unsubscribers.push(
      eventBus.on<FilterClearedEvent>('filter:cleared', (_event) => {
        // Clear all caches — we don't have a direct filterId->tableId mapping here,
        // so we clear all. This is safe because cleared filters are infrequent.
        this.columnBitmapCache.clear();
      }),
    );

    // table:deleted -> clear cache entry
    this.unsubscribers.push(
      eventBus.on<TableDeletedEvent>('table:deleted', (event) => {
        this.columnBitmapCache.delete(event.tableId);
      }),
    );

    // columns:deleted -> invalidate affected table bitmaps
    this.unsubscribers.push(
      eventBus.on('columns:deleted', (_event) => {
        // Column deletion changes column indices, invalidate all table caches
        this.columnBitmapCache.clear();
      }),
    );

    // rows:inserted -> invalidate all (row counts changed, bitmaps are wrong length)
    this.unsubscribers.push(
      eventBus.on('rows:inserted', (_event) => {
        this.columnBitmapCache.clear();
      }),
    );

    // rows:deleted -> invalidate all (row counts changed, bitmaps are wrong length)
    this.unsubscribers.push(
      eventBus.on('rows:deleted', (_event) => {
        this.columnBitmapCache.clear();
      }),
    );
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Clean up all EventBus subscriptions and clear caches.
   * Must be called when the bridge is no longer needed.
   */
  destroy(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers.length = 0;
    this.columnBitmapCache.clear();
  }
}
