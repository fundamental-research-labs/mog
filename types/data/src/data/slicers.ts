/**
 * Slicer Contracts - Type definitions for slicer visual filter controls.
 *
 * Stream ES: Slicers (Layer 2)
 *
 * Slicers are floating objects that provide visual multi-select filtering
 * for Tables and Pivot Tables. They follow the Cell Identity Model and
 * use the Bridge pattern for data source integration.
 *
 * Architecture Notes:
 * - Slicers are floating objects (render on overlay layer, z-index 5)
 * - Uses Cell Identity Model (CellId for column references, not column index)
 * - Filter state is the source of truth - slicer selection is derived
 * - Bridge pattern connects slicers to Tables and Pivot Tables
 * - State machine handles interaction states (idle, hovering, multiSelecting)
 *
 * Key Design Decisions:
 * 1. CellId-based column reference for table slicers (survives column insert/delete)
 * 2. Graceful degradation when source column is deleted (shows disconnected state)
 * 3. Cache invalidation via EventBus subscriptions (CELLS_CHANGED, FILTER_APPLIED, etc.)
 *
 * @see docs/architecture/cell-identity.md
 */

import type { CellId } from '@mog/types-core/cell-identity';
import type { CellValue } from '@mog/types-core/core';
import type { ObjectPosition } from '@mog/types-objects/objects/floating-objects';
import type { ColumnFilterCriteria } from './filter';
// Type aliases mirroring compute-types.gen.ts (Rust domain-types).
// Defined locally to avoid contracts→kernel dependency.

/** ST_SlicerCacheCrossFilter mode. Canonical source: compute-types.gen.ts */
type CrossFilterMode = 'none' | 'showItemsWithDataAtTop' | 'showItemsWithNoData';

/** Slicer sort order. Canonical source: compute-types.gen.ts */
type SlicerSortOrder = 'ascending' | 'descending' | 'dataSourceOrder';

// =============================================================================
// Slicer Data Source Types
// =============================================================================

/**
 * The type of data source a slicer connects to.
 * Canonical source: compute-types.gen.ts (Rust domain-types)
 */
export type SlicerSourceType = 'table' | 'pivot';

/**
 * Reference to a table field for slicer binding.
 * Uses column header CellId for Cell Identity Model compliance.
 *
 * **Graceful Degradation:** If the column header cell is deleted, the slicer
 * becomes "disconnected" and shows a placeholder state. This matches Excel
 * behavior where slicers become invalid when their source column is deleted.
 */
export interface SlicerTableSource {
  type: 'table';
  /** Table ID to connect to */
  tableId: string;
  /**
   * Column header CellId - stable across column moves.
   * If this CellId becomes orphaned (column deleted), slicer shows disconnected state.
   */
  columnCellId: CellId;
}

/**
 * Reference to a pivot field for slicer binding.
 */
export interface SlicerPivotSource {
  type: 'pivot';
  /** Pivot table ID to connect to */
  pivotId: string;
  /** Field name in the pivot (row/column/filter field) */
  fieldName: string;
  /** Which area the field is in */
  fieldArea: 'row' | 'column' | 'filter';
}

/**
 * Union type for slicer data sources.
 * Canonical source: compute-types.gen.ts (Rust domain-types)
 *
 * Generated version uses intersection with helper interfaces:
 *   `{ type: "table" } & SlicerSource_table | { type: "pivot" } & SlicerSource_pivot`
 * Contracts uses named interface variants. Both are structurally identical
 * (same internally-tagged discriminated union shape). No bridge conversion needed.
 */
export type SlicerSource = SlicerTableSource | SlicerPivotSource;

// =============================================================================
// Slicer Item Types
// =============================================================================

/**
 * Visual state of a slicer item (button).
 *
 * - selected: Item is selected (filter includes this value)
 * - available: Item is available but not selected
 * - unavailable: Item has no matching data after other filters
 * - noData: Item has no data at all
 *
 * Canonical source: compute-types.gen.ts (Rust domain-types)
 */
export type SlicerItemState = 'selected' | 'available' | 'unavailable' | 'noData';

