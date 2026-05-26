/**
 * WorksheetStylesImpl — Implementation of the WorksheetStyles sub-API.
 *
 * Resolves named styles via domain/cells/cell-properties, then applies format
 * properties to cells/ranges via the same domain functions.
 */

import type { CellFormat, CellRange, SheetId, WorksheetStyles } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import {
  getAllStyles,
  applyStyleToRange,
  applyStyleToCell,
} from '../../domain/cells/cell-properties';
import { KernelError } from '../../errors';
import { resolveCell } from '../internal/address-resolver';
import { parseCellRange } from '../internal/utils';

export class WorksheetStylesImpl implements WorksheetStyles {
  constructor(
    private readonly ctx: DocumentContext,
    private readonly sheetId: SheetId,
  ) {}

  private _ensureWritable(op: string): void {
    this.ctx.writeGate.assertWritable(op);
  }

  async applyStyle(address: string, styleName: string): Promise<void> {
    this._ensureWritable('styles.applyStyle');
    const styleId = await this.resolveStyleId(styleName);
    const { row, col } = resolveCell(address);
    const applied = await applyStyleToCell(this.ctx, this.sheetId, row, col, styleId);
    if (!applied) {
      throw new KernelError('COMPUTE_ERROR', `Failed to apply style "${styleName}"`);
    }
  }

  async applyStyleToRange(range: string | CellRange, styleName: string): Promise<void> {
    const styleId = await this.resolveStyleId(styleName);
    let cellRange: { startRow: number; startCol: number; endRow: number; endCol: number };
    if (typeof range === 'string') {
      const parsed = parseCellRange(range);
      if (!parsed) {
        throw new KernelError('API_INVALID_ADDRESS', `Invalid range: "${range}"`, {
          context: { range },
        });
      }
      cellRange = {
        startRow: parsed.startRow,
        startCol: parsed.startCol,
        endRow: parsed.endRow,
        endCol: parsed.endCol,
      };
    } else {
      cellRange = range;
    }
    const applied = await applyStyleToRange(this.ctx, this.sheetId, cellRange, styleId);
    if (!applied) {
      throw new KernelError('COMPUTE_ERROR', `Failed to apply style "${styleName}" to range`);
    }
  }

  async getStyle(a: string | number, b?: number): Promise<string | null> {
    const { row, col } = resolveCell(a, b);
    // Get the cell's current resolved format
    const cellFormat: CellFormat = await this.ctx.computeBridge.getResolvedFormat(
      this.sheetId,
      row,
      col,
    );
    // Get all styles (built-in + custom) and find a match
    const styles = await getAllStyles(this.ctx);
    for (const style of styles) {
      if (this.formatsMatch(cellFormat, style.format)) {
        return style.name;
      }
    }
    return null;
  }

  // --- Private helpers ---

  private async resolveStyleId(styleName: string): Promise<string> {
    const styles = await getAllStyles(this.ctx);
    const match = styles.find((s) => s.name === styleName);
    if (!match) {
      throw new KernelError('COMPUTE_ERROR', `Style "${styleName}" not found`);
    }
    return match.id;
  }

  /**
   * Best-effort comparison of format properties that define a style.
   * Compares key formatting properties; ignores undefined/null differences.
   */
  private formatsMatch(cellFormat: CellFormat, styleFormat: CellFormat): boolean {
    const keys: (keyof CellFormat)[] = [
      'bold',
      'italic',
      'underlineType',
      'strikethrough',
      'fontFamily',
      'fontSize',
      'fontColor',
      'backgroundColor',
      'numberFormat',
      'horizontalAlign',
      'verticalAlign',
    ];
    for (const key of keys) {
      const va = cellFormat?.[key] ?? null;
      const vb = styleFormat?.[key] ?? null;
      if (va !== vb) return false;
    }
    return true;
  }
}
