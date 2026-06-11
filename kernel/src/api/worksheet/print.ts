/**
 * WorksheetPrintImpl — Implementation of the WorksheetPrint sub-API.
 *
 * Delegates to sheet-management-operations for print settings and page breaks.
 * Operations that return OperationResult are unwrapped inline.
 */

import type { PrintSettings, SheetId, WorksheetPrint } from '@mog-sdk/contracts/api';
import type { HeaderFooterImageInfo, HfImagePosition, PageMargins } from '@mog-sdk/contracts/core';
import type { SpreadsheetEvent } from '@mog-sdk/contracts/events';

import type { DocumentContext } from '../../context';
import { KernelError } from '../../errors';
import * as SheetMgmtOps from './operations/sheet-management-operations';

const EXCEL_DEFAULT_PRINT_MARGINS: PageMargins = {
  top: 0.75,
  bottom: 0.75,
  left: 0.7,
  right: 0.7,
  header: 0.3,
  footer: 0.3,
};

/** Inline unwrap: throws KernelError on failure, returns data on success. */
function unwrapResult<T>(result: { success: boolean; data?: T; error?: any }): T {
  if (!result.success) {
    if (result.error instanceof KernelError) throw result.error;
    throw KernelError.from(
      result.error,
      'COMPUTE_ERROR',
      String(result.error?.message ?? result.error ?? 'Operation failed'),
    );
  }
  return result.data as T;
}

export class WorksheetPrintImpl implements WorksheetPrint {
  constructor(
    private readonly ctx: DocumentContext,
    private readonly sheetId: SheetId,
  ) {}

  private _ensureWritable(op: string): void {
    this.ctx.writeGate.assertWritable(op);
  }

  async getSettings(): Promise<PrintSettings> {
    // Route through `ctx.mirror` — no Rust IPC. The mirror keeps the
    // canonical stored shape where `margins: null` means "use defaults";
    // the public worksheet API exposes the effective Excel defaults.
    const settings = this.ctx.mirror.getPrintSettings(this.sheetId);
    if (settings.margins) return settings;
    return {
      ...settings,
      margins: { ...EXCEL_DEFAULT_PRINT_MARGINS },
    };
  }

  async setSettings(settings: Partial<PrintSettings>): Promise<void> {
    this._ensureWritable('print.setSettings');
    // Merge with existing settings so all required Rust fields are present
    const existing = await SheetMgmtOps.getPrintSettings(this.ctx, this.sheetId);
    const merged = { ...existing, ...settings };
    unwrapResult(await SheetMgmtOps.setPrintSettings(this.ctx, this.sheetId, merged));
    // Emit reactive event so usePrintSettings hook re-renders consumers
    const updated = await SheetMgmtOps.getPrintSettings(this.ctx, this.sheetId);
    const event: SpreadsheetEvent = {
      type: 'sheet:print-settings-changed',
      timestamp: Date.now(),
      sheetId: this.sheetId,
      settings: updated,
      source: 'user',
    };
    this.ctx.eventBus.emit(event);
  }

  async getArea(): Promise<string | null> {
    return SheetMgmtOps.getPrintArea(this.ctx, this.sheetId);
  }

  async setArea(area: string): Promise<void> {
    unwrapResult(await SheetMgmtOps.setPrintArea(this.ctx, this.sheetId, area));
  }

  async clearArea(): Promise<void> {
    unwrapResult(await SheetMgmtOps.clearPrintArea(this.ctx, this.sheetId));
  }

  async addPageBreak(
    type: 'horizontal' | 'vertical' | 'row' | 'col',
    position: number,
  ): Promise<void> {
    unwrapResult(await SheetMgmtOps.addPageBreak(this.ctx, this.sheetId, type, position));
  }

  async removePageBreak(
    type: 'horizontal' | 'vertical' | 'row' | 'col',
    position: number,
  ): Promise<void> {
    unwrapResult(await SheetMgmtOps.removePageBreak(this.ctx, this.sheetId, type, position));
  }

  async getPageBreaks(): Promise<{
    rowBreaks: Array<{ id: number; min: number; max: number; manual: boolean; pt: boolean }>;
    colBreaks: Array<{ id: number; min: number; max: number; manual: boolean; pt: boolean }>;
  }> {
    // route through `ctx.mirror` — no Rust IPC. The
    // mirror normalizes the wire shape (`min`/`pt` skip-zero/false defaults)
    // at apply time, so consumers see required fields filled in.
    return this.ctx.mirror.getPageBreaks(this.sheetId);
  }

  async clearPageBreaks(): Promise<void> {
    unwrapResult(await SheetMgmtOps.clearPageBreaks(this.ctx, this.sheetId));
  }

  async setPrintTitleRows(startRow: number, endRow: number): Promise<void> {
    const existing = await this.ctx.computeBridge.getPrintTitles(this.sheetId);
    await this.ctx.computeBridge.setPrintTitles(this.sheetId, {
      ...existing,
      repeatRows: [startRow, endRow],
    });
  }

  async setPrintTitleColumns(startCol: number, endCol: number): Promise<void> {
    const existing = await this.ctx.computeBridge.getPrintTitles(this.sheetId);
    await this.ctx.computeBridge.setPrintTitles(this.sheetId, {
      ...existing,
      repeatCols: [startCol, endCol],
    });
  }

  async getPrintTitleRows(): Promise<[number, number] | null> {
    // route through `ctx.mirror`.
    const titles = this.ctx.mirror.getPrintTitles(this.sheetId);
    return titles?.repeatRows ?? null;
  }

  async getPrintTitleColumns(): Promise<[number, number] | null> {
    // route through `ctx.mirror`.
    const titles = this.ctx.mirror.getPrintTitles(this.sheetId);
    return titles?.repeatCols ?? null;
  }

  async clearPrintTitles(): Promise<void> {
    await this.ctx.computeBridge.setPrintTitles(this.sheetId, {
      repeatRows: undefined,
      repeatCols: undefined,
    });
  }

  async setPrintMargins(
    unit: 'inches' | 'points' | 'centimeters',
    options: Partial<PageMargins>,
  ): Promise<void> {
    const factor = unit === 'points' ? 1 / 72 : unit === 'centimeters' ? 1 / 2.54 : 1;
    const converted: Partial<PageMargins> = {};
    for (const key of ['top', 'bottom', 'left', 'right', 'header', 'footer'] as const) {
      if (options[key] !== undefined) {
        converted[key] = options[key]! * factor;
      }
    }
    const existing = await this.getSettings();
    const currentMargins = existing.margins ?? {
      top: 0.75,
      bottom: 0.75,
      left: 0.7,
      right: 0.7,
      header: 0.3,
      footer: 0.3,
    };
    await this.setSettings({
      margins: { ...currentMargins, ...converted },
    });
  }

  getCellAfterBreak(
    type: 'horizontal' | 'vertical' | 'row' | 'col',
    position: number,
  ): { row: number; col: number } {
    const isRow = type === 'horizontal' || type === 'row';
    return isRow ? { row: position + 1, col: 0 } : { row: 0, col: position + 1 };
  }

  async getHeaderFooterImages(): Promise<HeaderFooterImageInfo[]> {
    return this.ctx.computeBridge.getHfImages(this.sheetId);
  }

  async setHeaderFooterImage(info: HeaderFooterImageInfo): Promise<void> {
    await this.ctx.computeBridge.setHfImage(this.sheetId, info);
  }

  async removeHeaderFooterImage(position: HfImagePosition): Promise<void> {
    await this.ctx.computeBridge.removeHfImage(this.sheetId, position);
  }
}
