/**
 * TableGenerator - Generate HTML tables from spreadsheet data
 *
 * Creates HTML <table> elements from cell data with proper formatting.
 */

import type { CellData, CellError, CellValue, ErrorVariant } from '@mog-sdk/contracts/core';
import { errorDisplayString } from '@mog/spreadsheet-utils/errors';
import type { HeaderVisibility } from '@mog-sdk/contracts/rendering';
import { getEffectiveHeaderDimensions } from '@mog/spreadsheet-utils/rendering/constants';
import type { PrintOptions, PrintRange } from '../contracts/types';
import { StyleGenerator, styleGenerator, type CSSStyles } from './style-generator';

// ============================================================================
// Types
// ============================================================================

/**
 * Data provider interface for TableGenerator
 * Abstracts the source of cell data (e.g., Yjs store, mock data)
 */
export interface ITableDataProvider {
  /** Get cell data at specific position */
  getCellData(
    sheetId: string,
    row: number,
    col: number,
  ): CellData | undefined | Promise<CellData | undefined>;

  /** Get all non-empty cells in a range */
  getCellsInRange(
    sheetId: string,
    range: PrintRange,
  ):
    | Array<{ row: number; col: number; data: CellData }>
    | Promise<Array<{ row: number; col: number; data: CellData }>>;

  /** Get the used range (bounding box of all non-empty cells) */
  getUsedRange(sheetId: string): PrintRange | undefined | Promise<PrintRange | undefined>;

  /** Get column width in pixels */
  getColumnWidth(sheetId: string, col: number): number;

  /** Get row height in pixels */
  getRowHeight(sheetId: string, row: number): number;

  /** Get sheet name */
  getSheetName(sheetId: string): string | Promise<string>;

  getMergedRegions?(sheetId: string): PrintRange[];

  isRowHidden?(sheetId: string, row: number): boolean;

  isColHidden?(sheetId: string, col: number): boolean;
}

/**
 * Table header information for repeating headers.
 */
export interface TableHeaderInfo {
  /** Table ID */
  tableId: string;
  /** Table name */
  tableName: string;
  /** Header row index (absolute) */
  headerRow: number;
  /** Column range of the table */
  startCol: number;
  endCol: number;
}

/**
 * Options for table generation
 */
export interface TableGeneratorOptions {
  /** Sheet ID to generate table for */
  sheetId: string;

  /** Range to include (defaults to used range) */
  range?: PrintRange;

  /** Print options */
  printOptions: PrintOptions;

  /** Include column widths as inline styles */
  includeColumnWidths?: boolean;

  /** Include row heights as inline styles */
  includeRowHeights?: boolean;

  /**
   * Table headers to repeat on each page.
   * When provided and printOptions.repeatTableHeaders is true,
   * these header rows will be repeated at the start of each page.
   */
  tableHeaders?: TableHeaderInfo[];

  /**
   * Header visibility configuration for dynamic header dimensions.
   * Controls whether row/column headers are visible and their dimensions.
   * If not provided, defaults to using showHeaders from printOptions.
   */
  headerVisibility?: HeaderVisibility;
}

/**
 * Result of table generation
 */
export interface TableGeneratorResult {
  /** Generated HTML */
  html: string;

  /** Generated CSS (for <style> tag) */
  css: string;

  /** Statistics */
  stats: {
    rows: number;
    cols: number;
    cellsWithContent: number;
    cellsWithFormatting: number;
  };
}

// ============================================================================
// TableGenerator
// ============================================================================

export class TableGenerator {
  private styleGen: StyleGenerator;

  constructor(styleGen: StyleGenerator = styleGenerator) {
    this.styleGen = styleGen;
  }

