/**
 * Sparkline Contracts
 *
 * Type definitions for in-cell mini-charts (sparklines).
 * Core data types are auto-generated from Rust in
 * @mog-sdk/kernel/bridges/compute/compute-types.gen.
 *
 * This file re-exports the generated types for backward compatibility and defines
 * types that exist only in the TS layer (no Rust counterpart).
 *
 * Renderer Integration Notes:
 * - Sparklines render inside cells (z-index 1, cells layer)
 * - Cell renderer checks for sparkline presence via manager
 * - SparklineRenderData is pre-computed to avoid per-frame calculation
 * - Uses custom canvas drawing for sparkline rendering
 */

import type { SheetId } from '@mog/types-core/core';

// ============================================================================
// Core Sparkline Types (copied from Rust-generated compute-types.gen)
// ============================================================================

export type AxisBoundLabel = 'auto' | 'same';

export type AxisBound = AxisBoundLabel | number;

export type EmptyCellDisplay = 'gaps' | 'zero' | 'connect';

export type SparklineType = 'line' | 'column' | 'winLoss';

export interface SparklineCellAddress {
  sheetId: string;
  row: number;
  col: number;
}

export interface SparklineDataRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export interface SparklineVisualSettings {
  color: string;
  negativeColor?: string;
  showNegativePoints?: boolean;
  showMarkers?: boolean;
  markerColor?: string;
  showHighPoint?: boolean;
  highPointColor?: string;
  showLowPoint?: boolean;
  lowPointColor?: string;
  showFirstPoint?: boolean;
  firstPointColor?: string;
  showLastPoint?: boolean;
  lastPointColor?: string;
  lineWeight?: number;
  columnGap?: number;
  barGap?: number;
}

export interface SparklineAxisSettings {
  minValue: AxisBound;
  maxValue: AxisBound;
  showAxis?: boolean;
  axisColor?: string;
  displayEmptyCells: EmptyCellDisplay;
  rightToLeft?: boolean;
}

export interface Sparkline {
  id: string;
  sheetId: SheetId;
  cell: SparklineCellAddress;
  dataRange: SparklineDataRange;
  type: SparklineType;
  dataInRows: boolean;
  groupId?: string;
  visual: SparklineVisualSettings;
  axis: SparklineAxisSettings;
  createdAt?: number;
  updatedAt?: number;
}

export interface SparklineGroup {
  id: string;
  sheetId: string;
  sparklineIds: string[];
  type: SparklineType;
  visual: SparklineVisualSettings;
  axis: SparklineAxisSettings;
  createdAt?: number;
  updatedAt?: number;
}

// ============================================================================
// Render Data (Pre-computed for Performance)
// ============================================================================

/**
 * Pre-computed data point for rendering.
 * Normalized to 0-1 range for easy canvas coordinate mapping.
 */
export interface SparklineDataPoint {
  /** Normalized X position (0-1) */
  x: number;
  /** Normalized Y position (0-1, 0 = bottom, 1 = top) */
  y: number;
  /** Original value from data */
  value: number;
  /** Whether this point represents a null/empty cell */
  isNull: boolean;
}

/**
 * Pre-computed render data for a sparkline.
 * Calculated once when data changes, reused for each render frame.
 * This avoids expensive data fetching and normalization during rendering.
 */
export interface SparklineRenderData {
  /** Sparkline ID this render data belongs to */
  sparklineId: string;
  /** Sparkline type for render method selection */
  type: SparklineType;
  /** Normalized data points ready for rendering */
  points: SparklineDataPoint[];
  /** Minimum value in the data (for axis rendering) */
  minValue: number;
  /** Maximum value in the data (for axis rendering) */
  maxValue: number;
  /** Index of highest value point (for high point coloring) */
  highPointIndex?: number;
  /** Index of lowest value point (for low point coloring) */
  lowPointIndex?: number;
  /** Index of first non-null point */
  firstPointIndex: number;
  /** Index of last non-null point */
  lastPointIndex: number;
  /** Resolved visual settings (from sparkline or group) */
  visual: SparklineVisualSettings;
  /** Whether to show axis line */
  showAxis: boolean;
  /** Y position (0-1) where axis should be drawn (where value = 0) */
  axisPosition?: number;
}

// ============================================================================
// Creation Options
// ============================================================================

/**
 * Options for creating a new sparkline.
 */
export interface CreateSparklineOptions {
  /** Whether data is in rows (true) or columns (false) */
  dataInRows?: boolean;
  /** Visual settings override */
  visual?: Partial<SparklineVisualSettings>;
  /** Axis settings override */
  axis?: Partial<SparklineAxisSettings>;
}

/**
 * Options for creating a sparkline group.
 */
export interface CreateSparklineGroupOptions {
  /** Whether data is in rows (true) or columns (false) */
  dataInRows?: boolean;
  /** Shared visual settings */
  visual?: Partial<SparklineVisualSettings>;
  /** Shared axis settings */
  axis?: Partial<SparklineAxisSettings>;
}

// ============================================================================
// Sparkline Manager Interface
// ============================================================================

/**
 * Sparkline manager interface for CRUD operations.
 * Implemented in engine, integrated via coordinator.
 *
 * Per the renderer architecture (renderer docs):
 * - Sparklines are a render-only feature inside cells (z-index 1, cells layer)
 * - No state machine needed - sparklines don't have interaction states
 * - Manager integrates via coordinator (coordinator.getSparklineManager())
 * - Events flow through EventBus to trigger re-renders
 * - All configs stored in Yjs for collaboration
 */
export interface ISparklineManager {
  // === CRUD Operations ===

