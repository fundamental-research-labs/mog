/**
 * Clipboard Serializers
 *
 * Functions for converting between internal clipboard format and external representations.
 * - TSV: Tab-separated values (plain text, universal)
 * - HTML: Rich table format (preserves formatting in Excel/Sheets)
 *
 */

import type { CellFormat, CellValue } from '@mog-sdk/contracts/core';
import { clipboardCellValueToText } from './cell-value-contract';

// =============================================================================
// TSV Serialization (Tab-Separated Values)
// =============================================================================

/**
 * Convert a 2D array of cell values to TSV (tab-separated values) string.
 * Used for system clipboard plain text.
 *
 * @param values - 2D array of cell values [row][col]
 * @returns TSV string with rows separated by newlines, columns by tabs
 */
export function cellsToTSV(values: CellValue[][]): string {
  return values
    .map((row) =>
      row
        .map((value) => {
          const str = clipboardCellValueToText(value);
          // Escape tabs, newlines, and quotes
          if (str.includes('\t') || str.includes('\n') || str.includes('"')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        })
        .join('\t'),
    )
    .join('\n');
}

/**
 * Parse TSV string into 2D array of cell values.
 * Used for parsing external paste from system clipboard.
 *
 * @param text - TSV string from clipboard
 * @returns Parsed cells with dimensions
 */
export function tsvToCells(text: string): {
  values: CellValue[][];
  rowCount: number;
  colCount: number;
} {
  if (!text || text.trim() === '') {
    return { values: [], rowCount: 0, colCount: 0 };
  }

  const rows: CellValue[][] = [];
  let maxCols = 0;

  // Split by newlines, handling both \n and \r\n
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    // Skip trailing empty line
    if (line === '' && rows.length > 0) {
      continue;
    }

    const row: CellValue[] = [];
    let i = 0;

    while (i < line.length || (i === 0 && line.length === 0)) {
      if (i >= line.length) {
        // Empty final cell
        row.push(null);
        break;
      }

      if (line[i] === '"') {
        // Quoted field
        let value = '';
        i++; // Skip opening quote

        while (i < line.length) {
          if (line[i] === '"') {
            if (i + 1 < line.length && line[i + 1] === '"') {
              // Escaped quote
              value += '"';
              i += 2;
            } else {
              // End of quoted field
              i++; // Skip closing quote
              break;
            }
          } else {
            value += line[i];
            i++;
          }
        }

        row.push(inferValue(value));

        // Skip tab separator
        if (i < line.length && line[i] === '\t') {
          i++;
        }
      } else {
        // Unquoted field - read until tab or end
        let value = '';
        while (i < line.length && line[i] !== '\t') {
          value += line[i];
          i++;
        }
        row.push(inferValue(value));

        // Skip tab separator
        if (i < line.length && line[i] === '\t') {
          i++;
          // If this is the last character, we have an empty final cell
          if (i === line.length) {
            row.push(null);
          }
        }
      }
    }

    rows.push(row);
    maxCols = Math.max(maxCols, row.length);
  }

  // Normalize all rows to same column count
  for (const row of rows) {
    while (row.length < maxCols) {
      row.push(null);
    }
  }

  return {
    values: rows,
    rowCount: rows.length,
    colCount: maxCols,
  };
}

// =============================================================================
// HTML Serialization
// =============================================================================

/**
 * Convert a 2D array of cell values to HTML table.
 * Used for system clipboard rich format (better paste into Excel/Sheets).
 *
 * @param values - 2D array of cell values [row][col]
 * @param formats - Optional 2D array of cell formats matching values
 * @returns HTML table string
 */
export function cellsToHTML(
  values: CellValue[][],
  formats?: (Partial<CellFormat> | null)[][],
): string {
  if (values.length === 0) {
    return '<table></table>';
  }

  const rows = values.map((row, rowIndex) => {
    const cells = row.map((value, colIndex) => {
      const format = formats?.[rowIndex]?.[colIndex];
      const style = formatToInlineStyle(format);
      const content = escapeHTML(formatValueForHTML(value));

      if (style) {
        return `<td style="${style}">${content}</td>`;
      }
      return `<td>${content}</td>`;
    });
    return `<tr>${cells.join('')}</tr>`;
  });

  return `<table>${rows.join('')}</table>`;
}

