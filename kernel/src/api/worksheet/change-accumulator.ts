/**
 * ChangeAccumulator — Feeds active ChangeTrackers from MutationResult data.
 *
 * Lives on MutationResultHandler. After every mutation, applyAndNotify() calls
 * ingest() with the RecalcResult's changedCells. The accumulator fans out
 * change records to all registered trackers (per-sheet, scoped, filtered).
 *
 * Supports two tiers:
 * - Per-sheet trackers (TrackerHandle) — receive ChangeRecord[] for a single sheet
 * - Workbook-level trackers (WorkbookTrackerHandle) — receive (sheetId, ChangeRecord[])[]
 *   for all sheets, so they can associate sheet identity with each record
 *
 * Zero overhead when no trackers are active (early return).
 */

import type { ChangeRecord, ChangeOrigin } from '@mog-sdk/contracts/api';
import type { MutationSource } from '../../bridges/mutation-source';

// =============================================================================
// A1 address helper (col/row → "A1")
// =============================================================================

function colToLetter(col: number): string {
  let result = '';
  let c = col;
  while (c >= 0) {
    result = String.fromCharCode((c % 26) + 65) + result;
    c = Math.floor(c / 26) - 1;
  }
  return result;
}

function toA1(row: number, col: number): string {
  return `${colToLetter(col)}${row + 1}`;
}

// =============================================================================
// CellChange shape (from compute-bridge)
// =============================================================================

/** Minimal shape of CellChange from Rust RecalcResult.changedCells. */
export interface CellChangeInfo {
  sheetId: string;
  row: number;
  col: number;
  /** New value after the change (from Rust CellChange.value). */
  value?: unknown;
  /** New display text after the change (from Rust CellChange.displayText). */
  displayText?: string;
  /** Previous value before the change (from Rust CellChange.oldValue). */
  oldValue?: unknown;
  /** Previous display text before the change (from Rust CellChange.oldDisplayText). */
  oldDisplayText?: string;
  /** Formula before the change (from Rust CellChange.oldFormula). */
  oldFormula?: string;
  /** Formula after the change (from Rust CellChange.newFormula). */
  newFormula?: string;
  /** Effective number format after the change (from Rust CellChange.numberFormat). */
  numberFormat?: string;
}

// =============================================================================
// TrackerHandle — internal interface for tracker instances
// =============================================================================

/** Per-sheet tracker handle — receives records for a single sheet. */
export interface TrackerHandle {
  /** The sheetId this tracker observes. */
  readonly sheetId: string;
  /** Ingest a batch of change records. */
  _ingest(records: ChangeRecord[]): void;
}

/** Workbook-level tracker handle — receives records grouped by sheetId. */
export interface WorkbookTrackerHandle {
  /** Ingest records grouped by sheetId. */
  _ingestBySheet(recordsBySheet: Map<string, ChangeRecord[]>): void;
}

// =============================================================================
// ChangeAccumulator
// =============================================================================

export class ChangeAccumulator {
  private trackers: Set<TrackerHandle> = new Set();
  private workbookTrackers: Set<WorkbookTrackerHandle> = new Set();

  /**
   * Pending direct edits set before a mutation, consumed by the next ingest().
   * Since JS is single-threaded, setDirectEdits() before the bridge call
   * guarantees these are consumed by the corresponding ingest().
   */
  private pendingDirectEdits: Array<{ sheetId: string; row: number; col: number }> | null = null;

  /**
   * Set the direct edit positions for the next mutation.
   * Called by cell-operations before triggering the bridge call.
   * Consumed (cleared) by the next ingest() call.
   */
  setDirectEdits(edits: Array<{ sheetId: string; row: number; col: number }>): void {
    this.pendingDirectEdits = edits;
  }

  /**
   * Called by MutationResultHandler after every mutation.
   *
   * @param changedCells - RecalcResult.changedCells from the MutationResult
   * @param directEdits - The (sheetId, row, col) tuples that were directly written
   *                      (to distinguish direct vs cascade)
   * @param source - user or remote
   */
  ingest(
    changedCells: CellChangeInfo[],
    directEdits: Array<{ sheetId: string; row: number; col: number }> | null,
    source: MutationSource,
  ): void {
    const hasTrackers = this.trackers.size > 0 || this.workbookTrackers.size > 0;
    if (!hasTrackers) {
      this.pendingDirectEdits = null;
      return;
    }
    if (changedCells.length === 0) {
      this.pendingDirectEdits = null;
      return;
    }

    // Use provided directEdits, or consume pending ones
    const edits = directEdits ?? this.pendingDirectEdits;
    this.pendingDirectEdits = null;

    // Build a set of direct-edit positions for O(1) lookup
    const directSet = new Set<string>();
    if (edits) {
      for (const e of edits) {
        directSet.add(`${e.sheetId}:${e.row}:${e.col}`);
      }
    }

    // Group records by sheetId for efficient fan-out
    const recordsBySheet = new Map<string, ChangeRecord[]>();

    for (const cell of changedCells) {
      const key = `${cell.sheetId}:${cell.row}:${cell.col}`;
      const origin: ChangeOrigin =
        source === 'remote' ? 'remote' : directSet.has(key) ? 'direct' : 'cascade';

      const record: ChangeRecord = {
        address: toA1(cell.row, cell.col),
        row: cell.row,
        col: cell.col,
        origin,
        type: 'modified',
        oldValue: cell.oldValue,
        oldDisplayValue: cell.oldDisplayText,
        oldFormula: cell.oldFormula ?? null,
        newValue: cell.value,
        newDisplayValue: cell.displayText,
        newFormula: cell.newFormula ?? null,
        numberFormat: cell.numberFormat,
      };

      let list = recordsBySheet.get(cell.sheetId);
      if (!list) {
        list = [];
        recordsBySheet.set(cell.sheetId, list);
      }
      list.push(record);
    }

    // Fan out to per-sheet trackers
    for (const tracker of this.trackers) {
      const records = recordsBySheet.get(tracker.sheetId);
      if (records && records.length > 0) {
        tracker._ingest(records);
      }
    }

    // Fan out to workbook-level trackers (all sheets at once)
    for (const tracker of this.workbookTrackers) {
      tracker._ingestBySheet(recordsBySheet);
    }
  }

  register(tracker: TrackerHandle): void {
    this.trackers.add(tracker);
  }

  unregister(tracker: TrackerHandle): void {
    this.trackers.delete(tracker);
  }

  registerWorkbook(tracker: WorkbookTrackerHandle): void {
    this.workbookTrackers.add(tracker);
  }

  unregisterWorkbook(tracker: WorkbookTrackerHandle): void {
    this.workbookTrackers.delete(tracker);
  }

  /** Number of active trackers (both per-sheet and workbook-level). */
  get activeCount(): number {
    return this.trackers.size + this.workbookTrackers.size;
  }
}