  /**
   * Generate HTML table from data provider
   */
  async generate(
    dataProvider: ITableDataProvider,
    options: TableGeneratorOptions,
  ): Promise<TableGeneratorResult> {
    const { sheetId, printOptions } = options;

    // Determine range to export
    const range = options.range ?? (await dataProvider.getUsedRange(sheetId));

    if (!range) {
      return {
        html: '<table class="print-table"><tbody><tr><td></td></tr></tbody></table>',
        css: this.styleGen.generatePrintStylesheet(printOptions, options.headerVisibility),
        stats: { rows: 0, cols: 0, cellsWithContent: 0, cellsWithFormatting: 0 },
      };
    }

    // Build cell map for efficient lookup
    const cells = await dataProvider.getCellsInRange(sheetId, range);
    const cellMap = new Map<string, CellData>();
    for (const cell of cells) {
      cellMap.set(`${cell.row},${cell.col}`, cell.data);
    }

    // Stats tracking
    let cellsWithContent = 0;
    let cellsWithFormatting = 0;

    // Generate HTML parts
    const htmlParts: string[] = [];
    htmlParts.push('<table class="print-table">');

    // Column widths
    if (options.includeColumnWidths !== false) {
      htmlParts.push('<colgroup>');
      if (printOptions.showHeaders) {
        // Get effective header dimensions (dynamic based on visibility settings)
        const { rowHeaderWidth } = getEffectiveHeaderDimensions(
          options.headerVisibility ?? {
            showRowHeaders: printOptions.showHeaders,
            showColumnHeaders: printOptions.showHeaders,
          },
        );
        if (rowHeaderWidth > 0) {
          htmlParts.push(`<col style="width: ${rowHeaderWidth}px;">`); // Row header column
        }
      }
      for (let col = range.startCol; col <= range.endCol; col++) {
        const width = dataProvider.getColumnWidth(sheetId, col);
        htmlParts.push(`<col style="width: ${width}px;">`);
      }
      htmlParts.push('</colgroup>');
    }

    // Header row (A, B, C...) and/or table headers
    const shouldRepeatTableHeaders =
      options.printOptions.repeatTableHeaders &&
      options.tableHeaders &&
      options.tableHeaders.length > 0;

    // Determine which rows are table header rows
    const tableHeaderRows = new Set<number>();
    if (shouldRepeatTableHeaders && options.tableHeaders) {
      for (const header of options.tableHeaders) {
        tableHeaderRows.add(header.headerRow);
      }
    }

    // Start thead if we have column headers or repeating table headers
    if (printOptions.showHeaders || shouldRepeatTableHeaders) {
      htmlParts.push('<thead>');

      // Column headers (A, B, C...)
      if (printOptions.showHeaders) {
        htmlParts.push('<tr>');
        htmlParts.push('<th class="col-header row-header"></th>'); // Corner cell
        for (let col = range.startCol; col <= range.endCol; col++) {
          htmlParts.push(`<th class="col-header">${this.columnToLetter(col)}</th>`);
        }
        htmlParts.push('</tr>');
      }

      // Table header rows (for repeat on each printed page)
      if (shouldRepeatTableHeaders) {
        for (let row = range.startRow; row <= range.endRow; row++) {
          if (tableHeaderRows.has(row)) {
            const rowHeight =
              options.includeRowHeights !== false
                ? dataProvider.getRowHeight(sheetId, row)
                : undefined;
            const rowStyle = rowHeight ? ` style="height: ${rowHeight}px;"` : '';
            htmlParts.push(`<tr class="table-header-row"${rowStyle}>`);

            // Row header if showing
            if (printOptions.showHeaders) {
              htmlParts.push(`<th class="row-header">${row + 1}</th>`);
            }

            // Header cells
            for (let col = range.startCol; col <= range.endCol; col++) {
              const cellData = cellMap.get(`${row},${col}`);
              // Use th for header cells in thead
              const cellHtml = this.generateCell(cellData, true);
              htmlParts.push(cellHtml);
            }

            htmlParts.push('</tr>');
          }
        }
      }

      htmlParts.push('</thead>');
    }

    // Body rows (skip table header rows if they were moved to thead)
    htmlParts.push('<tbody>');
    for (let row = range.startRow; row <= range.endRow; row++) {
      // Skip rows that are already in thead as table headers
      if (shouldRepeatTableHeaders && tableHeaderRows.has(row)) {
        continue;
      }

      const rowHeight =
        options.includeRowHeights !== false ? dataProvider.getRowHeight(sheetId, row) : undefined;

      const rowStyle = rowHeight ? ` style="height: ${rowHeight}px;"` : '';
      htmlParts.push(`<tr${rowStyle}>`);

      // Row header (1, 2, 3...)
      if (printOptions.showHeaders) {
        htmlParts.push(`<td class="row-header">${row + 1}</td>`);
      }

      // Data cells
      for (let col = range.startCol; col <= range.endCol; col++) {
        const cellData = cellMap.get(`${row},${col}`);
        const cellHtml = this.generateCell(cellData);

        if (cellData?.value !== null && cellData?.value !== undefined && cellData?.value !== '') {
          cellsWithContent++;
        }
        if (cellData?.format || cellData?.borders) {
          cellsWithFormatting++;
        }

        htmlParts.push(cellHtml);
      }

      htmlParts.push('</tr>');
    }
    htmlParts.push('</tbody>');
    htmlParts.push('</table>');

    return {
      html: htmlParts.join('\n'),
      css: this.styleGen.generatePrintStylesheet(printOptions, options.headerVisibility),
      stats: {
        rows: range.endRow - range.startRow + 1,
        cols: range.endCol - range.startCol + 1,
        cellsWithContent,
        cellsWithFormatting,
      },
    };
  }

