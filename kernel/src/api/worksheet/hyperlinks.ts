/**
 * WorksheetHyperlinksImpl — Implementation of the WorksheetHyperlinks sub-API.
 *
 * Delegates to HyperlinkOps (the operations layer) which wraps domain Cells
 * module with error handling and OperationResult return types.
 * All mutations throw on failure.
 */

import type { SheetId, WorksheetHyperlink, WorksheetHyperlinks } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import { KernelError } from '../../errors';
import { resolveCell, resolveCellArgs } from '../internal/address-resolver';
import { toA1 } from '../internal/utils';
import * as HyperlinkOps from './operations/hyperlink-operations';

export class WorksheetHyperlinksImpl implements WorksheetHyperlinks {
  constructor(
    private readonly ctx: DocumentContext,
    private readonly sheetId: SheetId,
  ) {}

  private _ensureWritable(op: string): void {
    this.ctx.writeGate.assertWritable(op);
  }

  async set(a: string | number, b: string | number, c?: string): Promise<void> {
    this._ensureWritable('hyperlinks.set');
    const { row, col, value: url } = resolveCellArgs<string>(a, b, c);
    if (row < 0 || col < 0) {
      throw new KernelError('API_INVALID_ADDRESS', `Invalid cell address: row=${row}, col=${col}`);
    }
    await HyperlinkOps.setHyperlink(this.ctx, this.sheetId, row, col, url);
  }

  async get(a: string | number, b?: number): Promise<string | null> {
    const { row, col } = resolveCell(a, b);
    if (row < 0 || col < 0) {
      return null;
    }
    return HyperlinkOps.getHyperlink(this.ctx, this.sheetId, row, col);
  }

  async has(a: string | number, b?: number): Promise<boolean> {
    const result = await this.get(a, b);
    return result !== null;
  }

  async remove(a: string | number, b?: number): Promise<void> {
    const { row, col } = resolveCell(a, b);
    if (row < 0 || col < 0) {
      throw new KernelError('API_INVALID_ADDRESS', `Invalid cell address: row=${row}, col=${col}`);
    }
    await HyperlinkOps.removeHyperlink(this.ctx, this.sheetId, row, col);
  }

  async list(): Promise<WorksheetHyperlink[]> {
    const hyperlinks = await this.ctx.computeBridge.getHyperlinks(this.sheetId);
    return hyperlinks
      .map((link) => {
        const ref = link.cellRef;
        const url = link.target ?? link.location ?? '';
        if (!ref || !url) return null;
        return {
          address: ref,
          ref,
          url,
          ...(link.display ? { display: link.display } : {}),
          ...(link.tooltip ? { tooltip: link.tooltip } : {}),
        };
      })
      .filter((link): link is WorksheetHyperlink => link !== null);
  }

  async clear(): Promise<void> {
    const bounds = await this.ctx.computeBridge.getDataBounds(this.sheetId);
    if (!bounds) return;

    await this.ctx.computeBridge.clearHyperlinksInRange(
      this.sheetId,
      bounds.minRow,
      bounds.minCol,
      bounds.maxRow,
      bounds.maxCol,
    );
  }
}
