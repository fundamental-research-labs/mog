/**
 * StyleGenerator - Convert CellFormat to CSS styles
 *
 * Generates inline CSS styles from CellFormat for HTML table cells.
 * Also generates print-specific CSS for @media print.
 */

import type { BorderStyle, CellBorders, CellFormat } from '@mog-sdk/contracts/core';
import type { HeaderVisibility } from '@mog-sdk/contracts/rendering';
import { getEffectiveHeaderDimensions } from '@mog/spreadsheet-utils/rendering/constants';
import type { PrintOptions } from '../contracts/types';

// ============================================================================
// Types
// ============================================================================

/**
 * CSS style object (subset of CSSStyleDeclaration)
 */
export interface CSSStyles {
  [key: string]: string;
}

// ============================================================================
// StyleGenerator
// ============================================================================

export class StyleGenerator {
  /**
   * Convert CellFormat to inline CSS styles
   */
  formatToStyles(format: CellFormat | undefined): CSSStyles {
    if (!format) {
      return {};
    }

    const styles: CSSStyles = {};

    // Font family
    if (format.fontFamily) {
      styles['font-family'] = this.escapeFontFamily(format.fontFamily);
    }

    // Font size
    if (format.fontSize !== undefined) {
      styles['font-size'] = `${format.fontSize}pt`;
    }

    // Font color
    if (format.fontColor) {
      styles['color'] = this.normalizeColor(format.fontColor);
    }

    // Bold
    if (format.bold) {
      styles['font-weight'] = 'bold';
    }

    // Italic
    if (format.italic) {
      styles['font-style'] = 'italic';
    }

    // Underline and strikethrough
    const textDecorations: string[] = [];
    if (format.underlineType) {
      textDecorations.push('underline');
    }
    if (format.strikethrough) {
      textDecorations.push('line-through');
    }
    if (textDecorations.length > 0) {
      styles['text-decoration'] = textDecorations.join(' ');
    }

    // Background color
    if (format.backgroundColor) {
      styles['background-color'] = this.normalizeColor(format.backgroundColor);
    }

    // Horizontal alignment
    if (format.horizontalAlign) {
      styles['text-align'] =
        format.horizontalAlign === 'centerContinuous' ? 'center' : format.horizontalAlign;
    }

    // Vertical alignment
    if (format.verticalAlign) {
      styles['vertical-align'] = format.verticalAlign;
    }

    // Text wrap - only set if explicitly defined
    if (format.wrapText === true) {
      styles['white-space'] = 'pre-wrap';
      styles['word-wrap'] = 'break-word';
    } else if (format.wrapText === false) {
      styles['white-space'] = 'nowrap';
      styles['overflow'] = 'hidden';
      styles['text-overflow'] = 'ellipsis';
    }

    // Text rotation (limited support in CSS)
    if (format.textRotation !== undefined && format.textRotation !== 0) {
      styles['writing-mode'] = 'vertical-lr';
      styles['transform'] = `rotate(${format.textRotation}deg)`;
    }

    // Indent
    if (format.indent !== undefined && format.indent > 0) {
      styles['padding-left'] = `${format.indent * 8}px`;
    }

    return styles;
  }

  /**
   * Convert CellBorders to inline CSS styles
   */
  bordersToStyles(borders: CellBorders | undefined): CSSStyles {
    if (!borders) {
      return {};
    }

    const styles: CSSStyles = {};

    if (borders.top) {
      styles['border-top'] = this.borderToCss(borders.top);
    }
    if (borders.right) {
      styles['border-right'] = this.borderToCss(borders.right);
    }
    if (borders.bottom) {
      styles['border-bottom'] = this.borderToCss(borders.bottom);
    }
    if (borders.left) {
      styles['border-left'] = this.borderToCss(borders.left);
    }

    return styles;
  }

  /**
   * Convert BorderStyle to CSS border string
   */
  borderToCss(border: BorderStyle): string {
    if (border.style === 'none') {
      return 'none';
    }

    const width = this.borderStyleToWidth(border.style);
    const style = this.borderStyleToCssStyle(border.style);
    const color = border.color ? this.normalizeColor(border.color) : '#000000';

    return `${width} ${style} ${color}`;
  }

  /**
   * Convert border style to CSS width
   */
  private borderStyleToWidth(style: BorderStyle['style']): string {
    switch (style) {
      case 'thin':
        return '1px';
      case 'medium':
        return '2px';
      case 'thick':
        return '3px';
      case 'dashed':
      case 'dotted':
        return '1px';
      case 'double':
        return '3px';
      default:
        return '1px';
    }
  }

  /**
   * Convert border style to CSS style
   */
  private borderStyleToCssStyle(style: BorderStyle['style']): string {
    switch (style) {
      case 'thin':
      case 'medium':
      case 'thick':
        return 'solid';
      case 'dashed':
        return 'dashed';
      case 'dotted':
        return 'dotted';
      case 'double':
        return 'double';
      default:
        return 'solid';
    }
  }

  /**
   * Convert styles object to inline style string
   */
  stylesToString(styles: CSSStyles): string {
    return Object.entries(styles)
      .map(([key, value]) => `${key}: ${value}`)
      .join('; ');
  }

  /**
   * Combine format and border styles
   */
  cellToStyles(format?: CellFormat, borders?: CellBorders): CSSStyles {
    return {
      ...this.formatToStyles(format),
      ...this.bordersToStyles(borders),
    };
  }

