/**
 * Clipboard Utilities
 *
 * Shared clipboard parsing and formatting utilities.
 * Used by both keyboard shortcuts and native clipboard events.
 */

import type { CellFormat, CellRange, SheetId } from '@mog-sdk/contracts/core';

// =============================================================================
// HTML Parsing
// =============================================================================

/**
 * Result of parsing HTML clipboard data.
 */
export interface ParsedHTMLData {
  /** 2D array of cell text values */
  cells: string[][];
  /** 2D array of cell formats (parallel to cells array) */
  formats: (Partial<CellFormat> | undefined)[][];
}

/**
 * Parse HTML table and extract cell data with styles.
 * Used for pasting from Excel, Google Sheets, and other spreadsheet applications.
 *
 * Handles:
 * - Bold, italic, underline, strikethrough
 * - Font color and background color
 * - Text alignment
 * - Font size and family
 *
 * @param html - HTML string (typically from clipboard)
 * @returns Parsed cells and formats, or null if no table found
 */
export function parseHTML(html: string): ParsedHTMLData | null {
  // Use DOMParser for safe HTML parsing
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const table = doc.querySelector('table');

  if (!table) {
    return null;
  }

  const cells: string[][] = [];
  const formats: (Partial<CellFormat> | undefined)[][] = [];

  const rows = table.querySelectorAll('tr');
  rows.forEach((tr) => {
    const rowCells: string[] = [];
    const rowFormats: (Partial<CellFormat> | undefined)[] = [];

    const tds = tr.querySelectorAll('td, th');
    tds.forEach((td) => {
      // Extract text content
      rowCells.push(td.textContent?.trim() ?? '');

      // Extract styles from both inline style and computed styles
      const format = parseElementStyles(td as HTMLElement);
      rowFormats.push(format);
    });

    // Only add non-empty rows
    if (rowCells.length > 0) {
      cells.push(rowCells);
      formats.push(rowFormats);
    }
  });

  return { cells, formats };
}

/**
 * Parse styles from an HTML element into CellFormat.
 * Handles both inline styles and element-based formatting (e.g., <b>, <i>).
 */
