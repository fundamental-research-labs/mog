/**
 * Row/Column Grouping Contracts
 *
 * Type definitions for row and column grouping (outline) with expand/collapse.
 * Grouping enables hierarchical data organization with collapsible sections,
 * outline level buttons, and automatic subtotal generation.
 *
 * These types mirror the Rust canonical types in `domain-types::domain::grouping`.
 * The Rust types are the source of truth; these TS definitions must stay in sync.
 * Bridge codegen also generates these into `compute-types.gen.ts` — if the two
 * diverge, the generated version is authoritative.
 */

import type { CellRange } from '@mog/types-core/core';

// ============================================================================
// Group Configuration
// ============================================================================

/** Group axis: row or column. */
export type GroupAxis = 'row' | 'column';

/**
 * A row or column group definition.
 * Groups can be nested up to 8 levels deep (matching Excel).
 *
 * Mirrors Rust `domain_types::domain::grouping::GroupDefinition`.
 */
export interface GroupDefinition {
  /** Unique group identifier */
  id: string;
  /** Sheet containing the group */
  sheetId: string;
  /** Group axis (row or column) */
  axis: GroupAxis;
  /** Start index (inclusive, 0-indexed) */
  start: number;
  /** End index (inclusive, 0-indexed) */
  end: number;
  /** Outline level (1-8, where 1 is outermost) */
  level: number;
  /** Whether this group is currently collapsed */
  collapsed: boolean;
  /** Parent group ID for nested groups */
  parentId?: string;
  /** OOXML round-trip: whether rows/cols were hidden by this group */
  hidden?: boolean;
  /** OOXML round-trip: collapsed attribute was on a group member, not end+1 */
  collapsedOnMember?: boolean;
}

/**
 * Per-sheet grouping configuration.
 * Stored in Yjs for collaboration and persistence.
 *
 * Mirrors Rust `domain_types::domain::grouping::SheetGroupingConfig`.
 */
export interface SheetGroupingConfig {
  /** All row groups in this sheet */
  rowGroups: GroupDefinition[];
  /** All column groups in this sheet */
  columnGroups: GroupDefinition[];
  /** Whether summary rows appear below detail rows (default: true) */
  summaryRowsBelow: boolean;
  /** Whether summary columns appear to the right of detail (default: true) */
  summaryColumnsRight: boolean;
  /** Whether outline symbols (+/-) are visible in the gutter (default: true) */
  showOutlineSymbols: boolean;
  /** Whether outline level buttons (1,2,3...) are visible (default: true) */
  showOutlineLevelButtons: boolean;
}

/**
 * Default grouping configuration for new sheets.
 */
export const DEFAULT_SHEET_GROUPING_CONFIG: SheetGroupingConfig = {
  rowGroups: [],
  columnGroups: [],
  summaryRowsBelow: true,
  summaryColumnsRight: true,
  showOutlineSymbols: true,
  showOutlineLevelButtons: true,
};

// ============================================================================
// Computed Outline State
// ============================================================================

/**
 * Computed outline level for a single row or column.
 * Used by the renderer to determine visibility and display.
 */
export interface OutlineLevel {
  /** Row or column index (0-indexed) */
  index: number;
  /** Current outline level (0 = not grouped, 1-8 = grouped) */
  level: number;
  /** Whether this row/column is visible (not hidden by collapsed groups) */
  visible: boolean;
  /** Whether this is a summary row/column (contains totals) */
  isSummary: boolean;
  /** Group IDs this row/column belongs to (innermost to outermost) */
  groupIds: string[];
}

/**
 * Partial update for outline display settings.
 */
export interface OutlineSettingsUpdate {
  summaryRowsBelow?: boolean;
  summaryColumnsRight?: boolean;
  showOutlineSymbols?: boolean;
  showOutlineLevelButtons?: boolean;
}

/**
 * Hit test result for outline button clicks in headers.
 * Used by the renderer/coordinator for click handling.
 */