/**
 * Parse HTML table into 2D array of cell values.
 * Used for parsing rich content from system clipboard.
 *
 * @param html - HTML string from clipboard
 * @returns Parsed cells with dimensions, or null if not a valid table
 */
export function htmlToCells(html: string): {
  values: CellValue[][];
  formats?: (Partial<CellFormat> | null)[][];
  rowCount: number;
  colCount: number;
} | null {
  // Parse HTML using DOMParser
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Find the first table
  const table = doc.querySelector('table');
  if (!table) {
    return null;
  }

  const values: CellValue[][] = [];
  const formats: (Partial<CellFormat> | null)[][] = [];
  let maxCols = 0;

  // Get all rows (both in tbody and direct children)
  const rows = table.querySelectorAll('tr');

  for (const tr of rows) {
    const rowValues: CellValue[] = [];
    const rowFormats: (Partial<CellFormat> | null)[] = [];

    const cells = tr.querySelectorAll('td, th');

    for (const cell of cells) {
      // Get colspan for handling merged cells
      const colspan = parseInt(cell.getAttribute('colspan') || '1', 10);

      // Extract text content
      const text = cell.textContent?.trim() ?? '';
      const value = inferValue(text);

      // Extract format from style attribute
      const format = parseInlineStyle(cell.getAttribute('style'));

      // Add value (and empty cells for colspan)
      for (let i = 0; i < colspan; i++) {
        rowValues.push(i === 0 ? value : null);
        rowFormats.push(i === 0 ? format : null);
      }
    }

    values.push(rowValues);
    formats.push(rowFormats);
    maxCols = Math.max(maxCols, rowValues.length);
  }

  // Normalize all rows to same column count
  for (let i = 0; i < values.length; i++) {
    while (values[i].length < maxCols) {
      values[i].push(null);
      formats[i].push(null);
    }
  }

  // Check if we have any non-null formats
  const hasFormats = formats.some((row) => row.some((f) => f !== null));

  return {
    values,
    formats: hasFormats ? formats : undefined,
    rowCount: values.length,
    colCount: maxCols,
  };
}

// =============================================================================
// Value Inference
// =============================================================================

/**
 * Infer the type of a string value and convert to appropriate CellValue.
 * Used when parsing external clipboard data.
 *
 * @param raw - Raw string value
 * @returns Inferred CellValue (number, boolean, date string, or string)
 */
