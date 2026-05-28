/**
 * WorksheetLayoutImpl — Implementation of the WorksheetLayout sub-API.
 *
 * Calls computeBridge directly for all row/column dimension and visibility
 * operations.
 */

import type { CellRange } from '@mog-sdk/contracts/core';
import type { SheetId, RangePixelPosition, WorksheetLayout } from '@mog-sdk/contracts/api';
import { KernelError } from '../../errors';
import { invalidCellAddress, operationFailed } from '../../errors/api';

import type { DocumentContext } from '../../context';
import { assertFormatOperationsAllowed } from './protection-guards';

export class WorksheetLayoutImpl implements WorksheetLayout {
  constructor(
    private readonly ctx: DocumentContext,
    private readonly sheetId: SheetId,
  ) {}

  private _ensureWritable(op: string): void {
    this.ctx.writeGate.assertWritable(op);
  }

  async getRowHeight(row: number): Promise<number> {
    if (row < 0) {
      throw invalidCellAddress(row, 0);
    }
    try {
      return await this.ctx.computeBridge.getRowHeightQuery(this.sheetId, row);
    } catch (e) {
      throw KernelError.from(e, 'OPERATION_FAILED', `Failed to get row height: ${String(e)}`);
    }
  }

  async setRowHeight(row: number, height: number): Promise<void> {
    this._ensureWritable('layout.setRowHeight');
    if (row < 0) {
      throw invalidCellAddress(row, 0);
    }
    if (!Number.isFinite(height) || height <= 0) {
      throw operationFailed('setRowHeight', 'Height must be a finite number greater than 0');
    }
    try {
      await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatRows']);
      await this.ctx.computeBridge.setRowHeight(this.sheetId, row, height);
    } catch (e) {
      throw operationFailed('setRowHeight', String(e));
    }
  }

  async getColumnWidth(col: number): Promise<number> {
    if (col < 0) {
      throw invalidCellAddress(0, col);
    }
    try {
      return await this.ctx.computeBridge.getColWidthQuery(this.sheetId, col);
    } catch (e) {
      throw KernelError.from(e, 'OPERATION_FAILED', `Failed to get column width: ${String(e)}`);
    }
  }

  async setColumnWidth(col: number, widthPx: number): Promise<void> {
    this._ensureWritable('layout.setColumnWidth');
    if (col < 0) {
      throw invalidCellAddress(0, col);
    }
    if (!Number.isFinite(widthPx) || widthPx <= 0) {
      throw operationFailed('setColumnWidth', 'Width must be a finite number greater than 0');
    }
    try {
      await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatColumns']);
      await this.ctx.computeBridge.setColWidth(this.sheetId, col, widthPx);
    } catch (e) {
      throw operationFailed('setColumnWidth', String(e));
    }
  }

  async getColumnWidthChars(col: number): Promise<number> {
    if (col < 0) {
      throw invalidCellAddress(0, col);
    }
    try {
      return await this.ctx.computeBridge.getColWidthCharsQuery(this.sheetId, col);
    } catch (e) {
      throw KernelError.from(
        e,
        'OPERATION_FAILED',
        `Failed to get column width (chars): ${String(e)}`,
      );
    }
  }

  async setColumnWidthChars(col: number, widthChars: number): Promise<void> {
    if (col < 0) {
      throw invalidCellAddress(0, col);
    }
    if (!Number.isFinite(widthChars) || widthChars <= 0) {
      throw operationFailed('setColumnWidthChars', 'Width must be a finite number greater than 0');
    }
    try {
      await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatColumns']);
      await this.ctx.computeBridge.setColWidthChars(this.sheetId, col, widthChars);
    } catch (e) {
      throw operationFailed('setColumnWidthChars', String(e));
    }
  }

  async setColumnWidths(widths: Array<[number, number]>): Promise<void> {
    if (widths.length === 0) return;
    for (const [col, widthPx] of widths) {
      if (col < 0) {
        throw invalidCellAddress(0, col);
      }
      if (!Number.isFinite(widthPx) || widthPx <= 0) {
        throw operationFailed('setColumnWidths', 'Width must be a finite number greater than 0');
      }
    }
    try {
      await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatColumns']);
      await this.ctx.computeBridge.setColWidths(this.sheetId, widths);
    } catch (e) {
      throw operationFailed('setColumnWidths', String(e));
    }
  }