export interface OutlineButtonHitResult {
  /** Type of button clicked */
  type: 'expand-collapse' | 'level';
  /** Group ID for expand/collapse buttons */
  groupId?: string;
  /** Level number for level buttons (1, 2, 3, etc.) */
  level?: number;
  /** Axis of the button */
  axis: 'row' | 'column';
}

// ============================================================================
// Subtotal Options
// ============================================================================

/**
 * Subtotal aggregate function types.
 * Maps to SUBTOTAL function codes in Excel.
 */
export type SubtotalFunction =
  | 'sum'
  | 'count'
  | 'average'
  | 'max'
  | 'min'
  | 'product'
  | 'countNums'
  | 'stdDev'
  | 'stdDevP'
  | 'var'
  | 'varP';

/**
 * Options for the Subtotals feature.
 * Used to create automatic subtotals with grouping.
 */
export interface SubtotalOptions {
  /** Column index to group by (the "change" column) */
  groupByColumn: number;
  /** Column indices to calculate subtotals for */
  subtotalColumns: number[];
  /** Aggregate function to use */
  function: SubtotalFunction;
  /** Replace existing subtotals if present (default: true) */
  replaceExisting: boolean;
  /** Place summary row below data (default: true) */
  summaryBelowData: boolean;
}

/**
 * Result of creating subtotals.
 */
export interface SubtotalResult {
  /** Number of groups created */
  groupsCreated: number;
  /** Number of subtotal rows inserted */
  subtotalRowsInserted: number;
  /** Range of affected cells */
  affectedRange: CellRange;
}

// ============================================================================
// Grouping Manager Interface
// ============================================================================

/**
 * Grouping manager interface for row/column grouping operations.
 * Implemented in engine, integrated via coordinator.
 */
export interface IGroupingManager {
  // === Group CRUD Operations ===

  groupRows(sheetId: string, startRow: number, endRow: number): GroupDefinition;
  groupColumns(sheetId: string, startCol: number, endCol: number): GroupDefinition;
  ungroupRows(sheetId: string, startRow: number, endRow: number): void;
  ungroupColumns(sheetId: string, startCol: number, endCol: number): void;
  clearRowGrouping(sheetId: string, startRow: number, endRow: number): void;
  clearColumnGrouping(sheetId: string, startCol: number, endCol: number): void;

  // === Query Methods ===

  getSheetGroupingConfig(sheetId: string): SheetGroupingConfig;
  getGroup(groupId: string): GroupDefinition | undefined;
  getGroups(sheetId: string, axis: 'row' | 'column'): GroupDefinition[];
  getRowOutlineLevels(sheetId: string, startRow: number, endRow: number): OutlineLevel[];
  getColumnOutlineLevels(sheetId: string, startCol: number, endCol: number): OutlineLevel[];
  getMaxOutlineLevel(sheetId: string, axis: 'row' | 'column'): number;
  isRowVisible(sheetId: string, row: number): boolean;
  isColumnVisible(sheetId: string, col: number): boolean;

  // === Expand/Collapse Operations ===

  setGroupCollapsed(groupId: string, collapsed: boolean): void;
  toggleGroupCollapsed(groupId: string): boolean;
  setLevelCollapsed(
    sheetId: string,
    axis: 'row' | 'column',
    level: number,
    collapsed: boolean,
  ): void;
  expandAll(sheetId: string, axis?: 'row' | 'column'): void;
  collapseAll(sheetId: string, axis?: 'row' | 'column'): void;

  // === Settings ===

  setOutlineSettings(
    sheetId: string,
    settings: Partial<
      Pick<
        SheetGroupingConfig,
        | 'summaryRowsBelow'
        | 'summaryColumnsRight'
        | 'showOutlineSymbols'
        | 'showOutlineLevelButtons'
      >
    >,
  ): void;

  // === Advanced Operations ===

  autoOutline(sheetId: string, range: CellRange): number;
  createSubtotals(sheetId: string, range: CellRange, options: SubtotalOptions): SubtotalResult;
  removeSubtotals(sheetId: string, range: CellRange): void;

  // === Event Support ===

  getAffectedRowsByGroup(groupId: string): number[];
  getAffectedColumnsByGroup(groupId: string): number[];
}