export function inferValue(raw: string): CellValue {
  const trimmed = raw.trim();

  // Empty string -> null
  if (trimmed === '') {
    return null;
  }

  // Boolean values
  if (trimmed.toUpperCase() === 'TRUE') {
    return true;
  }
  if (trimmed.toUpperCase() === 'FALSE') {
    return false;
  }

  // Number values (including negative, decimals, percentages)
  // Handle percentage
  if (trimmed.endsWith('%')) {
    const numStr = trimmed.slice(0, -1);
    const num = parseFloat(numStr);
    if (!isNaN(num)) {
      return num / 100;
    }
  }

  // Handle currency (basic support for $ and euro signs)
  const currencyMatch = trimmed.match(/^[$\u20AC\u00A3]?\s*([-+]?[\d,]+\.?\d*)\s*$/);
  if (currencyMatch) {
    const numStr = currencyMatch[1].replace(/,/g, '');
    const num = parseFloat(numStr);
    if (!isNaN(num)) {
      return num;
    }
  }

  // Standard number
  const num = parseFloat(trimmed);
  if (!isNaN(num) && isFinite(num) && trimmed === String(num)) {
    return num;
  }

  // Number with commas as thousands separator
  const numWithCommas = trimmed.replace(/,/g, '');
  if (/^-?\d+\.?\d*$/.test(numWithCommas)) {
    const parsed = parseFloat(numWithCommas);
    if (!isNaN(parsed)) {
      return parsed;
    }
  }

  // Date detection (basic ISO format or common formats)
  // Note: We don't convert to Date objects; dates are stored as strings or serials
  // This just validates it looks like a date
  const isoDatePattern = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/;
  if (isoDatePattern.test(trimmed)) {
    const date = new Date(trimmed);
    if (!isNaN(date.getTime())) {
      // Keep as string - the caller can convert to serial if needed
      return trimmed;
    }
  }

  // Common date formats: MM/DD/YYYY, DD/MM/YYYY, etc.
  const commonDatePattern = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/;
  if (commonDatePattern.test(trimmed)) {
    // Keep as string - ambiguous format
    return trimmed;
  }

  // Default: return as string
  return trimmed;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert CellFormat to inline CSS style string.
 */
function formatToInlineStyle(format: Partial<CellFormat> | null | undefined): string {
  if (!format) {
    return '';
  }

  const styles: string[] = [];

  if (format.bold) {
    styles.push('font-weight: bold');
  }
  if (format.italic) {
    styles.push('font-style: italic');
  }
  if (format.underlineType && format.underlineType !== 'none') {
    styles.push('text-decoration: underline');
  }
  if (format.strikethrough) {
    styles.push('text-decoration: line-through');
  }
  if (format.fontFamily) {
    styles.push(`font-family: "${format.fontFamily}"`);
  }
  if (format.fontSize) {
    styles.push(`font-size: ${format.fontSize}pt`);
  }
  if (format.fontColor) {
    styles.push(`color: ${format.fontColor}`);
  }
  if (format.backgroundColor) {
    styles.push(`background-color: ${format.backgroundColor}`);
  }
  if (format.horizontalAlign) {
    const textAlign =
      format.horizontalAlign === 'centerContinuous' ? 'center' : format.horizontalAlign;
    styles.push(`text-align: ${textAlign}`);
  }
  if (format.verticalAlign) {
    // Compatibility: old raw data may still contain `center`.
    const rawVerticalAlign = format.verticalAlign as string;
    const va =
      rawVerticalAlign === 'middle' || rawVerticalAlign === 'center'
        ? 'middle'
        : rawVerticalAlign === 'bottom'
          ? 'bottom'
          : 'top';
    styles.push(`vertical-align: ${va}`);
  }

  return styles.join('; ');
}

/**
 * Parse inline CSS style string to partial CellFormat.
 */
function parseInlineStyle(style: string | null): Partial<CellFormat> | null {
  if (!style) {
    return null;
  }

  const format: Partial<CellFormat> = {};
  const styles = style.split(';').map((s) => s.trim());

  for (const s of styles) {
    const [property, value] = s.split(':').map((p) => p.trim());
    if (!property || !value) continue;

    switch (property.toLowerCase()) {
      case 'font-weight':
        if (value === 'bold' || parseInt(value) >= 700) {
          format.bold = true;
        }
        break;
      case 'font-style':
        if (value === 'italic') {
          format.italic = true;
        }
        break;
      case 'text-decoration':
        if (value.includes('underline')) {
          format.underlineType = 'single';
        }
        if (value.includes('line-through')) {
          format.strikethrough = true;
        }
        break;
      case 'font-family':
        format.fontFamily = value.replace(/['"]/g, '');
        break;
      case 'font-size':
        const fontSize = parseInt(value);
        if (!isNaN(fontSize)) {
          format.fontSize = fontSize;
        }
        break;
      case 'color':
        format.fontColor = value;
        break;
      case 'background-color':
      case 'background':
        format.backgroundColor = value;
        break;
      case 'text-align':
        if (value === 'left' || value === 'center' || value === 'right') {
          format.horizontalAlign = value;
        }
        break;
      case 'vertical-align':
        if (value === 'top' || value === 'bottom') {
          format.verticalAlign = value;
        } else if (value === 'middle') {
          format.verticalAlign = 'middle';
        }
        break;
    }
  }

  // Return null if no formats were found
  return Object.keys(format).length > 0 ? format : null;
}

/**
 * Format a cell value for HTML display.
 */
function formatValueForHTML(value: CellValue): string {
  return clipboardCellValueToText(value);
}

/**
 * Escape HTML special characters.
 */
function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
