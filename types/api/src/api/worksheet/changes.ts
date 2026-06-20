/**
 * WorksheetChanges — Sub-API for opt-in change tracking.
 *
 * Creates lightweight trackers that accumulate cell-level change records
 * across mutations. Trackers are opt-in to avoid bloating return values;
 * they return cell before/after snapshots captured from native mutation
 * results, so callers do not need a post-exec getRange() pass for changed
 * cells.
 *
 * Inspired by query-scoped subscriptions and transaction origin tagging.
 */

// =============================================================================
// Change Record
// =============================================================================

/** A single cell-level change observed by a tracker. */
export interface ChangeRecord {
  /** Cell address in A1 notation (e.g. "B1"). */
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

/** Origin of a change: direct write, formula recalculation, or remote collaborator. */
export type ChangeOrigin = 'direct' | 'cascade' | 'remote';

// =============================================================================
// Tracker
// =============================================================================

/** Options for creating a change tracker. */
export interface ChangeTrackOptions {
  /** Only track changes within this range (A1 notation, e.g. "A1:Z100"). Omit for whole-sheet. */
  scope?: string;
  /** Exclude changes from these origin types. */
  excludeOrigins?: ChangeOrigin[];
}

/** A handle that accumulates change records across mutations. */
export interface ChangeTracker {
  /**
   * Drain all accumulated changes since creation or last collect() call.
   * Returns native before/after cell snapshots for accumulated changes.
   */
  collect(): ChangeRecord[];

  /** Stop tracking and release internal resources. */
  close(): void;

  /** Whether this tracker is still active (not closed). */
  readonly active: boolean;
}

// =============================================================================
// Sub-API namespace
// =============================================================================

/** Sub-API for opt-in change tracking on a worksheet. */
export interface WorksheetChanges {
  /**
   * Create a change tracker that accumulates cell-level change records
   * from this point forward.
   *
   * @param options - Optional scope and origin filters
   * @returns A ChangeTracker handle — call collect() to drain, close() when done
   */
  track(options?: ChangeTrackOptions): ChangeTracker;
}
