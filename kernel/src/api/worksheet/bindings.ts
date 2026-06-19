/**
 * WorksheetBindingsImpl — Implementation of the WorksheetBindings sub-API.
 *
 * Delegates to the compute bridge for sheet-level data bindings and to
 * cell-operations for projection (dynamic array spill) queries.
 */

import type {
  CellRange,
  CreateBindingConfig,
  SheetDataBindingInfo,
  SheetId,
  WorksheetBindings,
  WorksheetRange,
} from '@mog-sdk/contracts/api';
import { KernelError } from '../../errors';

import type { DocumentContext } from '../../context';
import { resolveRange } from '../internal/address-resolver';
import { normalizeBindingResponse } from './operations/binding-helpers';
import * as CellOps from './operations/cell-operations';
import { toWorksheetRangeOrNull } from './public-ranges';

export class WorksheetBindingsImpl implements WorksheetBindings {
  constructor(
    private readonly ctx: DocumentContext,
    private readonly sheetId: SheetId,
  ) {}

  async list(): Promise<SheetDataBindingInfo[]> {
    try {
      const bindings = await this.ctx.computeBridge.getAllBindings(this.sheetId);
      return (bindings ?? []).map(normalizeBindingResponse);
    } catch (error) {
      throw new KernelError(
        'COMPUTE_ERROR',
        error instanceof Error ? error.message : 'Failed to list bindings',
      );
    }
  }

  async getCount(): Promise<number> {
    return (await this.list()).length;
  }

  async add(config: CreateBindingConfig): Promise<SheetDataBindingInfo> {
    try {
      // Snapshot existing binding IDs so we can identify the new one after creation.
      const before = await this.ctx.computeBridge.getAllBindings(this.sheetId);
      const existingIds = new Set((before ?? []).map((b) => b.id));

      await this.ctx.computeBridge.createBinding(this.sheetId, {
        connectionId: config.connectionId,
        columnMappings: config.columnMappings.map((m) => ({
          ...m,
          headerText: m.headerText ?? null,
        })),
        autoGenerateRows: config.autoGenerateRows ?? null,
        headerRow: config.headerRow ?? null,
        dataStartRow: config.dataStartRow ?? null,
        preserveHeaderFormatting: config.preserveHeaderFormatting ?? null,
      });

      // Read back the full binding list and find the newly created entry.
      const after = await this.ctx.computeBridge.getAllBindings(this.sheetId);
      const created = (after ?? []).find((b) => !existingIds.has(b.id));
      if (created) {
        return normalizeBindingResponse(created);
      }

      // Fallback: return a synthetic info from the config if the bridge
      // doesn't expose the new binding immediately.
      return normalizeBindingResponse({
        id: '',
        connectionId: config.connectionId,
        columnMappings: config.columnMappings,
        autoGenerateRows: config.autoGenerateRows ?? true,
        headerRow: config.headerRow ?? 0,
        dataStartRow: config.dataStartRow ?? 1,
        preserveHeaderFormatting: config.preserveHeaderFormatting ?? true,
      });
    } catch (error) {
      throw new KernelError(
        'COMPUTE_ERROR',
        error instanceof Error ? error.message : 'Failed to create binding',
      );
    }
  }

  async get(bindingId: string): Promise<SheetDataBindingInfo | null> {
    const bindings = await this.list();
    return bindings.find((b) => b.id === bindingId) ?? null;
  }

  async clear(): Promise<void> {
    const bindings = await this.list();
    for (const binding of bindings) {
      await this.remove(binding.id);
    }
  }

  async remove(bindingId: string): Promise<void> {
    try {
      await this.ctx.computeBridge.removeBinding(this.sheetId, bindingId);
    } catch (error) {
      throw new KernelError(
        'COMPUTE_ERROR',
        error instanceof Error ? error.message : 'Failed to remove binding',
      );
    }
  }

  async getProjectionRange(row: number, col: number): Promise<WorksheetRange | null> {
    return toWorksheetRangeOrNull(
      await CellOps.getProjectionRange(this.ctx, this.sheetId, row, col),
    );
  }

  async getProjectionSource(
    row: number,
    col: number,
  ): Promise<{ row: number; col: number } | null> {
    return CellOps.getProjectionSource(this.ctx, this.sheetId, row, col);
  }

  async isProjectedPosition(row: number, col: number): Promise<boolean> {
    return CellOps.isProjectedPosition(this.ctx, this.sheetId, row, col);
  }

  async getViewportProjectionData(
    range: string | CellRange,
  ): Promise<Array<{ originRow: number; originCol: number; rows: number; cols: number }>>;
  async getViewportProjectionData(
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
  ): Promise<Array<{ originRow: number; originCol: number; rows: number; cols: number }>>;
  async getViewportProjectionData(
    a: string | number | CellRange,
    b?: number,
    c?: number,
    d?: number,
  ): Promise<Array<{ originRow: number; originCol: number; rows: number; cols: number }>> {
    let startRow: number, startCol: number, endRow: number, endCol: number;
    if (typeof a === 'number') {
      startRow = a;
      startCol = b!;
      endRow = c!;
      endCol = d!;
    } else if (typeof a === 'string') {
      const resolved = resolveRange(a);
      startRow = resolved.startRow;
      startCol = resolved.startCol;
      endRow = resolved.endRow;
      endCol = resolved.endCol;
    } else {
      // CellRange object
      startRow = a.startRow;
      startCol = a.startCol;
      endRow = a.endRow;
      endCol = a.endCol;
    }
    return CellOps.getViewportProjectionData(
      this.ctx,
      this.sheetId,
      startRow,
      startCol,
      endRow,
      endCol,
    );
  }
}
