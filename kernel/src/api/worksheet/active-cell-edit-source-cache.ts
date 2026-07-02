import type { ActiveCellEditSource, CellRange, SheetId } from '@mog-sdk/contracts/api';
import type {
  SpreadsheetEvent,
  SpreadsheetEventType as InternalEventType,
} from '@mog-sdk/contracts/events';

import type { DocumentContext } from '../../context';
import * as CellOps from './operations/cell-operations';

export type CellRangeBounds = Pick<CellRange, 'startRow' | 'startCol' | 'endRow' | 'endCol'>;

type ActiveCellEditSourceTarget = {
  sheetId: SheetId;
  row: number;
  col: number;
};

const ACTIVE_CELL_EDIT_SOURCE_INVALIDATION_EVENTS: InternalEventType[] = [
  'cell:changed',
  'cells:batch-changed',
  'cell:format-changed',
  'cell:metadata-changed',
  'formula:changed',
  'rows:inserted',
  'rows:deleted',
  'columns:inserted',
  'columns:deleted',
  'range:created',
  'range:replaced',
  'range:removed',
  'range:sorted',
  'sheet:deleted',
  'sheet:renamed',
  'selection:changed',
  'import:complete',
];

export class ActiveCellEditSourceCache {
  private source: ActiveCellEditSource | null = null;
  private target: ActiveCellEditSourceTarget | null = null;
  private epoch = 0;
  private version = 0;
  private unsubscribeEvents: (() => void) | null = null;

  async refresh(ctx: DocumentContext, sheetId: SheetId, row: number, col: number): Promise<void> {
    this.ensureEventSubscription(ctx);
    const requestEpoch = this.epoch + 1;
    this.epoch = requestEpoch;
    if (
      this.source &&
      this.source.fresh &&
      (this.source.sheetId !== sheetId || this.source.row !== row || this.source.col !== col)
    ) {
      this.source = { ...this.source, fresh: false };
    }
    this.target = { sheetId, row, col };

    const source = await CellOps.getValueForEditing(ctx, sheetId, row, col);
    if (requestEpoch !== this.epoch) return;

    this.version += 1;
    this.source = {
      sheetId,
      row,
      col,
      source,
      version: this.version,
      fresh: true,
    };
  }

  get(sheetId: SheetId, row: number, col: number): ActiveCellEditSource | null {
    const cache = this.source;
    if (
      !cache ||
      !cache.fresh ||
      cache.sheetId !== sheetId ||
      cache.row !== row ||
      cache.col !== col
    ) {
      return null;
    }
    return { ...cache };
  }

  invalidateForCell(sheetId: SheetId, row: number, col: number): void {
    if (this.matchesCell(sheetId, row, col)) {
      this.markStale();
    }
  }

  invalidateForRange(sheetId: SheetId, range: CellRangeBounds): void {
    if (this.intersectsRange(sheetId, range)) {
      this.markStale();
    }
  }

  invalidateForSheet(sheetId: SheetId | string): void {
    if (this.target?.sheetId === sheetId) {
      this.markStale();
    }
  }

  dispose(): void {
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = null;
    this.source = null;
    this.target = null;
  }

  private ensureEventSubscription(ctx: DocumentContext): void {
    if (this.unsubscribeEvents) return;
    this.unsubscribeEvents = ctx.eventBus.onMany(
      ACTIVE_CELL_EDIT_SOURCE_INVALIDATION_EVENTS,
      (event) => {
        this.invalidateForEvent(event);
      },
    );
  }

  private matchesCell(sheetId: SheetId | string, row: number, col: number): boolean {
    return this.target?.sheetId === sheetId && this.target.row === row && this.target.col === col;
  }

  private intersectsRange(sheetId: SheetId | string, range: CellRangeBounds): boolean {
    const target = this.target;
    if (!target || target.sheetId !== sheetId) return false;
    return (
      target.row >= range.startRow &&
      target.row <= range.endRow &&
      target.col >= range.startCol &&
      target.col <= range.endCol
    );
  }

  private markStale(): void {
    this.epoch += 1;
    if (this.source) {
      this.source = { ...this.source, fresh: false };
    }
  }

  private invalidateForEvent(event: SpreadsheetEvent): void {
    switch (event.type) {
      case 'cell:changed':
      case 'cell:format-changed':
      case 'cell:metadata-changed':
      case 'formula:changed':
        if (this.matchesCell(event.sheetId, event.row, event.col)) {
          this.markStale();
        }
        break;
      case 'cells:batch-changed':
        if (
          this.target?.sheetId === event.sheetId &&
          event.changes.some((change) => this.matchesCell(event.sheetId, change.row, change.col))
        ) {
          this.markStale();
        }
        break;
      case 'rows:inserted':
      case 'rows:deleted': {
        const target = this.target;
        if (target?.sheetId === event.sheetId && target.row >= event.startRow) {
          this.markStale();
        }
        break;
      }
      case 'columns:inserted':
      case 'columns:deleted': {
        const target = this.target;
        if (target?.sheetId === event.sheetId && target.col >= event.startCol) {
          this.markStale();
        }
        break;
      }
      case 'range:sorted':
        if (this.intersectsRange(event.sheetId, event.range)) {
          this.markStale();
        }
        break;
      case 'range:created':
      case 'range:replaced':
      case 'range:removed':
      case 'sheet:deleted':
        this.invalidateForSheet(event.sheetId);
        break;
      case 'selection:changed':
        this.invalidateForSheet(event.sheetId);
        break;
      case 'sheet:renamed':
      case 'import:complete':
        if (this.target) {
          this.markStale();
        }
        break;
    }
  }
}