/**
 * A single item in the slicer display.
 * Canonical source: compute-types.gen.ts (Rust domain-types)
 */
export interface SlicerItem {
  /** The value this item represents */
  value: CellValue;
  /** Display text (formatted value) */
  displayText: string;
  /** Current visual state */
  state: SlicerItemState;
  /** Count of matching rows (for display, optional) */
  count?: number;
}

// =============================================================================
// Slicer Style Configuration
// =============================================================================

/**
 * Slicer style presets matching Excel's slicer style gallery.
 * Canonical source: compute-types.gen.ts (Rust domain-types)
 */
export type SlicerStylePreset =
  | 'light1'
  | 'light2'
  | 'light3'
  | 'light4'
  | 'light5'
  | 'light6'
  | 'dark1'
  | 'dark2'
  | 'dark3'
  | 'dark4'
  | 'dark5'
  | 'dark6'
  | 'other1'
  | 'other2';

/**
 * Custom slicer style definition.
 * Canonical source: compute-types.gen.ts (Rust domain-types)
 */
export interface SlicerCustomStyle {
  /** Header background color */
  headerBackgroundColor?: string;
  /** Header text color */
  headerTextColor?: string;
  /** Header font size */
  headerFontSize?: number;
  /** Selected item background color */
  selectedBackgroundColor?: string;
  /** Selected item text color */
  selectedTextColor?: string;
  /** Available item background color */
  availableBackgroundColor?: string;
  /** Available item text color */
  availableTextColor?: string;
  /** Unavailable item background color */
  unavailableBackgroundColor?: string;
  /** Unavailable item text color */
  unavailableTextColor?: string;
  /** Border color */
  borderColor?: string;
  /** Border width in pixels */
  borderWidth?: number;
  /** Corner radius for items */
  itemBorderRadius?: number;
}

/**
 * Complete slicer style configuration.
 * Canonical source: compute-types.gen.ts (Rust domain-types)
 */
export interface SlicerStyle {
  /** Style preset (mutually exclusive with custom) */
  preset?: SlicerStylePreset;
  /** Custom style (mutually exclusive with preset) */
  custom?: SlicerCustomStyle;
  /** Number of columns for item layout (default: 1) */
  columnCount: number;
  /** Button height in pixels */
  buttonHeight: number;
  /** Show item selection indicators */
  showSelectionIndicator: boolean;
  /** ST_SlicerCacheCrossFilter — controls cross-filtering visual indication.
   * Replaces the previous showItemsWithNoData boolean.
   * Default: 'showItemsWithDataAtTop' */
  crossFilter: CrossFilterMode;
  /** Whether to use custom sort list. Default: true */
  customListSort: boolean;
  /** Whether to show items with no matching data (x14 pivot-backed slicers). Default: true */
  showItemsWithNoData: boolean;
  /** 'dataSourceOrder' is internal-only; never read from or written to OOXML. Import defaults to 'ascending'. */
  sortOrder: SlicerSortOrder;
}

// =============================================================================
// Slicer Configuration (Persisted State)
// =============================================================================

/**
 * Complete slicer configuration stored in Yjs.
 *
 * @deprecated Prefer `StoredSlicer` from `compute-types.gen` — the canonical
 * Rust-generated persistence type. This hand-written contract is kept for
 * consumers that cannot import from `@mog-sdk/kernel`.
 */
export interface SlicerConfig {
  /** Unique slicer identifier (UUID v7) */
  id: string;
  /** Sheet containing the slicer */
  sheetId: string;
  /** Data source connection */
  source: SlicerSource;
  /** Slicer caption (header text) */
  caption: string;
  /** Style configuration */
  style: SlicerStyle;
  /** Position configuration (from FloatingObject) */
  position: ObjectPosition;
  /** Z-order within the sheet */
  zIndex: number;
  /** Maps to OOXML CT_Slicer.@lockedPosition — whether slicer position is locked to cell. Default: false */
  locked: boolean;
  /** @startItem — first visible item index (scroll position). Default: 0 */
  startItem?: number;
  /** Whether multi-select is enabled (default: true) */
  multiSelect: boolean;
  /** Show slicer header */
  showHeader: boolean;
  /** Created timestamp */
  createdAt?: number;
  /** Last modified timestamp */
  updatedAt?: number;
}

