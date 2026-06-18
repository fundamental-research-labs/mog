/**
 * Pivot Bridge Interface
 *
 * Defines the contract for pivot table computation and caching.
 * This interface wraps IPivotEngine (from pivot.ts) with engine-specific
 * functionality like result caching and subscription.
 *
 * NOTE: IPivotEngine already exists in contracts/src/pivot.ts and handles
 * the core computation. IPivotBridge adds:
 * - Result caching with invalidation
 * - Subscription for reactive updates
 * - Integration with DocumentContext
 *
 * @see contracts/src/pivot.ts - IPivotEngine (core computation)
 * @see engine/src/state/bridges/pivot-bridge.ts - Implementation
 */

import type { CellValue, SheetId } from '@mog/types-core';
import type { PivotUpdateOptions } from '@mog/types-events/pivot-events';
import type {
  AggregateFunction,
  CalculatedFieldId,
  PivotField,
  PivotFieldItems,
  PivotFieldArea,
  PivotExpansionState,
  PivotKernelMutationReceipt,
  PivotMemberKey,
  PivotPlacementMutationReceipt,
  PivotTableConfig,
  PivotTableResult,
  PlacementId,
  ShowValuesAsConfig,
  SortOrder,
} from '@mog/types-data/data/pivot';

// =============================================================================
// Types
// =============================================================================

/**
 * Callback for pivot result updates.
 */
export type PivotResultCallback = (
  pivotId: string,
  result: PivotTableResult | null,
  error?: string,
) => void;

export interface PivotCreateSheetOptions {
  /** Insert the new worksheet before this existing worksheet. */
  insertBeforeSheetId?: SheetId;
  /** Optional 0-based worksheet insertion index. */
  insertIndex?: number;
}

export interface PivotBridgePlacementSpec {
  placementId?: PlacementId;
  fieldId?: string;
  area: PivotFieldArea;
  position?: number;
  source?:
    | { type: 'field'; fieldId: string }
    | { type: 'calculatedField'; calculatedFieldId: CalculatedFieldId };
  aggregateFunction?: AggregateFunction;
  sortOrder?: SortOrder;
  displayName?: string;
  showValuesAs?: ShowValuesAsConfig;
  numberFormat?: string;
}

export type PivotBridgePlacementPatch = Partial<
  Omit<PivotBridgePlacementSpec, 'placementId' | 'area' | 'source'>
>;

/**
 * Cache statistics for debugging/monitoring.
 */
export interface PivotCacheStats {
  /** Number of cached results */
  size: number;
  /** Individual cache entries */
  entries: Array<{
    pivotId: string;
    computedAt: number;
    ageMs: number;
  }>;
}

export type ImportedPivotSourceKind = 'promotedImport' | 'unsupportedImport';
export type ImportedPivotAssociationStatus = 'promoted' | 'unsupported' | 'deleted';

export interface ImportedPivotCapabilities {
  canEditFields: boolean;
  canReorderFields: boolean;
  canRemoveFields: boolean;
  canChangeAggregate: boolean;
  canRefresh: boolean;
  canDelete: boolean;
  canExport: boolean;
  unsupportedReason?: string;
}

export interface ImportedPivotRenderedRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  ref?: string;
}

export interface ImportedPivotViewRecord {
  sourceKind: ImportedPivotSourceKind;
  status: ImportedPivotAssociationStatus;
  importIdentity: string;
  outputSheetId: string;
  sourceSheetId?: string;
  config: PivotTableConfig;
  result?: PivotTableResult;
  capabilities: ImportedPivotCapabilities;
  unsupportedReason?: string;
  renderedRange?: ImportedPivotRenderedRange;
}

// =============================================================================
// Pivot Bridge Interface
// =============================================================================

/**
 * Bridge interface for pivot table computation.
 *
 * This interface provides methods for computing pivot tables with caching,
 * subscription for reactive updates, and field detection.
 *
 * All CRUD operations delegate to the Rust compute engine.
 * The former IPivotStore/PivotStore has been deleted.
 */
export interface IPivotBridge {
  // ===========================================================================
  // CRUD — Rust-backed pivot table configuration management
  // ===========================================================================

  /**
   * Create a new pivot table.
   * Delegates to Rust compute engine which generates the ID and timestamps.
   *
   * @param config - Pivot table configuration (without id, createdAt, updatedAt)
   * @returns Created pivot table configuration with generated ID
   */
  createPivot(config: PivotTableConfig): Promise<PivotTableConfig>;

