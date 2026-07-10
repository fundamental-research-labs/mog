/**
 * WorksheetLayoutImpl — Implementation of the WorksheetLayout sub-API.
 *
 * Calls computeBridge directly for all row/column dimension and visibility
 * operations.
 */

import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type { RangePixelPosition, WorksheetLayout } from '@mog-sdk/contracts/api';
import { KernelError } from '../../errors';
import { invalidCellAddress, operationFailed } from '../../errors/api';

import type { DocumentContext } from '../../context';
import {
  resolveColumnSelection,
  resolveColumnSelectionRange,
  resolveSingleColumn,
  type ResolvedColumnSelection,
} from '../internal/address-resolver';
import { assertFormatOperationsAllowed } from './protection-guards';

type WorksheetLayoutColumnSelector = number | string;

function columnsInSelection(selection: ResolvedColumnSelection): number[] {
  return Array.from(
    { length: selection.endCol - selection.startCol + 1 },
    (_, index) => selection.startCol + index,
  );
}

function selectorList(
  selectors: WorksheetLayoutColumnSelector | readonly WorksheetLayoutColumnSelector[],
): readonly WorksheetLayoutColumnSelector[] {
  return Array.isArray(selectors)
    ? (selectors as readonly WorksheetLayoutColumnSelector[])
    : [selectors as WorksheetLayoutColumnSelector];
}

