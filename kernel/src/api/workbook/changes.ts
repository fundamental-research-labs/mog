/**
 * WorkbookChangesImpl — Implementation of the wb.changes sub-API.
 *
 * Provides opt-in workbook-level change tracking via trackers that accumulate
 * cell-level change records across ALL sheets. This is the primary pattern for
 * code execution (agent code routinely mutates multiple sheets).
 *
 * Analogous to WorksheetChangesImpl but uses WorkbookTrackerHandle to receive
 * records grouped by sheetId, then resolves sheetId → sheet name for the
 * WorkbookChangeRecord.sheet field.
 */

import type {
  WorkbookChanges,
  WorkbookChangeTracker,
  WorkbookChangeRecord,
  WorkbookCollectResult,
  WorkbookTrackOptions,
} from '@mog-sdk/contracts/api';
import type { ChangeRecord, ChangeOrigin } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import type { WorkbookTrackerHandle } from '../worksheet/change-accumulator';
import { getName } from '../../domain/sheets/sheet-meta';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { HandleLiveness } from '../lifecycle/handle-liveness';

// =============================================================================
// WorkbookChangeTrackerImpl
// =============================================================================

const DEFAULT_LIMIT = 10_000;

/**
 * Internal record that stores the raw sheetId (string) during ingest.
 * Sheet names are resolved at collect() time to avoid calling async
 * getName() inside the synchronous _ingestBySheet callback.
 */
interface PendingRecord {
  sid: string;
  record: ChangeRecord;
}

class WorkbookChangeTrackerImpl implements WorkbookChangeTracker, WorkbookTrackerHandle {
  private _active = true;
  private pending: PendingRecord[] = [];
  private _totalObserved = 0;
  private _truncated = false;

  /**
   * Eagerly populated name cache: sheetId → sheet name.
   * Populated asynchronously during _ingestBySheet so that by the time
   * collect() is called synchronously the names are available.
   */
  private readonly nameCache = new Map<string, string>();

  private readonly limit: number;
  private readonly originFilter: Set<ChangeOrigin> | null;
  private readonly unregister: () => void;
  private readonly resolveSheetName: (sid: string) => Promise<string>;
  private readonly liveness: HandleLiveness;
  private readonly stopLivenessListener: () => void;

  constructor(
    options: WorkbookTrackOptions | undefined,
    unregister: () => void,
    resolveSheetName: (sid: string) => Promise<string>,
    liveness: HandleLiveness,
  ) {
    this.unregister = unregister;
    this.resolveSheetName = resolveSheetName;
    this.liveness = liveness;
    this.limit = options?.limit ?? DEFAULT_LIMIT;
    this.originFilter =
      options?.origins && options.origins.length > 0 ? new Set(options.origins) : null;
    this.stopLivenessListener = liveness.onInvalidate(() => {
      this.close();
    });
  }

  // --- WorkbookTrackerHandle (called by ChangeAccumulator) ---

  _ingestBySheet(recordsBySheet: Map<string, ChangeRecord[]>): void {
    if (!this._active) return;

    for (const [sid, records] of recordsBySheet) {
      // Eagerly kick off name resolution for any new sheetId so that the
      // nameCache is populated by the time the caller invokes collect().
      if (!this.nameCache.has(sid)) {
        void this.resolveSheetName(sid).then((name) => {
          this.nameCache.set(sid, name);
        });
      }

      for (const record of records) {
        this._totalObserved++;

        // Apply origin filter
        if (this.originFilter && !this.originFilter.has(record.origin)) continue;

        // Apply limit
        if (this.pending.length >= this.limit) {
          this._truncated = true;
          continue;
        }

        this.pending.push({ sid, record });
      }
    }
  }

  // --- WorkbookChangeTracker public API ---

  collect(): WorkbookCollectResult {
    this.liveness.assertLive('workbook.changes.track.collect');
    // Use the eagerly-populated nameCache to resolve sheetId → sheet name.
    // The cache is populated asynchronously during _ingestBySheet(), which
    // fires on every mutation. By the time user code calls collect() (after
    // awaiting their mutation), the microtask resolving the name will have
    // completed, so the cache hit rate is effectively 100%.
    // Falls back to raw sheetId only if the name hasn't resolved yet.
    const records: WorkbookChangeRecord[] = this.pending.map(({ sid, record }) => ({
      sheet: this.nameCache.get(sid) ?? sid,
      address: record.address,
      row: record.row,
      col: record.col,
      origin: record.origin,
      type: 'modified' as const,
      oldValue: record.oldValue,
      newValue: record.newValue,
    }));

    const result: WorkbookCollectResult = {
      records,
      truncated: this._truncated,
      totalObserved: this._totalObserved,
    };

    this.pending = [];
    this._totalObserved = 0;
    this._truncated = false;
    return result;
  }

  /**
   * Async version of collect() that properly resolves sheet names.
   * Preferred over collect() when called from async context.
   */
  async collectAsync(): Promise<WorkbookCollectResult> {
    this.liveness.assertLive('workbook.changes.track.collectAsync');
    const pendingSnapshot = this.pending;
    const truncated = this._truncated;
    const totalObserved = this._totalObserved;

    this.pending = [];
    this._totalObserved = 0;
    this._truncated = false;

    // Batch-resolve unique sids (skip those already in the eager cache)
    const uniqueSids = [...new Set(pendingSnapshot.map((p) => p.sid))];
    await Promise.all(
      uniqueSids.map(async (sid) => {
        if (!this.nameCache.has(sid)) {
          const name = await this.resolveSheetName(sid);
          this.nameCache.set(sid, name);
        }
      }),
    );

    const records: WorkbookChangeRecord[] = pendingSnapshot.map(({ sid, record }) => ({
      sheet: this.nameCache.get(sid) ?? sid,
      address: record.address,
      row: record.row,
      col: record.col,
      origin: record.origin,
      type: 'modified' as const,
      oldValue: record.oldValue,
      newValue: record.newValue,
    }));

    return { records, truncated, totalObserved };
  }

  close(): void {
    if (!this._active) return;
    this._active = false;
    this.pending = [];
    this.stopLivenessListener();
    this.unregister();
  }

  get active(): boolean {
    return this._active && !this.liveness.isDisposed;
  }
}

// =============================================================================
// WorkbookChangesImpl
// =============================================================================

export class WorkbookChangesImpl implements WorkbookChanges {
  constructor(
    private readonly ctx: DocumentContext,
    private readonly liveness: HandleLiveness,
  ) {}

  track(options?: WorkbookTrackOptions): WorkbookChangeTracker {
    this.liveness.assertLive('workbook.changes.track');
    const accumulator = this.ctx.computeBridge.getMutationHandler()?.changeAccumulator;
    if (!accumulator) {
      throw new Error('Change tracking unavailable: MutationResultHandler not initialized');
    }

    const tracker = new WorkbookChangeTrackerImpl(
      options,
      () => {
        accumulator.unregisterWorkbook(tracker);
      },
      async (sid: string) => {
        try {
          return (await getName(this.ctx, toSheetId(sid))) ?? sid;
        } catch {
          return sid;
        }
      },
      this.liveness,
    );

    accumulator.registerWorkbook(tracker);
    return tracker;
  }
}