  /**
   * Get a single pivot table by ID.
   *
   * @param sheetId - Output sheet ID where the pivot is displayed
   * @param pivotId - Pivot table ID
   * @returns Pivot table configuration or null if not found
   */
  getPivot(sheetId: string, pivotId: string): Promise<PivotTableConfig | null>;

  /**
   * Get all pivot tables displayed on a sheet.
   *
   * @param sheetId - Output sheet ID
   * @returns Array of pivot table configurations
   */
  getAllPivots(sheetId: string): Promise<PivotTableConfig[]>;

  /**
   * Get persisted imported pivot records displayed on a sheet.
   *
   * Promoted imports include their live native config and editable capabilities.
   * Unsupported imports include a preserved read-only config and explicit reason.
   */
  getImportedPivotViewRecords(sheetId: SheetId): Promise<ImportedPivotViewRecord[]>;

  /**
   * Update a pivot table configuration by merging partial updates.
   * All granular operations (addFieldPlacement, setAggregateFunction, etc.)
   * map to this method with different partial configs.
   *
   * @param sheetId - Output sheet ID where the pivot is displayed
   * @param pivotId - Pivot table ID
   * @param updates - Partial configuration updates
   * @returns Updated configuration or null if not found
   */
  updatePivot(
    sheetId: string,
    pivotId: string,
    updates: Partial<PivotTableConfig>,
    options: PivotUpdateOptions,
  ): Promise<PivotTableConfig | null>;

  addPlacement(
    pivotId: string,
    spec: PivotBridgePlacementSpec,
  ): Promise<PivotPlacementMutationReceipt>;

  updatePlacement(
    pivotId: string,
    placementId: PlacementId,
    patch: PivotBridgePlacementPatch,
  ): Promise<PivotKernelMutationReceipt>;

  removePlacement(pivotId: string, placementId: PlacementId): Promise<PivotKernelMutationReceipt>;

  movePlacement(
    pivotId: string,
    placementId: PlacementId,
    toArea: PivotFieldArea,
    toPosition: number,
  ): Promise<PivotKernelMutationReceipt>;

  setAggregateFunction(
    pivotId: string,
    placementId: PlacementId,
    aggregateFunction: AggregateFunction,
  ): Promise<PivotKernelMutationReceipt>;

  setShowValuesAs(
    pivotId: string,
    placementId: PlacementId,
    showValuesAs: ShowValuesAsConfig | null,
  ): Promise<PivotKernelMutationReceipt>;

  renameValuePlacement(
    pivotId: string,
    placementId: PlacementId,
    displayName: string | null,
  ): Promise<PivotKernelMutationReceipt>;

  setSortOrder(
    pivotId: string,
    placementId: PlacementId,
    sortOrder: SortOrder | null,
  ): Promise<PivotKernelMutationReceipt>;

  setSortByValue(
    pivotId: string,
    axisPlacementId: PlacementId,
    valuePlacementId: PlacementId,
    config: { order: SortOrder; columnKey?: string } | null,
  ): Promise<PivotKernelMutationReceipt>;

  resetPlacement(pivotId: string, placementId: PlacementId): Promise<PivotKernelMutationReceipt>;

  /**
   * Delete a pivot table.
   *
   * @param sheetId - Output sheet ID where the pivot is displayed
   * @param pivotId - Pivot table ID
   * @returns True if deleted, false if not found
   */
  deletePivot(sheetId: string, pivotId: string): Promise<boolean>;

  /**
   * Atomically create a new sheet AND a pivot table on it.
   * Both operations happen in a single transaction for undo atomicity.
   *
   * @param sheetName - Name for the new sheet
   * @param config - Pivot table configuration
   * @returns The new sheet's ID and the stored pivot config
   */
  createPivotWithSheet(
    sheetName: string,
    config: PivotTableConfig,
    options?: PivotCreateSheetOptions,
  ): Promise<{ sheetId: string; config: PivotTableConfig }>;

  // ===========================================================================
  // Computation
  // ===========================================================================

  /**
   * Compute a pivot table result through the pure read path.
   * Uses cached result if available and valid. Must not materialize output
   * cells, clear dirty state, or notify subscribers.
   *
   * @param sheetId - Sheet containing the pivot table
   * @param pivotId - Pivot table ID
   * @param forceRefresh - Force pure recomputation ignoring cache
   * @returns Computed pivot table result or null if not found/failed
   */
  compute(
    sheetId: SheetId,
    pivotId: string,
    forceRefresh?: boolean,
  ): Promise<PivotTableResult | null>;