  async setColumnWidthsChars(widths: Array<[number, number]>): Promise<void> {
    if (widths.length === 0) return;
    for (const [col, widthChars] of widths) {
      if (col < 0) {
        throw invalidCellAddress(0, col);
      }
      if (!Number.isFinite(widthChars) || widthChars <= 0) {
        throw operationFailed(
          'setColumnWidthsChars',
          'Width must be a finite number greater than 0',
        );
      }
    }
    try {
      await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatColumns']);
      await this.ctx.computeBridge.setColWidthsChars(this.sheetId, widths);
    } catch (e) {
      throw operationFailed('setColumnWidthsChars', String(e));
    }
  }

  async autoFitColumn(col: number): Promise<void> {
    if (col < 0) {
      throw invalidCellAddress(0, col);
    }
    try {
      await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatColumns']);
      await this.ctx.computeBridge.autoFitColumnAndSet(this.sheetId, col);
    } catch (e) {
      throw operationFailed('autoFitColumn', String(e));
    }
  }

  async autoFitColumns(cols: number[]): Promise<void> {
    if (cols.length === 0) return;
    try {
      await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatColumns']);
      await this.ctx.computeBridge.autoFitColumnsAndSet(this.sheetId, cols);
    } catch (e) {
      throw operationFailed('autoFitColumns', String(e));
    }
  }

  async autoFitRow(row: number): Promise<void> {
    if (row < 0) {
      throw invalidCellAddress(row, 0);
    }
    try {
      await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatRows']);
      await this.ctx.computeBridge.autoFitRowsAndSet(this.sheetId, [row]);
    } catch (e) {
      throw operationFailed('autoFitRow', String(e));
    }
  }

  async autoFitRows(rows: number[]): Promise<void> {
    if (rows.length === 0) return;
    try {
      await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatRows']);
      await this.ctx.computeBridge.autoFitRowsAndSet(this.sheetId, rows);
    } catch (e) {
      throw operationFailed('autoFitRows', String(e));
    }
  }

  async getRowHeightsBatch(startRow: number, endRow: number): Promise<Array<[number, number]>> {
    try {
      return await this.ctx.computeBridge.getRowHeightsBatch(this.sheetId, startRow, endRow);
    } catch (e) {
      throw KernelError.from(
        e,
        'OPERATION_FAILED',
        `Failed to get row heights batch: ${String(e)}`,
      );
    }
  }

  async getColWidthsBatch(startCol: number, endCol: number): Promise<Array<[number, number]>> {
    try {
      return await this.ctx.computeBridge.getColWidthsBatch(this.sheetId, startCol, endCol);
    } catch (e) {
      throw KernelError.from(
        e,
        'OPERATION_FAILED',
        `Failed to get column widths batch: ${String(e)}`,
      );
    }
  }

  async getColWidthsBatchChars(startCol: number, endCol: number): Promise<Array<[number, number]>> {
    try {
      return await this.ctx.computeBridge.getColWidthsBatchChars(this.sheetId, startCol, endCol);
    } catch (e) {
      throw KernelError.from(
        e,
        'OPERATION_FAILED',
        `Failed to get column widths batch (chars): ${String(e)}`,
      );
    }
  }

  async setRowVisible(row: number, visible: boolean): Promise<void> {
    if (row < 0) {
      throw invalidCellAddress(row, 0);
    }
    try {
      await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatRows']);
      if (visible) {
        await this.ctx.computeBridge.unhideRows(this.sheetId, [row]);
      } else {
        await this.ctx.computeBridge.hideRows(this.sheetId, [row]);
      }
    } catch (e) {
      throw operationFailed('setRowVisible', String(e));
    }
  }

  async setColumnVisible(col: number, visible: boolean): Promise<void> {
    if (col < 0) {
      throw invalidCellAddress(0, col);
    }
    try {
      await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatColumns']);
      if (visible) {
        await this.ctx.computeBridge.unhideColumns(this.sheetId, [col]);
      } else {
        await this.ctx.computeBridge.hideColumns(this.sheetId, [col]);
      }
    } catch (e) {
      throw operationFailed('setColumnVisible', String(e));
    }
  }

  async isRowHidden(row: number): Promise<boolean> {
    if (row < 0) {
      throw invalidCellAddress(row, 0);
    }
    try {
      return await this.ctx.computeBridge.isRowHiddenQuery(this.sheetId, row);
    } catch (e) {
      throw KernelError.from(e, 'OPERATION_FAILED', `Failed to check row visibility: ${String(e)}`);
    }
  }

  async isColumnHidden(col: number): Promise<boolean> {
    if (col < 0) {
      throw invalidCellAddress(0, col);
    }
    try {
      return await this.ctx.computeBridge.isColHiddenQuery(this.sheetId, col);
    } catch (e) {
      throw KernelError.from(
        e,
        'OPERATION_FAILED',
        `Failed to check column visibility: ${String(e)}`,
      );
    }
  }

