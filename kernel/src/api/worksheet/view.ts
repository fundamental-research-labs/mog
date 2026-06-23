/**
 * WorksheetViewImpl — Implementation of the WorksheetView sub-API.
 *
 * Calls computeBridge directly for freeze/tab-color/view-options,
 * split config, and gridlines/headings.
 */

import type { ScrollPosition, SheetId, ViewOptions, WorksheetView } from '@mog-sdk/contracts/api';
import type { SpreadsheetEvent } from '@mog-sdk/contracts/events';
import type { SplitViewportConfig } from '@mog-sdk/contracts/viewport-config';
import { createSplitViewportConfig } from '@mog/spreadsheet-utils/viewport/viewport-config';
import { KernelError } from '../../errors';
import { createVersionOperationContext } from '../internal/version-operation-context';
import { parseCellAddress } from '../internal/utils';

import type { DocumentContext } from '../../context';

export class WorksheetViewImpl implements WorksheetView {
  constructor(
    private readonly ctx: DocumentContext,
    private readonly sheetId: SheetId,
  ) {}

  private _ensureWritable(op: string): void {
    this.ctx.writeGate.assertWritable(op);
  }

  async freezeRows(count: number): Promise<void> {
    this._ensureWritable('view.freezeRows');
    if (count < 0) {
      throw new KernelError('COMPUTE_ERROR', 'Row count cannot be negative');
    }
    await this.ctx.computeBridge.freezeRows(this.sheetId, count);
  }

  async freezeColumns(count: number): Promise<void> {
    this._ensureWritable('view.freezeColumns');
    if (count < 0) {
      throw new KernelError('COMPUTE_ERROR', 'Column count cannot be negative');
    }
    await this.ctx.computeBridge.freezeColumns(this.sheetId, count);
  }

  async freezePanes(rows: number, cols: number): Promise<void> {
    await this.setFrozenPanesForOperation(rows, cols, 'view.freezePanes');
  }

  async setFrozenPanes(rows: number, cols: number): Promise<void> {
    await this.setFrozenPanesForOperation(rows, cols, 'view.setFrozenPanes');
  }

  private async setFrozenPanesForOperation(
    rows: number,
    cols: number,
    operation: string,
  ): Promise<void> {
    this._ensureWritable(operation);
    if (rows < 0 || cols < 0) {
      throw new KernelError('COMPUTE_ERROR', 'Frozen row and column counts cannot be negative');
    }
    await this.ctx.computeBridge.setFrozenPanes(this.sheetId, rows, cols);
  }

  async unfreeze(): Promise<void> {
    this._ensureWritable('view.unfreeze');
    await this.ctx.computeBridge.setFrozenPanes(this.sheetId, 0, 0);
  }

  async getFrozenPanes(): Promise<{ rows: number; cols: number }> {
    // route direct read through `ctx.mirror` —
    // no Rust IPC. The mirror is populated by `MutationResultHandler.applyAndNotify`
    // BEFORE event emission, so this read is correct on first paint and on
    // every subsequent re-read. The Promise wrapper is preserved so the
    // existing async API contract is unchanged for non-hook callers
    // (api-eval, MCP, etc.); hook initializers can read the mirror directly
    // via `wb.mirror.getFrozenPanes(sheetId)` for sync access.
    return this.ctx.mirror.getFrozenPanes(this.sheetId);
  }

  async freezeAt(range: string): Promise<void> {
    const parsed = parseCellAddress(range);
    if (!parsed) {
      throw new KernelError('COMPUTE_ERROR', `Invalid cell address: ${range}`);
    }
    await this.ctx.computeBridge.setFrozenPanes(this.sheetId, parsed.row, parsed.col);
  }