  /**
   * Compute all pivot tables in a sheet.
   *
   * @param sheetId - Sheet ID
   * @returns Map of pivot ID to result
   */
  computeAll(sheetId: SheetId): Promise<Map<string, PivotTableResult>>;

  /**
   * Refresh a pivot table through the explicit materialization path.
   *
   * @param sheetId - Sheet ID
   * @param pivotId - Pivot table ID
   * @returns Recomputed result
   */
  refresh(sheetId: SheetId, pivotId: string): Promise<PivotTableResult | null>;

  /**
   * Refresh all pivot tables that depend on a sheet's data.
   *
   * @param sourceSheetId - Sheet whose data changed
   */
  refreshDependentPivots(sourceSheetId: SheetId): Promise<void>;

  // ===========================================================================
  // Field Detection
  // ===========================================================================

  /**
   * Detect fields from source data range.
   *
   * @param sourceSheetId - Sheet containing source data
   * @param range - Data range to analyze
   * @returns Array of detected fields
   */
  detectFields(
    sourceSheetId: SheetId,
    range: { startRow: number; startCol: number; endRow: number; endCol: number },
  ): Promise<PivotField[]>;

  // ===========================================================================
  // Drill-Down
  // ===========================================================================

  /**
   * Get source row indices for a pivot cell (drill-down).
   *
   * @param sheetId - Sheet ID
   * @param pivotId - Pivot table ID
   * @param rowKey - Row key from result
   * @param columnKey - Column key from result
   * @returns Source row indices that contribute to this cell
   */
  drillDown(
    sheetId: SheetId,
    pivotId: string,
    rowKey: string,
    columnKey: string,
    measurePlacementId?: PlacementId,
  ): Promise<number[]>;

  /**
   * Get actual source rows for a pivot cell.
   *
   * @param sheetId - Sheet ID
   * @param pivotId - Pivot table ID
   * @param rowKey - Row key from result
   * @param columnKey - Column key from result
   * @returns Source data rows
   */
  getDrillDownData(
    sheetId: SheetId,
    pivotId: string,
    rowKey: string,
    columnKey: string,
    measurePlacementId?: PlacementId,
  ): Promise<CellValue[][]>;

  setExpansion(
    pivotId: string,
    axisPlacementId: PlacementId,
    memberPath: PivotMemberKey[],
    expanded: boolean,
  ): Promise<PivotKernelMutationReceipt>;

  toggleExpanded(
    sheetId: SheetId,
    pivotId: string,
    headerKey: string,
    isRow: boolean,
  ): Promise<boolean>;

  setAllExpanded(pivotId: string, expanded: boolean): Promise<void>;

  getExpansionState(pivotId: string): Promise<PivotExpansionState>;

  // ===========================================================================
  // Pivot Items
  // ===========================================================================

  /**
   * Get pivot items for all placed fields (excluding value fields).
   *
   * @param sheetId - Sheet containing the pivot table
   * @param pivotId - Pivot table ID
   * @returns Array of field items (one per non-value field)
   */
  getAllPivotItems(sheetId: string, pivotId: string): Promise<PivotFieldItems[]>;

  // ===========================================================================
  // Subscription
  // ===========================================================================

  /**
   * Subscribe to updates for a specific pivot table.
   *
   * @param pivotId - Pivot table ID
   * @param callback - Called when pivot result changes
   * @returns Unsubscribe function
   */
  subscribe(pivotId: string, callback: PivotResultCallback): () => void;

  /**
   * Get current cached result for a pivot table.
   *
   * @param pivotId - Pivot table ID
   * @returns Cached result or null
   */
  getCachedResult(pivotId: string): PivotTableResult | null;

  // ===========================================================================
  // Cache Management
  // ===========================================================================

  /**
   * Invalidate cache for a specific pivot table.
   *
   * @param pivotId - Pivot table ID
   */
  invalidateCache(pivotId: string): void;

  /**
   * Invalidate all cached results.
   */
  invalidateAllCache(): void;

  /**
   * Get cache statistics.
   *
   * @returns Cache statistics
   */
  getCacheStats(): PivotCacheStats;

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Clean up resources.
   */
  destroy(): void;
}

// =============================================================================
// Re-export IPivotEngine for convenience
// =============================================================================

// IPivotEngine is the core computation interface (from pivot.ts)
// IPivotBridge wraps it with caching and subscription
export type { IPivotEngine, PivotTableConfig, PivotTableResult } from '@mog/types-data/data/pivot';
