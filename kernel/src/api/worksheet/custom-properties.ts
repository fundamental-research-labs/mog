/**
 * WorksheetCustomPropertiesImpl — Implementation of the WorksheetCustomProperties sub-API.
 *
 * Stores custom properties as a JSON-serialized object in a single sheet setting
 * key ('customProperties'). Each mutation reads the current bag, patches it, and
 * writes the whole blob back.
 */

import type { SheetId, WorksheetCustomProperties } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';

/** Sheet setting key used to persist the custom properties bag. */
const SETTING_KEY = 'customProperties';

type PropValue = string | number | boolean;
type PropBag = Record<string, PropValue>;

export class WorksheetCustomPropertiesImpl implements WorksheetCustomProperties {
  constructor(
    private readonly ctx: DocumentContext,
    private readonly sheetId: SheetId,
  ) {}

  async get(key: string): Promise<PropValue | undefined> {
    const bag = await this.readBag();
    return bag[key];
  }

  async set(key: string, value: PropValue): Promise<void> {
    const bag = await this.readBag();
    bag[key] = value;
    await this.writeBag(bag);
  }

  async delete(key: string): Promise<boolean> {
    const bag = await this.readBag();
    if (!(key in bag)) return false;
    delete bag[key];
    await this.writeBag(bag);
    return true;
  }

  async getAll(): Promise<PropBag> {
    return this.readBag();
  }

  async count(): Promise<number> {
    const bag = await this.readBag();
    return Object.keys(bag).length;
  }

  // --- Private helpers ---

  private async readBag(): Promise<PropBag> {
    const settings = await this.ctx.computeBridge.getSheetSettings(this.sheetId);
    const raw = (settings as unknown as Record<string, unknown>)[SETTING_KEY];
    if (raw == null) return {};
    if (typeof raw === 'string') {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as PropBag;
        }
      } catch {
        // Corrupted — treat as empty
      }
      return {};
    }
    if (typeof raw === 'object' && !Array.isArray(raw)) {
      return raw as PropBag;
    }
    return {};
  }

  private async writeBag(bag: PropBag): Promise<void> {
    await this.ctx.computeBridge.setSheetSetting(this.sheetId, SETTING_KEY, JSON.stringify(bag));
  }
}
