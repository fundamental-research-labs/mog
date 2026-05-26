/**
 * ViewportTableDataProvider
 *
 * Adapter that wraps ViewportReader to implement ITableDataProvider interface.
 * Used by PaginationEngine to compute automatic page breaks for print preview.
 *
 * Key responsibilities:
 * - Convert ViewportCellData to CellData format (ITableDataProvider contract)
 * - Provide dimension and sheet metadata for page calculations
 * - Handle RichText conversion to plain text for printing
 *
 * @see ITableDataProvider - Print/export interface
 * @see 15-PRINT-EXPORT Page Break Visualization
 * Uses ViewportReader (Worksheet API)
 */

import type { ITableDataProvider } from '@mog/print-export';
import type { ViewportReader } from '@mog-sdk/contracts/api';
import type { FormulaA1 } from '@mog-sdk/contracts/cells';
import type { CellData, CellValue } from '@mog-sdk/contracts/core';
import { isRichText, toPlainText } from '@mog/spreadsheet-utils/rich-text';

/**
 * Adapter that wraps ViewportReader to implement ITableDataProvider interface.
 * Used by PaginationEngine to compute automatic page breaks.
 * 15-PRINT-EXPORT: Page Break Visualization
 *
 * Uses ViewportReader for sync cell data reads (ITableDataProvider must be sync).
 */
export class ViewportTableDataProvider implements ITableDataProvider {
  private viewport: ViewportReader;
  private sheetId: string;

  constructor(viewport: ViewportReader, sheetId: string) {
    this.viewport = viewport;
    this.sheetId = sheetId;
  }

  getCellData(_sheetId: string, row: number, col: number): CellData | undefined {
    // Use ViewportReader for sync cell data reads
    const vpData = this.viewport.getCellData(row, col);
    if (!vpData) return undefined;

    // Use typed value directly from viewport (number/string/boolean/CellError/null)
    let value: CellValue = vpData.value;
    // Convert RichText to plain text for CellData.value
    if (isRichText(value)) {
      value = toPlainText(value);
    }

    return {
      value,
      formula: vpData.editText as FormulaA1 | undefined,
      format: vpData.format ?? undefined,
      hyperlink: vpData.hyperlinkUrl,
    };
  }

  getCellsInRange(
    sheetId: string,
    range: { startRow: number; startCol: number; endRow: number; endCol: number },
  ): Array<{ row: number; col: number; data: CellData }> {
    const result: Array<{ row: number; col: number; data: CellData }> = [];
    for (let row = range.startRow; row <= range.endRow; row++) {
      for (let col = range.startCol; col <= range.endCol; col++) {
        const data = this.getCellData(sheetId, row, col);
        if (data) {
          result.push({ row, col, data });
        }
      }
    }
    return result;
  }

  getUsedRange(
    _sheetId: string,
  ): { startRow: number; startCol: number; endRow: number; endCol: number } | undefined {
    // Use ViewportReader bounds as an approximation of used range
    const bounds = this.viewport.getBounds();
    if (bounds) return bounds;
    return undefined;
  }

  getColumnWidth(_sheetId: string, col: number): number {
    const dim = this.viewport.getColDimension(col);
    return dim?.width ?? 64; // default column width
  }

  getRowHeight(_sheetId: string, row: number): number {
    const dim = this.viewport.getRowDimension(row);
    return dim?.height ?? 20; // default row height
  }

  getSheetName(_sheetId: string): string {
    // Use the sheetId stored at construction time as fallback name
    return this.sheetId;
  }
}
