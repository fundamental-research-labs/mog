/**
 * WorkbookSlicersImpl — Implementation of the WorkbookSlicers sub-API.
 *
 * Provides workbook-scoped slicer access by using the Rust bridge's
 * getAllSlicersWorkbook() for efficient cross-sheet queries.
 */
import type { Slicer, SlicerInfo, SlicerItem, WorkbookSlicers } from '@mog-sdk/contracts/api';
import { type CellValue, type SheetId, sheetId } from '@mog-sdk/contracts/core';
import type { DocumentContext } from '../../context';
import { KernelError } from '../../errors';

/**
 * Dependencies injected from WorkbookImpl.
 */
export interface WorkbookSlicersDeps {
  ctx: DocumentContext;
  /** Get a worksheet's slicers sub-API by sheet ID. */
  getWorksheetSlicers: (sheetId: SheetId) => {
    get(slicerId: string): Promise<Slicer | null>;
    getItems(slicerId: string): Promise<SlicerItem[]>;
    getItem(slicerId: string, key: CellValue): Promise<SlicerItem>;
    getItemOrNullObject(slicerId: string, key: CellValue): Promise<SlicerItem | null>;
    remove(slicerId: string): Promise<void>;
  };
}

export class WorkbookSlicersImpl implements WorkbookSlicers {
  /** Cached raw slicer data from the bridge. Invalidated on add/remove. */
  private _cachedSlicers: Awaited<
    ReturnType<DocumentContext['computeBridge']['getAllSlicersWorkbook']>
  > | null = null;

  constructor(private readonly deps: WorkbookSlicersDeps) {}

  /** Fetch all slicers from the bridge, using cache if available. */
  private async _getAllSlicers() {
    if (this._cachedSlicers === null) {
      this._cachedSlicers = await this.deps.ctx.computeBridge.getAllSlicersWorkbook();
    }
    return this._cachedSlicers;
  }

  /** Invalidate the cached slicer list. */
  private _invalidateCache(): void {
    this._cachedSlicers = null;
  }

  async list(): Promise<SlicerInfo[]> {
    const slicers = await this._getAllSlicers();
    return Promise.all(
      slicers.map(async (s) => {
        const wsSlicers = this.deps.getWorksheetSlicers(sheetId(s.sheetId));
        const slicer = await wsSlicers.get(s.id);
        return {
          id: s.id,
          name: slicer?.name ?? s.name ?? s.caption,
          caption: slicer?.caption ?? s.caption,
          tableName: slicer?.tableName ?? '',
          columnName: slicer?.columnName ?? '',
          source: slicer?.source ?? s.source,
        };
      }),
    );
  }

  async getItemAt(index: number): Promise<SlicerInfo | null> {
    const slicers = await this.list();
    return slicers[index] ?? null;
  }

  async get(slicerId: string): Promise<Slicer | null> {
    const stored = await this._findSlicerSheet(slicerId);
    if (!stored) return null;
    const wsSlicers = this.deps.getWorksheetSlicers(sheetId(stored.sheetId));
    return wsSlicers.get(slicerId);
  }

  async getItems(slicerId: string): Promise<SlicerItem[]> {
    const stored = await this._findSlicerSheet(slicerId);
    if (!stored) return [];
    const wsSlicers = this.deps.getWorksheetSlicers(sheetId(stored.sheetId));
    return wsSlicers.getItems(slicerId);
  }

  async getItem(slicerId: string, key: CellValue): Promise<SlicerItem> {
    const stored = await this._findSlicerSheet(slicerId);
    if (!stored) {
      throw new KernelError('COMPUTE_ERROR', `Slicer "${slicerId}" not found`);
    }
    const wsSlicers = this.deps.getWorksheetSlicers(sheetId(stored.sheetId));
    return wsSlicers.getItem(slicerId, key);
  }

  async getItemOrNullObject(slicerId: string, key: CellValue): Promise<SlicerItem | null> {
    const stored = await this._findSlicerSheet(slicerId);
    if (!stored) return null;
    const wsSlicers = this.deps.getWorksheetSlicers(sheetId(stored.sheetId));
    return wsSlicers.getItemOrNullObject(slicerId, key);
  }

  async remove(slicerId: string): Promise<void> {
    const stored = await this._findSlicerSheet(slicerId);
    if (!stored) {
      throw new KernelError('COMPUTE_ERROR', `Slicer "${slicerId}" not found`);
    }
    const wsSlicers = this.deps.getWorksheetSlicers(sheetId(stored.sheetId));
    this._invalidateCache();
    return wsSlicers.remove(slicerId);
  }

  async getCount(): Promise<number> {
    const slicers = await this._getAllSlicers();
    return slicers.length;
  }

  /** Find which sheet a slicer belongs to via the cached workbook-level query. */
  private async _findSlicerSheet(slicerId: string) {
    const all = await this._getAllSlicers();
    return all.find((s) => s.id === slicerId) ?? null;
  }
}
