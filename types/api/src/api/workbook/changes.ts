/**
 * WorkbookChanges — Sub-API for workbook-level change tracking.
 *
 * Creates lightweight trackers that accumulate cell-level change records
 * across ALL sheets. Workbook-level tracking is the primary pattern for
 * code execution (agent code routinely mutates multiple sheets).
 *
 * The workbook tracker and the per-sheet worksheet tracker share the same
 * underlying Rust ChangeTracker — the workbook version simply omits the
 * sheet_id filter.
 */

import type { ChangeOrigin } from '../worksheet/changes';

// =============================================================================
// Workbook Change Record
// =============================================================================

/** A single cell-level change observed by a workbook tracker. Includes sheet name. */
export interface WorkbookChangeRecord {
  /** Sheet name where the change occurred. */
  sheet: string;
  /** Cell address in A1 notation (e.g., "B1"). */
  address: string;
  /** 0-based row index. */
  row: number;
  /** 0-based column index. */
  col: number;
  /** What caused this change. */
  origin: ChangeOrigin;
  /** Type of change. */
  type: 'modified';
  /** Value before the change (undefined if cell was previously empty). */
  oldValue?: unknown;
  /** Formatted display value before the change. */
  oldDisplayValue?: string;
  /** Formula before the change, or null if the cell had no formula. */
  oldFormula?: string | null;
  /** Value after the change (undefined if cell was cleared). */
  newValue?: unknown;
  /** Formatted display value after the change. */
  newDisplayValue?: string;
  /** Formula after the change, or null if the cell has no formula. */
  newFormula?: string | null;
  /** Effective number format after the change. */
  numberFormat?: string;
}

// =============================================================================
// Workbook Track Options
// =============================================================================

/** Options for creating a workbook-level change tracker. */
export interface WorkbookTrackOptions {
  /** Filter by origin type. Omit to track all origins. */
  origins?: ChangeOrigin[];
  /** Max records before auto-truncation (default: 10000). */
  limit?: number;
}

// =============================================================================
// Workbook Change Tracker
// =============================================================================

/** Result from collecting workbook-level changes. */
export interface WorkbookCollectResult {
  /** Accumulated change records. */
  records: WorkbookChangeRecord[];
  /** True if the tracker hit its limit and stopped accumulating. */
  truncated: boolean;
  /** Total changes observed (may exceed records.length when truncated). */
  totalObserved: number;
}

/** A handle that accumulates change records across all sheets. */
export interface WorkbookChangeTracker {
  /** Drain accumulated changes since creation or last collect() call. */
  collect(): WorkbookCollectResult;
  /**
   * Async version of collect() that resolves sheet names across the Rust bridge.
   * Preferred over collect() when called from async context.
   * Falls back to raw sheet IDs if name resolution fails.
   */
  collectAsync(): Promise<WorkbookCollectResult>;
  /** Stop tracking and release internal resources. */
  close(): void;
  /** Whether this tracker is still active (not closed). */
  readonly active: boolean;
}

// =============================================================================
// Sub-API namespace
// =============================================================================

/** Sub-API for opt-in workbook-level change tracking. */
export interface WorkbookChanges {
  /**
   * Create a change tracker that accumulates cell-level change records
   * across all sheets from this point forward.
   *
   * @param options - Optional origin filters and limit
   * @returns A WorkbookChangeTracker handle — call collect() to drain, close() when done
   */
  track(options?: WorkbookTrackOptions): WorkbookChangeTracker;
}