// =============================================================================
// Slicer Yjs Storage Type
// =============================================================================

/**
 * Serialized slicer configuration for Yjs storage.
 * Uses JSON strings for nested objects to avoid Yjs nested object issues.
 *
 * @deprecated Rust compute-core now handles slicer serialization directly.
 * See `StoredSlicer` in `compute-types.gen` for the canonical type.
 */
export interface StoredSlicerConfig {
  /** Unique slicer identifier (UUID v7) */
  id: string;
  /** Sheet containing the slicer */
  sheetId: string;
  /** Data source (JSON-serialized SlicerSource) */
  source: string;
  /** Slicer caption (header text) */
  caption: string;
  /** Style configuration (JSON-serialized SlicerStyle) */
  style: string;
  /** Position configuration (JSON-serialized ObjectPosition) */
  position: string;
  /** Z-order within the sheet */
  zIndex: number;
  /** Whether slicer is locked */
  locked: boolean;
  /** Show slicer header */
  showHeader: boolean;
  /** Created timestamp */
  createdAt?: number;
  /** Last modified timestamp */
  updatedAt?: number;
}

// =============================================================================
// Slicer Cache (for rendering)
// =============================================================================

/**
 * Cached slicer data for efficient rendering.
 * Computed from source data and filter state.
 */
export interface SlicerCache {
  /** Slicer ID this cache belongs to */
  slicerId: string;
  /** All items with current states */
  items: SlicerItem[];
  /** Whether cache is stale (needs refresh) */
  isStale: boolean;
  /** Last refresh timestamp */
  lastRefresh: number;
}

// =============================================================================
// Slicer Selection State (Transient)
// =============================================================================

/**
 * Current selection state within a slicer.
 * This is UI state, NOT persisted - the filter state is the source of truth.
 */
export interface SlicerSelectionState {
  /** Currently selected values (derived from filter state) */
  selectedValues: Set<CellValue>;
  /** Last clicked value (for shift+click range selection) */
  lastClickedValue?: CellValue;
  /** Whether multi-select is active (Ctrl key held) */
  isMultiSelectActive: boolean;
}

// =============================================================================
// Slicer Manager Interface
// =============================================================================

/**
 * Options for creating a new slicer.
 */
export interface CreateSlicerOptions {
  /** Slicer caption (default: field/column name) */
  caption?: string;
  /** Programmatic name (OOXML `name` attribute). Falls back to caption when absent. */
  name?: string;
  /** Style configuration */
  style?: Partial<SlicerStyle>;
  /** Initial position */
  position?: Partial<ObjectPosition>;
  /** Show header */
  showHeader?: boolean;
}

/**
 * Slicer manager interface for CRUD operations.
 * Implemented in the engine, integrated via coordinator.
 */
export interface ISlicerManager {
  // === CRUD Operations ===

  /**
   * Create a slicer for a table column.
   *
   * @param sheetId - Sheet to place the slicer in
   * @param tableId - Table to connect to
   * @param columnCellId - CellId of the column header (Cell Identity Model)
   * @param options - Optional configuration
   * @returns The created slicer configuration
   */
  createTableSlicer(
    sheetId: string,
    tableId: string,
    columnCellId: CellId,
    options?: CreateSlicerOptions,
  ): SlicerConfig;

  /**
   * Create a slicer for a pivot field.
   *
   * @param sheetId - Sheet to place the slicer in
   * @param pivotId - Pivot table to connect to
   * @param fieldName - Field name in the pivot
   * @param fieldArea - Which area the field is in
   * @param options - Optional configuration
   * @returns The created slicer configuration
   */
  createPivotSlicer(
    sheetId: string,
    pivotId: string,
    fieldName: string,
    fieldArea: 'row' | 'column' | 'filter',
    options?: CreateSlicerOptions,
  ): SlicerConfig;

  /**
   * Get slicer by ID.
   */
  getSlicer(slicerId: string): SlicerConfig | undefined;

  /**
   * Get all slicers in a sheet.
   */
  getSlicersInSheet(sheetId: string): SlicerConfig[];