  /**
   * Create a sparkline in a cell.
   * @param sheetId Sheet to create the sparkline in
   * @param cell Cell where sparkline will be rendered
   * @param dataRange Data range for sparkline values
   * @param type Sparkline type (line, column, winLoss)
   * @param options Optional configuration
   * @returns The created sparkline configuration
   */
  createSparkline(
    sheetId: string,
    cell: SparklineCellAddress,
    dataRange: SparklineDataRange,
    type: SparklineType,
    options?: CreateSparklineOptions,
  ): Promise<Sparkline>;

  /**
   * Create multiple sparklines as a group with shared settings.
   * Useful for creating a column of sparklines that share axis scaling.
   * @param sheetId Sheet to create the sparklines in
   * @param cells Array of cells where sparklines will be rendered
   * @param dataRanges Array of data ranges (one per cell)
   * @param type Sparkline type (all must be same)
   * @param options Optional shared configuration
   * @returns The created sparkline group
   */
  createSparklineGroup(
    sheetId: string,
    cells: SparklineCellAddress[],
    dataRanges: SparklineDataRange[],
    type: SparklineType,
    options?: CreateSparklineGroupOptions,
  ): Promise<SparklineGroup>;

  /**
   * Get sparkline by ID.
   * @param sparklineId Sparkline identifier
   * @returns Sparkline configuration or undefined if not found
   */
  getSparkline(sparklineId: string): Sparkline | undefined;

  /**
   * Get sparkline at a specific cell.
   * @param sheetId Sheet identifier
   * @param row Row index
   * @param col Column index
   * @returns Sparkline configuration or undefined if no sparkline at cell
   */
  getSparklineAtCell(sheetId: string, row: number, col: number): Sparkline | undefined;

  /**
   * Get all sparklines in a sheet.
   * @param sheetId Sheet identifier
   * @returns Array of sparkline configurations
   */
  getSparklinesInSheet(sheetId: string): Sparkline[];

  /**
   * Get sparkline group by ID.
   * @param groupId Group identifier
   * @returns Sparkline group or undefined if not found
   */
  getSparklineGroup(groupId: string): SparklineGroup | undefined;

  /**
   * Get all sparkline groups in a sheet.
   * @param sheetId Sheet identifier
   * @returns Array of sparkline groups
   */
  getSparklineGroupsInSheet(sheetId: string): SparklineGroup[];

  /**
   * Update sparkline settings.
   * @param sparklineId Sparkline identifier
   * @param updates Partial configuration to merge
   */
  updateSparkline(sparklineId: string, updates: Partial<Sparkline>): Promise<void>;

  /**
   * Update sparkline group settings (applies to all sparklines in group).
   * @param groupId Group identifier
   * @param updates Partial configuration to merge
   */
  updateSparklineGroup(groupId: string, updates: Partial<SparklineGroup>): Promise<void>;

  /**
   * Delete a sparkline.
   * @param sparklineId Sparkline identifier
   */
  deleteSparkline(sparklineId: string): Promise<void>;

  /**
   * Delete a sparkline group (deletes all sparklines in the group).
   * @param groupId Group identifier
   */
  deleteSparklineGroup(groupId: string): Promise<void>;

  /**
   * Clear all sparklines in a range.
   * @param sheetId Sheet identifier
   * @param range Range to clear sparklines from
   */
  clearSparklinesInRange(sheetId: string, range: SparklineDataRange): Promise<void>;

  // === Group Management ===

  /**
   * Add an existing sparkline to a group.
   * @param sparklineId Sparkline identifier
   * @param groupId Group identifier
   */
  addToGroup(sparklineId: string, groupId: string): Promise<void>;

  /**
   * Remove a sparkline from its group (becomes standalone).
   * @param sparklineId Sparkline identifier
   */
  removeFromGroup(sparklineId: string): Promise<void>;

  /**
   * Ungroup a sparkline group (sparklines become standalone).
   * @param groupId Group identifier
   * @returns Array of sparkline IDs that were ungrouped
   */
  ungroupSparklines(groupId: string): Promise<string[]>;

  // === Render Support ===

  /**
   * Compute render data for a sparkline.
   * Called when sparkline data changes, result cached for rendering.
   * @param sparklineId Sparkline identifier
   * @returns Pre-computed render data for the cell renderer
   */
  computeRenderData(sparklineId: string): SparklineRenderData | undefined;

  /**
   * Get cached render data for a sparkline.
   * Used by cell renderer for fast access during render loop.
   * @param sparklineId Sparkline identifier
   * @returns Cached render data or undefined if not computed
   */
  getRenderData(sparklineId: string): SparklineRenderData | undefined;

  /**
   * Invalidate cached render data (called when source data changes).
   * @param sparklineId Sparkline identifier
   */
  invalidateRenderData(sparklineId: string): void;

  /**
   * Invalidate render data for all sparklines referencing a range.
   * Called by coordinator when cell values change.
   * @param sheetId Sheet identifier
   * @param range Changed range
   */
  invalidateRenderDataInRange(sheetId: string, range: SparklineDataRange): void;

  // === Query Methods ===

  /**
   * Check if a cell has a sparkline.
   * @param sheetId Sheet identifier
   * @param row Row index
   * @param col Column index
   * @returns True if cell contains a sparkline
   */
  hasSparkline(sheetId: string, row: number, col: number): boolean;

  /**
   * Get sparklines whose data range intersects with a given range.
   * Useful for determining which sparklines need re-rendering after data changes.
   * @param sheetId Sheet identifier
   * @param range Range to check
   * @returns Array of sparklines with intersecting data ranges
   */
  getSparklinesWithDataInRange(sheetId: string, range: SparklineDataRange): Sparkline[];
}