  /**
   * Generate print-specific CSS stylesheet
   * @param options - Print options
   * @param headerVisibility - Optional header visibility configuration for dynamic dimensions
   */
  generatePrintStylesheet(options: PrintOptions, headerVisibility?: HeaderVisibility): string {
    const css: string[] = [];

    // Base table styles
    css.push(`
      .print-table {
        border-collapse: collapse;
        table-layout: fixed;
        font-family: Arial, sans-serif;
        font-size: 10pt;
      }
      .print-table td,
      .print-table th {
        padding: 2px 4px;
        vertical-align: middle;
        box-sizing: border-box;
      }
    `);

    // Gridlines
    if (options.showGridlines) {
      css.push(`
        .print-table td,
        .print-table th {
          border: 1px solid #d0d0d0;
        }
      `);
    } else {
      css.push(`
        .print-table td,
        .print-table th {
          border: none;
        }
      `);
    }

    // Headers (row/column)
    if (options.showHeaders) {
      // Get effective header dimensions (dynamic based on visibility settings)
      const { rowHeaderWidth, colHeaderHeight } = getEffectiveHeaderDimensions(
        headerVisibility ?? {
          showRowHeaders: options.showHeaders,
          showColumnHeaders: options.showHeaders,
        },
      );

      css.push(`
        .print-table .row-header,
        .print-table .col-header {
          background-color: #f0f0f0;
          font-weight: bold;
          text-align: center;
          color: #333;
        }
        .print-table .row-header {
          width: ${rowHeaderWidth}px;
          min-width: ${rowHeaderWidth}px;
        }
        .print-table .col-header {
          height: ${colHeaderHeight}px;
        }
      `);
    }

    // Table header styles for repeating headers
    if (options.repeatTableHeaders) {
      css.push(`
        .print-table thead {
          display: table-header-group;
        }
        .print-table .table-header-row th,
        .print-table .table-header-row td {
          font-weight: bold;
        }
      `);
    }

    // Print media styles
    css.push(`
      @media print {
        @page {
          size: ${this.getPaperSizeCss(options)};
          margin: ${options.margins.top}in ${options.margins.right}in ${options.margins.bottom}in ${options.margins.left}in;
        }
        body {
          margin: 0;
          padding: 0;
        }
        .print-table {
          width: 100%;
        }
        .no-print {
          display: none !important;
        }
        /* Ensure thead repeats on each printed page */
        .print-table thead {
          display: table-header-group;
        }
        .print-table tbody {
          display: table-row-group;
        }
        .print-table tr {
          page-break-inside: avoid;
        }
      }
    `);

    // Scale
    if (options.scale !== 1.0) {
      css.push(`
        .print-table {
          transform: scale(${options.scale});
          transform-origin: top left;
        }
      `);
    }

    return css.join('\n');
  }

  /**
   * Get CSS page size string
   */
  private getPaperSizeCss(options: PrintOptions): string {
    const orientation = options.orientation;

    if (options.paperSize === 'custom' && options.customSize) {
      return `${options.customSize.width}in ${options.customSize.height}in`;
    }

    // Standard paper sizes
    const sizeMap: Record<string, string> = {
      letter: 'letter',
      legal: 'legal',
      a4: 'A4',
      a3: 'A3',
    };

    const size = sizeMap[options.paperSize] || 'letter';
    return `${size} ${orientation}`;
  }

  /**
   * Normalize color value to standard format
   * Supports: #RGB, #RRGGBB, #AARRGGBB, rgb(), rgba(), named colors
   */
  normalizeColor(color: string): string {
    if (!color) {
      return 'transparent';
    }

    // Already a valid CSS color
    if (color.startsWith('rgb') || color.startsWith('hsl') || !color.startsWith('#')) {
      return color;
    }

    // Handle hex colors
    const hex = color.replace('#', '');

    // #RGB -> #RRGGBB
    if (hex.length === 3) {
      const [r, g, b] = hex.split('');
      return `#${r}${r}${g}${g}${b}${b}`;
    }

    // #RRGGBB -> return as-is
    if (hex.length === 6) {
      return `#${hex}`;
    }

    // #AARRGGBB (Excel format) -> rgba()
    if (hex.length === 8) {
      const a = parseInt(hex.slice(0, 2), 16) / 255;
      const r = parseInt(hex.slice(2, 4), 16);
      const g = parseInt(hex.slice(4, 6), 16);
      const b = parseInt(hex.slice(6, 8), 16);
      return `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
    }

    // Unknown format, return as-is
    return color;
  }

  /**
   * Escape font family for CSS
   */
  private escapeFontFamily(fontFamily: string): string {
    // If font family contains spaces, wrap in quotes
    if (fontFamily.includes(' ') && !fontFamily.includes('"') && !fontFamily.includes("'")) {
      return `"${fontFamily}"`;
    }
    return fontFamily;
  }

  /**
   * Generate default cell styles
   */
  getDefaultCellStyles(): CSSStyles {
    return {
      'font-family': 'Arial, sans-serif',
      'font-size': '10pt',
      'vertical-align': 'middle',
      'white-space': 'nowrap',
      overflow: 'hidden',
      'text-overflow': 'ellipsis',
    };
  }
}

/**
 * Singleton instance
 */
export const styleGenerator = new StyleGenerator();