  async getSplitConfig(): Promise<SplitViewportConfig | null> {
    // route through `ctx.mirror`. Same direction-
    // derivation logic as the IPC path, but reading from the mirror's
    // structured snapshot instead of the wire shape.
    const raw = this.ctx.mirror.getSplitConfig(this.sheetId);
    if (!raw) return null;

    const hasHorizontal = raw.horizontalPosition != null && raw.horizontalPosition > 0;
    const hasVertical = raw.verticalPosition != null && raw.verticalPosition > 0;

    let direction: 'horizontal' | 'vertical' | 'both';
    if (hasHorizontal && hasVertical) {
      direction = 'both';
    } else if (hasHorizontal) {
      direction = 'horizontal';
    } else if (hasVertical) {
      direction = 'vertical';
    } else {
      return null;
    }

    return createSplitViewportConfig(
      direction,
      raw.horizontalPosition ?? 0,
      raw.verticalPosition ?? 0,
    );
  }

  async setSplitConfig(config: SplitViewportConfig | null): Promise<void> {
    if (!config) {
      await this.ctx.computeBridge.setSplitConfig(this.sheetId, null);
      return;
    }
    await this.ctx.computeBridge.setSplitConfig(this.sheetId, {
      direction: config.direction,
      horizontalPosition: config.horizontalPosition,
      verticalPosition: config.verticalPosition,
    });
  }

  async setGridlines(show: boolean): Promise<void> {
    await this.ctx.computeBridge.setViewOption(this.sheetId, 'showGridlines', show);
    await this.emitViewOptionsChanged();
  }

  async setHeadings(show: boolean): Promise<void> {
    await this.ctx.computeBridge.setViewOption(this.sheetId, 'showRowHeaders', show);
    await this.ctx.computeBridge.setViewOption(this.sheetId, 'showColumnHeaders', show);
    await this.emitViewOptionsChanged();
  }

  async setShowFormulas(show: boolean): Promise<void> {
    await this.ctx.computeBridge.setViewOption(this.sheetId, 'showFormulas', show);
  }

  private async emitViewOptionsChanged(): Promise<void> {
    // The MutationResultHandler now emits `view:options-changed` directly
    // when a view-option key changes (state-mirror event emission, see
    // VIEW_OPTION_KEYS in core-defaults.ts). This manual emission is
    // retained as a defensive belt-and-suspenders for cases where the
    // single setViewOption -> dispatcher path doesn't propagate (e.g.
    // legacy callers that bypass the bridge). It now reads from the
    // mirror — no Rust IPC round-trip — so the cost is negligible.
    const opts = this.ctx.mirror.getViewOptions(this.sheetId);
    const event: SpreadsheetEvent = {
      type: 'view:options-changed',
      timestamp: Date.now(),
      sheetId: this.sheetId,
      showGridlines: opts.showGridlines,
      showRowHeaders: opts.showRowHeaders,
      showColumnHeaders: opts.showColumnHeaders,
      source: 'user',
    };
    this.ctx.eventBus.emit(event);
  }

  async getViewOptions(): Promise<ViewOptions> {
    // route through `ctx.mirror`. The full
    // `SheetViewOptions` (incl. rightToLeft / showFormulas / showZeros / zoomScale)
    // is available on the mirror; the contract here returns the public
    // `ViewOptions` projection (just the three header/gridline flags).
    const raw = this.ctx.mirror.getViewOptions(this.sheetId);
    return {
      showGridlines: raw.showGridlines,
      showRowHeaders: raw.showRowHeaders,
      showColumnHeaders: raw.showColumnHeaders,
    };
  }

  async getTabColor(): Promise<string | null> {
    return this.ctx.computeBridge.getTabColorQuery(this.sheetId);
  }

  async setTabColor(color: string | null): Promise<void> {
    await this.ctx.computeBridge.setTabColor(this.sheetId, color, {
      operationContext: createVersionOperationContext(this.ctx, {
        operationIdPrefix: 'worksheet.view.setTabColor',
        sheetIds: [this.sheetId],
        domainIds: ['sheets'],
      }),
    });
  }

  async getScrollPosition(): Promise<ScrollPosition> {
    // route through `ctx.mirror`.
    const raw = this.ctx.mirror.getScrollPosition(this.sheetId);
    return { topRow: raw.topRow, leftCol: raw.leftCol };
  }

  async setScrollPosition(topRow: number, leftCol: number): Promise<void> {
    await this.ctx.computeBridge.setScrollPosition(this.sheetId, topRow, leftCol);
  }
}