  /**
   * Generate HTML for a single cell
   * @param cellData - Cell data to render
   * @param isHeader - If true, uses <th> tag instead of <td> (for table headers in thead)
   */
  private generateCell(cellData: CellData | undefined, isHeader: boolean = false): string {
    // Combine default + format + border styles
    const styles: CSSStyles = {
      ...this.styleGen.getDefaultCellStyles(),
      ...this.styleGen.cellToStyles(cellData?.format, cellData?.borders),
    };

    const styleStr = this.styleGen.stylesToString(styles);
    const value = this.formatValue(cellData?.value);
    const escapedValue = this.escapeHtml(value);
    const tag = isHeader ? 'th' : 'td';

    return `<${tag} style="${styleStr}">${escapedValue}</${tag}>`;
  }

  /**
   * Format cell value for display
   */
  formatValue(value: CellValue | undefined): string {
    if (value === null || value === undefined) {
      return '';
    }

    // Error values
    if (this.isError(value)) {
      return errorDisplayString(value.value as ErrorVariant);
    }

    // Boolean
    if (typeof value === 'boolean') {
      return value ? 'TRUE' : 'FALSE';
    }

    // Number - format with reasonable precision
    if (typeof value === 'number') {
      // Check for integer
      if (Number.isInteger(value)) {
        return value.toString();
      }
      // Format with up to 10 decimal places, removing trailing zeros
      return parseFloat(value.toFixed(10)).toString();
    }

    // String
    return String(value);
  }

  /**
   * Check if value is a CellError
   */
  private isError(value: CellValue): value is CellError {
    return typeof value === 'object' && value !== null && 'type' in value && value.type === 'error';
  }

  /**
   * Convert column index to letter (0 -> A, 25 -> Z, 26 -> AA)
   */
  columnToLetter(col: number): string {
    let letter = '';
    let temp = col;

    while (temp >= 0) {
      letter = String.fromCharCode((temp % 26) + 65) + letter;
      temp = Math.floor(temp / 26) - 1;
    }

    return letter;
  }

  /**
   * Escape HTML special characters
   */
  escapeHtml(str: string): string {
    const escapeMap: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };

    return str.replace(/[&<>"']/g, (char) => escapeMap[char] || char);
  }

  /**
   * Generate complete HTML document for printing
   */
  async generateDocument(
    dataProvider: ITableDataProvider,
    options: TableGeneratorOptions,
  ): Promise<string> {
    const result = await this.generate(dataProvider, options);
    const sheetName = await dataProvider.getSheetName(options.sheetId);

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${this.escapeHtml(sheetName)}</title>
  <style>
${result.css}
  </style>
</head>
<body>
${result.html}
</body>
</html>`;
  }
}

/**
 * Singleton instance
 */
export const tableGenerator = new TableGenerator();