  async unhideRows(startRow: number, endRow: number): Promise<void> {
    if (startRow < 0 || endRow < startRow) {
      throw operationFailed('unhideRows', 'Invalid row range');
    }
    try {
      await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatRows']);
      const rows = Array.from({ length: endRow - startRow + 1 }, (_, i) => startRow + i);
      await this.ctx.computeBridge.unhideRows(this.sheetId, rows);
    } catch (e) {
      throw operationFailed('unhideRows', String(e));
    }
  }

  async unhideColumns(startCol: number, endCol: number): Promise<void> {
    if (startCol < 0 || endCol < startCol) {
      throw operationFailed('unhideColumns', 'Invalid column range');
    }
    try {
      await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatColumns']);
      const cols = Array.from({ length: endCol - startCol + 1 }, (_, i) => startCol + i);
      await this.ctx.computeBridge.unhideColumns(this.sheetId, cols);
    } catch (e) {
      throw operationFailed('unhideColumns', String(e));
    }
  }

  async hideRows(rows: number[]): Promise<void> {
    if (rows.length === 0) return;
    await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatRows']);
    await this.ctx.computeBridge.hideRows(this.sheetId, rows);
  }

  async hideColumns(cols: number[]): Promise<void> {
    if (cols.length === 0) return;
    await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatColumns']);
    await this.ctx.computeBridge.hideColumns(this.sheetId, cols);
  }

  async getHiddenRowsBitmap(): Promise<Set<number>> {
    try {
      const rows = await this.ctx.computeBridge.getHiddenRows(this.sheetId);
      return new Set(rows);
    } catch {
      return new Set();
    }
  }

  async getHiddenColumnsBitmap(): Promise<Set<number>> {
    try {
      const cols = await this.ctx.computeBridge.getHiddenColumns(this.sheetId);
      return new Set(cols);
    } catch {
      return new Set();
    }
  }

  async resetRowHeight(row: number): Promise<void> {
    if (row < 0) {
      throw invalidCellAddress(row, 0);
    }
    try {
      await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatRows']);
      const defaultHeight = await this.ctx.computeBridge.getDefaultRowHeight(this.sheetId);
      await this.ctx.computeBridge.setRowHeight(this.sheetId, row, defaultHeight);
    } catch (e) {
      throw operationFailed('resetRowHeight', String(e));
    }
  }

  async resetColumnWidth(col: number): Promise<void> {
    if (col < 0) {
      throw invalidCellAddress(0, col);
    }
    try {
      await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatColumns']);
      const defaultWidth = await this.ctx.computeBridge.getDefaultColWidthChars(this.sheetId);
      await this.ctx.computeBridge.setColWidthChars(this.sheetId, col, defaultWidth);
    } catch (e) {
      throw operationFailed('resetColumnWidth', String(e));
    }
  }

  async getRowPosition(row: number): Promise<number> {
    if (row < 0) {
      throw invalidCellAddress(row, 0);
    }
    try {
      return await this.ctx.computeBridge.getRowPosition(this.sheetId, row);
    } catch (e) {
      throw KernelError.from(e, 'OPERATION_FAILED', `Failed to get row position: ${String(e)}`);
    }
  }

  async getColPosition(col: number): Promise<number> {
    if (col < 0) {
      throw invalidCellAddress(0, col);
    }
    try {
      return await this.ctx.computeBridge.getColPosition(this.sheetId, col);
    } catch (e) {
      throw KernelError.from(e, 'OPERATION_FAILED', `Failed to get column position: ${String(e)}`);
    }
  }

  async getRangePosition(range: CellRange): Promise<RangePixelPosition> {
    const { startRow, startCol, endRow, endCol } = range;
    if (startRow < 0 || startCol < 0) {
      throw invalidCellAddress(startRow, startCol);
    }
    try {
      const [top, left, bottomEdge, rightEdge] = await Promise.all([
        this.ctx.computeBridge.getRowPosition(this.sheetId, startRow),
        this.ctx.computeBridge.getColPosition(this.sheetId, startCol),
        this.ctx.computeBridge.getRowPosition(this.sheetId, endRow + 1),
        this.ctx.computeBridge.getColPosition(this.sheetId, endCol + 1),
      ]);
      return {
        top,
        left,
        height: bottomEdge - top,
        width: rightEdge - left,
      };
    } catch (e) {
      throw KernelError.from(e, 'OPERATION_FAILED', `Failed to get range position: ${String(e)}`);
    }
  }
}