  /**
   * Get all slicers connected to a table.
   */
  getSlicersForTable(tableId: string): SlicerConfig[];

  /**
   * Get all slicers connected to a pivot table.
   */
  getSlicersForPivot(pivotId: string): SlicerConfig[];

  /**
   * Update slicer configuration.
   */
  updateSlicer(slicerId: string, updates: Partial<SlicerConfig>): void;

  /**
   * Delete a slicer.
   */
  deleteSlicer(slicerId: string): void;

  // === Data Operations ===

  /**
   * Get cached items for a slicer.
   * Returns all items with their current states.
   */
  getSlicerItems(slicerId: string): SlicerItem[];

  /**
   * Refresh slicer cache from source data.
   * Called when source data changes.
   */
  refreshSlicerCache(slicerId: string): void;

  /**
   * Mark slicer cache as stale.
   * Called when source data may have changed.
   */
  markCacheStale(slicerId: string): void;

  /**
   * Mark slicer as disconnected (source column deleted).
   */
  markDisconnected(slicerId: string): void;

  // === Selection Operations ===

  /**
   * Select a single value in the slicer (replaces current selection).
   */
  selectValue(slicerId: string, value: CellValue): void;

  /**
   * Toggle a value's selection (add/remove from multi-select).
   */
  toggleValue(slicerId: string, value: CellValue): void;

  /**
   * Clear all selections (show all data).
   */
  clearSelection(slicerId: string): void;

  /**
   * Select multiple values.
   */
  selectValues(slicerId: string, values: CellValue[]): void;

  // === Synchronization ===

  /**
   * Sync slicer visual state with current filter state.
   * Called when filter changes externally.
   */
  syncWithFilter(slicerId: string): void;

  /**
   * Get current selection as filter criteria.
   */
  getFilterCriteria(slicerId: string): ColumnFilterCriteria | null;
}

// =============================================================================
// Timeline Slicer Types
// =============================================================================

/**
 * Timeline aggregation level.
 * Determines how dates are grouped in the timeline display.
 */
export type TimelineLevel = 'years' | 'quarters' | 'months' | 'days';

/**
 * Timeline slicer specific configuration.
 * Extends base slicer for date-range filtering.
 */
export interface TimelineSlicerConfig extends SlicerConfig {
  /** Source must be table or pivot with date column */
  sourceType: 'timeline';
  /** Current aggregation level */
  timelineLevel: TimelineLevel;
  /** Start date of the data range */
  dataStartDate?: number;
  /** End date of the data range */
  dataEndDate?: number;
  /** Currently selected date range start */
  selectedStartDate?: number;
  /** Currently selected date range end */
  selectedEndDate?: number;
  /** Show the level selector in the header */
  showLevelSelector: boolean;
  /** Show the date range label */
  showDateRangeLabel: boolean;
}

// =============================================================================
// Type Guards
// =============================================================================

// =============================================================================
// Timeline Slicer Utilities
// =============================================================================

/**
 * A timeline period represents a grouping of dates at a specific aggregation level.
 */
export interface TimelinePeriod {
  /** Start date serial of this period (inclusive) */
  startDate: number;
  /** End date serial of this period (inclusive) */
  endDate: number;
  /** Display label for this period (e.g., "Jan", "Q1", "2024") */
  label: string;
  /** Short label for compact display */
  shortLabel: string;
  /** Whether this period is currently selected */
  isSelected: boolean;
  /** Whether this period has data */
  hasData: boolean;
  /** Count of data items in this period */
  count: number;
}

/**
 * Timeline scroll position and visible range state.
 */
export interface TimelineViewState {
  /** Currently visible start date serial */
  visibleStartDate: number;
  /** Currently visible end date serial */
  visibleEndDate: number;
  /** Scroll position (0-1) */
  scrollPosition: number;
  /** Current zoom level */
  level: TimelineLevel;
}

/**
 * Timeline selection state during drag operation.
 */
export interface TimelineDragState {
  /** Start period index */
  startIndex: number;
  /** Current end period index */
  endIndex: number;
  /** Whether drag is active */
  isDragging: boolean;
}