function resolveColumnList(
  selectors: WorksheetLayoutColumnSelector | readonly WorksheetLayoutColumnSelector[],
): number[] {
  const resolved = new Set<number>();
  for (const selector of selectorList(selectors)) {
    for (const col of columnsInSelection(resolveColumnSelection(selector))) {
      resolved.add(col);
    }
  }
  return [...resolved];
}

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

  async getColumnWidth(col: WorksheetLayoutColumnSelector): Promise<number> {
    const resolvedCol = resolveSingleColumn(col);
    try {
      return await this.ctx.computeBridge.getColWidthQuery(this.sheetId, resolvedCol);
    } catch (e) {
      throw KernelError.from(e, 'OPERATION_FAILED', `Failed to get column width: ${String(e)}`);
    }
  }

  async setColumnWidth(col: WorksheetLayoutColumnSelector, widthPx: number): Promise<void> {
    this._ensureWritable('layout.setColumnWidth');
    const columns = columnsInSelection(resolveColumnSelection(col));
    if (!Number.isFinite(widthPx) || widthPx <= 0) {
      throw operationFailed('setColumnWidth', 'Width must be a finite number greater than 0');
    }
    try {
      await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatColumns']);
      if (columns.length === 1) {
        await this.ctx.computeBridge.setColWidth(this.sheetId, columns[0], widthPx);
      } else {
        await this.ctx.computeBridge.setColWidths(
          this.sheetId,
          columns.map((resolvedCol) => [resolvedCol, widthPx]),
        );
      }
    } catch (e) {
      throw operationFailed('setColumnWidth', String(e));
    }
  }

  async getColumnWidthChars(col: WorksheetLayoutColumnSelector): Promise<number> {
    const resolvedCol = resolveSingleColumn(col);
    try {
      return await this.ctx.computeBridge.getColWidthCharsQuery(this.sheetId, resolvedCol);
    } catch (e) {
      throw KernelError.from(
        e,
        'OPERATION_FAILED',
        `Failed to get column width (chars): ${String(e)}`,
      );
    }
  }

  async setColumnWidthChars(col: WorksheetLayoutColumnSelector, widthChars: number): Promise<void> {
    const columns = columnsInSelection(resolveColumnSelection(col));
    if (!Number.isFinite(widthChars) || widthChars <= 0) {
      throw operationFailed('setColumnWidthChars', 'Width must be a finite number greater than 0');
    }
    try {
      await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatColumns']);
      if (columns.length === 1) {
        await this.ctx.computeBridge.setColWidthChars(this.sheetId, columns[0], widthChars);
      } else {
        await this.ctx.computeBridge.setColWidthsChars(
          this.sheetId,
          columns.map((resolvedCol) => [resolvedCol, widthChars]),
        );
      }
    } catch (e) {
      throw operationFailed('setColumnWidthChars', String(e));
    }
  }

  async setColumnWidths(widths: Array<[WorksheetLayoutColumnSelector, number]>): Promise<void> {
    if (widths.length === 0) return;
    const resolvedWidths = new Map<number, number>();
    for (const [selector, widthPx] of widths) {
      const columns = columnsInSelection(resolveColumnSelection(selector));
      if (!Number.isFinite(widthPx) || widthPx <= 0) {
        throw operationFailed('setColumnWidths', 'Width must be a finite number greater than 0');
      }
      for (const col of columns) resolvedWidths.set(col, widthPx);
    }
    try {
      await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatColumns']);
      await this.ctx.computeBridge.setColWidths(this.sheetId, [...resolvedWidths]);
    } catch (e) {
      throw operationFailed('setColumnWidths', String(e));
    }
  }

  async setColumnWidthsChars(
    widths: Array<[WorksheetLayoutColumnSelector, number]>,
  ): Promise<void> {
    if (widths.length === 0) return;
    const resolvedWidths = new Map<number, number>();
    for (const [selector, widthChars] of widths) {
      const columns = columnsInSelection(resolveColumnSelection(selector));
      if (!Number.isFinite(widthChars) || widthChars <= 0) {
        throw operationFailed(
          'setColumnWidthsChars',
          'Width must be a finite number greater than 0',
        );
      }
      for (const col of columns) resolvedWidths.set(col, widthChars);
    }
    try {
      await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatColumns']);
      await this.ctx.computeBridge.setColWidthsChars(this.sheetId, [...resolvedWidths]);
    } catch (e) {
      throw operationFailed('setColumnWidthsChars', String(e));
    }
  }

  async autoFitColumn(col: WorksheetLayoutColumnSelector): Promise<void> {
    const columns = columnsInSelection(resolveColumnSelection(col));
    try {
      await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatColumns']);
      if (columns.length === 1) {
        await this.ctx.computeBridge.autoFitColumnAndSet(this.sheetId, columns[0]);
      } else {
        await this.ctx.computeBridge.autoFitColumnsAndSet(this.sheetId, columns);
      }
    } catch (e) {
      throw operationFailed('autoFitColumn', String(e));
    }
  }

  async autoFitColumns(
    cols: WorksheetLayoutColumnSelector | readonly WorksheetLayoutColumnSelector[],
  ): Promise<void> {
    if (Array.isArray(cols) && cols.length === 0) return;
    const resolvedColumns = resolveColumnList(cols);
    try {
      await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatColumns']);
      await this.ctx.computeBridge.autoFitColumnsAndSet(this.sheetId, resolvedColumns);
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

  async getColWidthsBatch(
    startCol: WorksheetLayoutColumnSelector,
    endCol?: WorksheetLayoutColumnSelector,
  ): Promise<Array<[number, number]>> {
    const resolved = resolveColumnSelectionRange(startCol, endCol);
    try {
      return await this.ctx.computeBridge.getColWidthsBatch(
        this.sheetId,
        resolved.startCol,
        resolved.endCol,
      );
    } catch (e) {
      throw KernelError.from(
        e,
        'OPERATION_FAILED',
        `Failed to get column widths batch: ${String(e)}`,
      );
    }
  }

  async getColWidthsBatchChars(
    startCol: WorksheetLayoutColumnSelector,
    endCol?: WorksheetLayoutColumnSelector,
  ): Promise<Array<[number, number]>> {
    const resolved = resolveColumnSelectionRange(startCol, endCol);
    try {
      return await this.ctx.computeBridge.getColWidthsBatchChars(
        this.sheetId,
        resolved.startCol,
        resolved.endCol,
      );
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

  async setColumnVisible(col: WorksheetLayoutColumnSelector, visible: boolean): Promise<void> {
    const columns = columnsInSelection(resolveColumnSelection(col));
    try {
      await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatColumns']);
      if (visible) {
        await this.ctx.computeBridge.unhideColumns(this.sheetId, columns);
      } else {
        await this.ctx.computeBridge.hideColumns(this.sheetId, columns);
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

  async isColumnHidden(col: WorksheetLayoutColumnSelector): Promise<boolean> {
    const resolvedCol = resolveSingleColumn(col);
    try {
      return await this.ctx.computeBridge.isColHiddenQuery(this.sheetId, resolvedCol);
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

  async unhideColumns(
    startCol: WorksheetLayoutColumnSelector,
    endCol?: WorksheetLayoutColumnSelector,
  ): Promise<void> {
    const columns = columnsInSelection(resolveColumnSelectionRange(startCol, endCol));
    try {
      await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatColumns']);
      await this.ctx.computeBridge.unhideColumns(this.sheetId, columns);
    } catch (e) {
      throw operationFailed('unhideColumns', String(e));
    }
  }

  async hideRows(rows: number[]): Promise<void> {
    if (rows.length === 0) return;
    await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatRows']);
    await this.ctx.computeBridge.hideRows(this.sheetId, rows);
  }

  async hideColumns(
    cols: WorksheetLayoutColumnSelector | readonly WorksheetLayoutColumnSelector[],
  ): Promise<void> {
    if (Array.isArray(cols) && cols.length === 0) return;
    const resolvedColumns = resolveColumnList(cols);
    await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatColumns']);
    await this.ctx.computeBridge.hideColumns(this.sheetId, resolvedColumns);
  }

  async getHiddenRowsBitmap(): Promise<Set<number>> {
    try {
      const rows = await this.ctx.computeBridge.getHiddenRows(this.sheetId);
      return new Set(rows);
    } catch {
      return new Set();
    }
  }

  async getFilterHiddenRowsBitmap(): Promise<Set<number>> {
    try {
      const rows = await this.ctx.computeBridge.getFilterHiddenRows(this.sheetId);
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

  async resetColumnWidth(col: WorksheetLayoutColumnSelector): Promise<void> {
    const columns = columnsInSelection(resolveColumnSelection(col));
    try {
      await assertFormatOperationsAllowed(this.ctx, this.sheetId, ['formatColumns']);
      const defaultWidth = await this.ctx.computeBridge.getDefaultColWidthChars(this.sheetId);
      if (columns.length === 1) {
        await this.ctx.computeBridge.setColWidthChars(this.sheetId, columns[0], defaultWidth);
      } else {
        await this.ctx.computeBridge.setColWidthsChars(
          this.sheetId,
          columns.map((resolvedCol) => [resolvedCol, defaultWidth]),
        );
      }
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

  async getColPosition(col: WorksheetLayoutColumnSelector): Promise<number> {
    const resolvedCol = resolveSingleColumn(col);
    try {
      return await this.ctx.computeBridge.getColPosition(this.sheetId, resolvedCol);
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
