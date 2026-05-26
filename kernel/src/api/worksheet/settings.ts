/**
 * WorksheetSettingsImpl — Implementation of the WorksheetSettings sub-API.
 *
 * Delegates to the compute bridge for sheet settings.
 */

import type { SheetId, SheetSettingsInfo, WorksheetSettings } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';

export class WorksheetSettingsImpl implements WorksheetSettings {
  constructor(
    private readonly ctx: DocumentContext,
    private readonly sheetId: SheetId,
  ) {}

  private _ensureWritable(op: string): void {
    this.ctx.writeGate.assertWritable(op);
  }

  async get(): Promise<SheetSettingsInfo> {
    return this.ctx.computeBridge.getSheetSettings(this.sheetId) as Promise<SheetSettingsInfo>;
  }

  async set<K extends keyof SheetSettingsInfo>(key: K, value: SheetSettingsInfo[K]): Promise<void> {
    this._ensureWritable('settings.set');
    // Bridge only accepts string values — use JSON.stringify for non-strings
    // so booleans/numbers can be deserialized correctly on the other side.
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    await this.ctx.computeBridge.setSheetSetting(this.sheetId, key as string, serialized);
  }

  async getStandardHeight(): Promise<number> {
    const settings = (await this.ctx.computeBridge.getSheetSettings(
      this.sheetId,
    )) as SheetSettingsInfo;
    return settings.defaultRowHeight;
  }

  async getStandardWidth(): Promise<number> {
    const settings = (await this.ctx.computeBridge.getSheetSettings(
      this.sheetId,
    )) as SheetSettingsInfo;
    return settings.defaultColWidth;
  }

  async setStandardWidth(width: number): Promise<void> {
    await this.ctx.computeBridge.setSheetSetting(
      this.sheetId,
      'defaultColWidth',
      JSON.stringify(width),
    );
  }
}