function parseElementStyles(element: HTMLElement): Partial<CellFormat> | undefined {
  const format: Partial<CellFormat> = {};
  const style = element.getAttribute('style') || '';

  // Parse inline styles
  if (style) {
    const rules = style
      .split(';')
      .map((r) => r.trim())
      .filter(Boolean);

    for (const rule of rules) {
      const colonIndex = rule.indexOf(':');
      if (colonIndex === -1) continue;

      const prop = rule.substring(0, colonIndex).trim().toLowerCase();
      const value = rule.substring(colonIndex + 1).trim();

      switch (prop) {
        case 'font-weight':
          // Accept 'bold', 'bolder', or numeric weights ≥ 600.
          // Google Sheets copies bold headers as font-weight: 600, so 700
          // would miss that common case.
          if (value === 'bold' || value === 'bolder' || parseInt(value, 10) >= 600) {
            format.bold = true;
          }
          break;
        case 'font-style':
          if (value === 'italic' || value === 'oblique') {
            format.italic = true;
          }
          break;
        case 'text-decoration':
        case 'text-decoration-line':
          if (value.includes('underline')) format.underlineType = 'single';
          if (value.includes('line-through')) format.strikethrough = true;
          break;
        case 'color':
          const fontColor = normalizeColor(value);
          if (fontColor) format.fontColor = fontColor;
          break;
        case 'background-color':
        case 'background':
          // For 'background', only extract color (ignore images, gradients)
          const bgColor = normalizeColor(value);
          if (bgColor) format.backgroundColor = bgColor;
          break;
        case 'text-align':
          if (value === 'left' || value === 'center' || value === 'right' || value === 'justify') {
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
        case 'font-size': {
          const size = parseInt(value);
          if (!isNaN(size) && size > 0) format.fontSize = size;
          break;
        }
        case 'font-family': {
          // Take first font in the family list, remove quotes
          const fontFamily = value.split(',')[0].replace(/['"]/g, '').trim();
          if (fontFamily) format.fontFamily = fontFamily;
          break;
        }
      }
    }
  }

  // Check for HTML formatting elements (Excel sometimes uses these)
  // Check if element or any child contains bold/italic elements
  if (
    element.querySelector('b, strong') ||
    element.tagName === 'B' ||
    element.tagName === 'STRONG'
  ) {
    format.bold = true;
  }
  if (element.querySelector('i, em') || element.tagName === 'I' || element.tagName === 'EM') {
    format.italic = true;
  }
  if (element.querySelector('u') || element.tagName === 'U') {
    format.underlineType = 'single';
  }
  if (
    element.querySelector('s, strike, del') ||
    element.tagName === 'S' ||
    element.tagName === 'STRIKE'
  ) {
    format.strikethrough = true;
  }

  // Parse Microsoft Office (MSO) specific attributes
  // These provide more accurate formatting when pasting from Excel
  parseMsoAttributes(element, format);

  // Return undefined if no format properties were set
  return Object.keys(format).length > 0 ? format : undefined;
}

/**
 * Parse Microsoft Office specific HTML attributes (x-mso-*).
 *
 * Excel and other Office apps add these attributes to provide more accurate
 * formatting information when copying to clipboard.
 *
 * Common attributes:
 * - x-mso-font-size: Font size with more precision
 * - x-mso-font-family: Font family without CSS fallbacks
 * - x-mso-text-fill: Text color including theme colors
 * - x-mso-number-format: Original Excel number format string
 */
function parseMsoAttributes(element: HTMLElement, _format: Partial<CellFormat>): void {
  // Parse all attributes starting with 'x-mso-' or containing 'mso-'
  // Note: _format is reserved for future use when CellFormat supports number formats
  for (const attr of Array.from(element.attributes)) {
    const name = attr.name.toLowerCase();
    const _attrValue = attr.value;

    if (!_attrValue) continue;

    // Handle data-mso-* attributes (more common in newer Office versions)
    if (name.startsWith('data-mso-') || name.startsWith('x-mso-')) {
      const msoName = name.replace(/^(data-|x-)/, '').replace('mso-', '');

      switch (msoName) {
        case 'number-format':
          // Store the original Excel number format
          // Note: CellFormat may not have a direct field for this,
          // but it can be used for more accurate number parsing
          // _format.numberFormat = _attrValue; // Would need to add to CellFormat
          break;

        case 'font-kerning':
          // Font kerning - not commonly mapped
          break;
      }
    }

    // Handle inline style MSO properties (mso-*)
    // These are already parsed in the style attribute section above,
    // but may have more specific MSO versions
  }

  // Parse mso-specific properties from the style attribute
  const style = element.getAttribute('style') || '';
  if (style.includes('mso-')) {
    const rules = style
      .split(';')
      .map((r) => r.trim())
      .filter(Boolean);

    for (const rule of rules) {
      const colonIndex = rule.indexOf(':');
      if (colonIndex === -1) continue;

      const prop = rule.substring(0, colonIndex).trim().toLowerCase();
      // Note: value parsing reserved for future use when CellFormat supports these
      // const msoValue = rule.substring(colonIndex + 1).trim();

      // Only process mso-* properties
      if (!prop.startsWith('mso-')) continue;

      switch (prop) {
        case 'mso-number-format':
          // Excel number format - e.g., "mso-number-format:@" for text
          // Would extract: rule.substring(colonIndex + 1).trim()
          break;

        case 'mso-font-charset':
          // Character set hint
          break;

        case 'mso-generic-font-family':
          // Generic font family hint
          break;

        case 'mso-pattern':
          // Cell pattern/fill type - e.g., "mso-pattern:solid"
          break;
      }
    }
  }
}

/**
 * Normalize color values to hex format.
 * Handles: hex (#fff, #ffffff), rgb(), rgba(), and named colors.
 *
 * @returns Normalized hex color or undefined if invalid/transparent
 */
function normalizeColor(color: string): string | undefined {
  if (!color) return undefined;

  const trimmed = color.trim().toLowerCase();

  // Skip transparent/inherit/initial
  if (trimmed === 'transparent' || trimmed === 'inherit' || trimmed === 'initial') {
    return undefined;
  }

  // Already hex
  if (trimmed.startsWith('#')) {
    // Expand shorthand (#fff -> #ffffff)
    if (trimmed.length === 4) {
      return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
    }
    return trimmed;
  }

  // RGB format: rgb(r, g, b) or rgba(r, g, b, a)
  const rgbMatch = trimmed.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    const r = Math.min(255, parseInt(rgbMatch[1])).toString(16).padStart(2, '0');
    const g = Math.min(255, parseInt(rgbMatch[2])).toString(16).padStart(2, '0');
    const b = Math.min(255, parseInt(rgbMatch[3])).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }

  // Common named colors (subset most likely to appear in clipboard)
  const namedColors: Record<string, string> = {
    black: '#000000',
    white: '#ffffff',
    red: '#ff0000',
    green: '#008000',
    blue: '#0000ff',
    yellow: '#ffff00',
    cyan: '#00ffff',
    magenta: '#ff00ff',
    gray: '#808080',
    grey: '#808080',
    silver: '#c0c0c0',
    maroon: '#800000',
    olive: '#808000',
    navy: '#000080',
    purple: '#800080',
    teal: '#008080',
    orange: '#ffa500',
  };

  return namedColors[trimmed];
}

// =============================================================================
// Formatting Helpers
// =============================================================================

/**
 * Escape a TSV cell value following standard quoting rules.
 * Proper TSV quoting for values containing special characters.
 *
 * Values are quoted if they contain:
 * - Tab characters (\t)
 * - Newline characters (\n or \r)
 * - Double quote characters (")
 *
 * Double quotes within the value are escaped by doubling them ("").
 *
 * @param value - The cell value to escape
 * @returns The escaped/quoted value
 */
function escapeTSVValue(value: string): string {
  // Check if value needs quoting
  const needsQuoting =
    value.includes('\t') || value.includes('\n') || value.includes('\r') || value.includes('"');

  if (!needsQuoting) {
    return value;
  }

  // Escape double quotes by doubling them
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}

/**
 * Merge info for HTML export.
 */
export interface MergeInfo {
  startRow: number;
  startCol: number;
  rowSpan: number;
  colSpan: number;
}

/**
 * Options for range export functions.
 * Filter-aware copy - skip hidden rows/cols in TSV/HTML export.
 */
export interface RangeExportOptions {
  /**
   * Callback to check if a row is hidden.
   * When provided, hidden rows are skipped in the export.
   */
  isRowHidden?: (sheetId: SheetId, row: number) => boolean;
  /**
   * Callback to check if a column is hidden.
   * When provided, hidden columns are skipped in the export.
   */
  isColHidden?: (sheetId: SheetId, col: number) => boolean;
  /**
   * Callback to get merge info for a cell.
   * Returns merge info if cell is the top-left of a merge, undefined otherwise.
   */
  getMergeInfo?: (sheetId: SheetId, row: number, col: number) => MergeInfo | undefined;
}

/**
 * Export options for normal spreadsheet copy/cut.
 *
 * Normal copy serializes the selected cells exactly, including selected cells
 * from hidden rows/columns. Hidden predicates are intentionally omitted here;
 * callers that need a visible-cells-only export must opt into that explicitly.
 */
export function normalCopyRangeExportOptions(
  getMergeInfo?: RangeExportOptions['getMergeInfo'],
): RangeExportOptions {
  return getMergeInfo ? { getMergeInfo } : {};
}

/**
 * Convert range to TSV for system clipboard.
 * Uses proper quoting for values containing tabs/newlines/quotes.
 * Filter-aware copy - supports skipping hidden rows/cols via options.
 */
export function rangeToTSV(
  sheetId: SheetId,
  range: CellRange,
  getCellDisplayValue: (sheetId: SheetId, row: number, col: number) => string,
  options?: RangeExportOptions,
): string {
  const lines: string[] = [];
  const { isRowHidden, isColHidden } = options ?? {};

  for (let row = range.startRow; row <= range.endRow; row++) {
    // Skip hidden rows when copying from filtered table
    if (isRowHidden?.(sheetId, row)) {
      continue;
    }

    const cells: string[] = [];
    for (let col = range.startCol; col <= range.endCol; col++) {
      // Skip hidden columns
      if (isColHidden?.(sheetId, col)) {
        continue;
      }

      const value = getCellDisplayValue(sheetId, row, col);
      // Use proper quoting instead of replacing special characters
      const escaped = escapeTSVValue(value);
      cells.push(escaped);
    }
    lines.push(cells.join('\t'));
  }

  return lines.join('\n');
}

/**
 * Convert range to HTML table for rich clipboard.
 *
 * Added optional getHyperlink parameter to include hyperlinks in HTML output.
 * When a cell has a hyperlink, the content is wrapped in an anchor tag.
 *
 * Filter-aware copy - supports skipping hidden rows/cols via options.
 *
 * Includes colspan/rowspan attributes for merged cells when getMergeInfo
 * callback is provided in options.
 */
export function rangeToHTML(
  sheetId: SheetId,
  range: CellRange,
  getCellDisplayValue: (sheetId: SheetId, row: number, col: number) => string,
  getCellFormat: (
    sheetId: SheetId,
    row: number,
    col: number,
  ) =>
    | { bold?: boolean; italic?: boolean; fontColor?: string; backgroundColor?: string }
    | undefined,
  getHyperlink?: (sheetId: SheetId, row: number, col: number) => string | undefined,
  options?: RangeExportOptions,
): string {
  let html = '<table>';
  const { isRowHidden, isColHidden, getMergeInfo } = options ?? {};

  // Track cells that should be skipped (part of a merge but not origin)
  const cellsToSkip = new Set<string>();

  // Pre-scan for merges to build skip list
  if (getMergeInfo) {
    for (let row = range.startRow; row <= range.endRow; row++) {
      if (isRowHidden?.(sheetId, row)) continue;
      for (let col = range.startCol; col <= range.endCol; col++) {
        if (isColHidden?.(sheetId, col)) continue;
        const mergeInfo = getMergeInfo(sheetId, row, col);
        if (mergeInfo && mergeInfo.startRow === row && mergeInfo.startCol === col) {
          // This is a merge origin - mark all other cells in the merge for skipping
          for (let r = row; r < row + mergeInfo.rowSpan; r++) {
            for (let c = col; c < col + mergeInfo.colSpan; c++) {
              if (r !== row || c !== col) {
                cellsToSkip.add(`${r},${c}`);
              }
            }
          }
        }
      }
    }
  }

  for (let row = range.startRow; row <= range.endRow; row++) {
    // Skip hidden rows when copying from filtered table
    if (isRowHidden?.(sheetId, row)) {
      continue;
    }

    html += '<tr>';
    for (let col = range.startCol; col <= range.endCol; col++) {
      // Skip hidden columns
      if (isColHidden?.(sheetId, col)) {
        continue;
      }

      // Skip cells that are part of a merge but not the origin
      if (cellsToSkip.has(`${row},${col}`)) {
        continue;
      }

      const value = getCellDisplayValue(sheetId, row, col);
      const format = getCellFormat(sheetId, row, col);
      const hyperlink = getHyperlink?.(sheetId, row, col);

      // Get merge info for colspan/rowspan
      const mergeInfo = getMergeInfo?.(sheetId, row, col);
      let mergeAttrs = '';
      if (mergeInfo && mergeInfo.startRow === row && mergeInfo.startCol === col) {
        if (mergeInfo.rowSpan > 1) {
          mergeAttrs += ` rowspan="${mergeInfo.rowSpan}"`;
        }
        if (mergeInfo.colSpan > 1) {
          mergeAttrs += ` colspan="${mergeInfo.colSpan}"`;
        }
      }

      // Build style string
      const styles: string[] = [];
      if (format?.bold) styles.push('font-weight:bold');
      if (format?.italic) styles.push('font-style:italic');
      if (format?.fontColor) styles.push(`color:${format.fontColor}`);
      if (format?.backgroundColor) styles.push(`background-color:${format.backgroundColor}`);

      const style = styles.length > 0 ? ` style="${styles.join(';')}"` : '';

      // Escape HTML
      const escaped = value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

      // Wrap content in anchor tag if hyperlink is present
      let content = escaped;
      if (hyperlink) {
        const escapedHref = hyperlink.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        content = `<a href="${escapedHref}">${escaped}</a>`;
      }

      html += `<td${mergeAttrs}${style}>${content}</td>`;
    }
    html += '</tr>';
  }

  html += '</table>';
  return html;
}
