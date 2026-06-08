/**
 * WorksheetChangesImpl — Implementation of the ws.changes sub-API.
 *
 * Provides opt-in change tracking via trackers that accumulate cell-level
 * change records across mutations. Trackers are lightweight (addresses only)
 * to avoid bloating LLM agent context.
 */

import type {
  ChangeRecord,
  ChangeOrigin,
  ChangeTracker,
  ChangeTrackOptions,
  WorksheetChanges,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import type { HandleLiveness } from '../lifecycle/handle-liveness';
import type { TrackerHandle } from './change-accumulator';

// =============================================================================
// Range parser for scope filtering
// =============================================================================

function parseRangeScope(scope: string): {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
} | null {
  // Match "A1:Z100" style ranges
  const match = scope.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
  if (!match) return null;

  const startCol = letterToCol(match[1].toUpperCase());
  const startRow = parseInt(match[2], 10) - 1;
  const endCol = letterToCol(match[3].toUpperCase());
  const endRow = parseInt(match[4], 10) - 1;

  return { startRow, startCol, endRow, endCol };
}

function letterToCol(letters: string): number {
  let col = 0;
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return col - 1;
}

// =============================================================================
// ChangeTrackerImpl
// =============================================================================

class ChangeTrackerImpl implements ChangeTracker, TrackerHandle {
  readonly sheetId: string;
  private _active = true;
  private buffer: ChangeRecord[] = [];
  private scopeBounds: {
    startRow: number;
    startCol: number;
    endRow: number;
    endCol: number;
  } | null;
  private excludeOrigins: Set<ChangeOrigin> | null;
  private readonly unregister: () => void;
  private readonly liveness: HandleLiveness;
  private readonly stopLivenessListener: () => void;

  constructor(
    sheetId: string,
    options: ChangeTrackOptions | undefined,
    unregister: () => void,
    liveness: HandleLiveness,
  ) {
    this.sheetId = sheetId;
    this.unregister = unregister;
    this.liveness = liveness;
    this.scopeBounds = options?.scope ? parseRangeScope(options.scope) : null;
    this.excludeOrigins =
      options?.excludeOrigins && options.excludeOrigins.length > 0
        ? new Set(options.excludeOrigins)
        : null;
    this.stopLivenessListener = liveness.onInvalidate(() => {
      this.close();
    });
  }

  // --- TrackerHandle (called by ChangeAccumulator) ---

  _ingest(records: ChangeRecord[]): void {
    if (!this._active) return;

    for (const record of records) {
      // Apply origin filter
      if (this.excludeOrigins?.has(record.origin)) continue;

      // Apply scope filter
      if (this.scopeBounds) {
        const { startRow, startCol, endRow, endCol } = this.scopeBounds;
        if (
          record.row < startRow ||
          record.row > endRow ||
          record.col < startCol ||
          record.col > endCol
        ) {
          continue;
        }
      }

      this.buffer.push(record);
    }
  }

  // --- ChangeTracker public API ---

  collect(): ChangeRecord[] {
    this.liveness.assertLive('worksheet.changes.track.collect');
    const result = this.buffer;
    this.buffer = [];
    return result;
  }

  close(): void {
    if (!this._active) return;
    this._active = false;
    this.buffer = [];
    this.stopLivenessListener();
    this.unregister();
  }

  get active(): boolean {
    return this._active && !this.liveness.isDisposed;
  }
}

// =============================================================================
// WorksheetChangesImpl
// =============================================================================

export class WorksheetChangesImpl implements WorksheetChanges {
  constructor(
    private readonly ctx: DocumentContext,
    private readonly sheetId: string,
    private readonly liveness: HandleLiveness,
  ) {}

  track(options?: ChangeTrackOptions): ChangeTracker {
    this.liveness.assertLive('worksheet.changes.track');
    const accumulator = this.ctx.computeBridge.getMutationHandler()?.changeAccumulator;
    if (!accumulator) {
      throw new Error('Change tracking unavailable: MutationResultHandler not initialized');
    }

    const tracker = new ChangeTrackerImpl(
      this.sheetId,
      options,
      () => {
        accumulator.unregister(tracker);
      },
      this.liveness,
    );

    accumulator.register(tracker);
    return tracker;
  }
}
