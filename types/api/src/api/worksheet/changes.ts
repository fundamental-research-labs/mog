/**
 * WorksheetChanges — Sub-API for opt-in change tracking.
 *
 * Creates lightweight trackers that accumulate cell-level change records
 * across mutations. Trackers are opt-in to avoid bloating return values;
 * they return addresses + metadata only (no cell values) so callers can
 * hydrate via getRange() when needed.
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
  /** Value after the change (undefined if cell was cleared). */
  newValue?: unknown;
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
   * Returns addresses + metadata only (no cell values) — call ws.getRange()
   * to hydrate if needed.
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
