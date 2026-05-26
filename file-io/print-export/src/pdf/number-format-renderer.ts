/**
 * Number Format Renderer -- renders cells with format-specific visual behaviors.
 *
 * Extends the basic CellRenderer with number-format-aware rendering:
 * - Color-from-format codes: [Red], [Blue], [Green], etc. override font color
 * - Accounting format: currency symbol left-aligned, number right-aligned
 * - Fraction display: integer + space + fraction, properly spaced
 * - Scientific notation: coefficient + "E+" + exponent
 *
 * This renderer is called AFTER the number format engine has produced
 * a NumberFormatResult (the formatted display string + metadata).
 * It handles the visual layout, not the format parsing.
 */

import type { FontHandle, RenderBackend } from '@mog/pdf-graphics';
import type { CellBounds, CellFormat, CellRenderData } from './cell-renderer';
import type { FontResolver } from './font-resolver';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of number format evaluation.
 * Produced by the format engine, consumed by this renderer.
 */
export interface NumberFormatResult {
  /** The formatted display string */
  displayValue: string;
  /** Color override from format code (e.g., [Red], [Blue]) */
  colorOverride?: [number, number, number];
  /** Whether this is an accounting format (needs special alignment) */
  isAccounting?: boolean;
  /** Currency symbol for accounting format left-alignment */
  currencySymbol?: string;
  /** Whether this is a fraction format */
  isFraction?: boolean;
  /** Whether this is scientific notation */
  isScientific?: boolean;
}

// ============================================================================
// Format Color Mapping
// ============================================================================

/**
 * Excel number format color codes mapped to RGB values (0-255 range).
 * These are the standard 8 colors supported in format codes like [Red].
 */
export const FORMAT_COLORS: Record<string, [number, number, number]> = {
  Red: [255, 0, 0],
  Blue: [0, 0, 255],
  Green: [0, 128, 0],
  Yellow: [255, 255, 0],
  Cyan: [0, 255, 255],
  Magenta: [255, 0, 255],
  White: [255, 255, 255],
  Black: [0, 0, 0],
};

/**
 * Parse a color name from a format code string.
 * Returns the RGB tuple if the name is recognized, undefined otherwise.
 */
export function resolveFormatColor(colorName: string): [number, number, number] | undefined {
  // Case-insensitive lookup: "red" -> "Red", "RED" -> "Red"
  const normalized = colorName.charAt(0).toUpperCase() + colorName.slice(1).toLowerCase();
  return FORMAT_COLORS[normalized];
}

// ============================================================================
// Constants
// ============================================================================

/** Default cell padding in points */
const CELL_PADDING = 2;

/** Default font size in points */
const DEFAULT_FONT_SIZE = 11;

/** Indent unit in points (one indent level = 8pt) */
const INDENT_UNIT = 8;

// ============================================================================
// NumberFormatRenderer
// ============================================================================

/**
 * Renders number-formatted cells with format-specific visual behaviors.
 *
 * This renderer handles the special layout needs of formatted numbers:
 * accounting alignment, fraction spacing, color overrides, and scientific
 * notation display.
 */
export class NumberFormatRenderer {
  constructor(
    private backend: RenderBackend,
    private fontResolver: FontResolver,
  ) {}

  /**
   * Render a number-formatted cell. This extends the basic CellRenderer
   * with format-specific visual behaviors.
   *
   * @param data - The cell's raw data (displayValue, valueType)
   * @param format - The cell's style/formatting
   * @param numberFormat - The evaluated number format result
   * @param bounds - The cell's position and size in points
   */
  renderFormattedCell(
    _data: CellRenderData,
    format: CellFormat,
    numberFormat: NumberFormatResult,
    bounds: CellBounds,
  ): void {
    this.backend.save();

    // Clip to cell bounds
    this.backend.beginPath();
    this.backend.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    this.backend.clip();

    // Render background if present
    this.renderBackground(format, bounds);

    // Determine effective text color (format color overrides cell color).
    // Colors are stored in 0-255 range; convert to 0-1 for the backend.
    const textColor = numberFormat.colorOverride ?? format.fontColor ?? [0, 0, 0];

    // Resolve font
    const font = this.fontResolver.resolve(
      format.fontFamily ?? 'Calibri',
      format.bold ?? false,
      format.italic ?? false,
    );
    const fontSize = format.fontSize ?? DEFAULT_FONT_SIZE;

    if (numberFormat.isAccounting && numberFormat.currencySymbol) {
      this.renderAccountingFormat(numberFormat, textColor, font, fontSize, format, bounds);
    } else if (numberFormat.isFraction) {
      this.renderFractionFormat(numberFormat, textColor, font, fontSize, format, bounds);
    } else if (numberFormat.isScientific) {
      this.renderScientificFormat(numberFormat, textColor, font, fontSize, format, bounds);
    } else {
      this.renderStandardFormat(numberFormat, textColor, font, fontSize, format, bounds);
    }

    this.backend.restore();
  }

  // ========================================================================
  // Background Rendering
  // ========================================================================

  private renderBackground(format: CellFormat, bounds: CellBounds): void {
    if (format.backgroundColor) {
      const [r, g, b] = format.backgroundColor;
      this.backend.setFillColor(r / 255, g / 255, b / 255);
      this.backend.beginPath();
      this.backend.rect(bounds.x, bounds.y, bounds.width, bounds.height);
      this.backend.fill();
    }
  }

  // ========================================================================
  // Accounting Format
  // ========================================================================

  /**
   * Render accounting format: currency symbol left-aligned (flush with indent),
   * number right-aligned within the cell.
   *
   * Layout: | $      1,234.56 |
   *         | $        (42.00)|
   */
  private renderAccountingFormat(
    numberFormat: NumberFormatResult,
    textColor: [number, number, number],
    font: FontHandle,
    fontSize: number,
    format: CellFormat,
    bounds: CellBounds,
  ): void {
    const indent = (format.indent ?? 0) * INDENT_UNIT;
    const leftX = bounds.x + CELL_PADDING + indent;
    const rightX = bounds.x + bounds.width - CELL_PADDING;
    const textY = this.computeTextY(format, bounds, fontSize);

    this.backend.setFont(font, fontSize);

    const [r, g, b] = textColor;
    const pdfColor: [number, number, number] = [r / 255, g / 255, b / 255];

    // Draw currency symbol at left
    const symbol = numberFormat.currencySymbol!;
    this.backend.drawText(symbol, leftX, textY, {
      halign: 'left',
      valign: 'middle',
      color: pdfColor,
    });

    // Draw number value at right (strip the currency symbol from display value)
    const numberPart = this.stripCurrencySymbol(numberFormat.displayValue, symbol);
    this.backend.drawText(numberPart.trim(), rightX, textY, {
      halign: 'right',
      valign: 'middle',
      color: pdfColor,
    });
  }

  // ========================================================================
  // Fraction Format
  // ========================================================================

  /**
   * Render fraction format with proper spacing between integer and fraction parts.
   *
   * Layout: | 1 3/4 | or | 7/8 |
   */
  private renderFractionFormat(
    numberFormat: NumberFormatResult,
    textColor: [number, number, number],
    font: FontHandle,
    fontSize: number,
    format: CellFormat,
    bounds: CellBounds,
  ): void {
    const halign = format.horizontalAlignment ?? 'right';
    const textX = this.computeTextX(halign, format, bounds);
    const textY = this.computeTextY(format, bounds, fontSize);

    const pdfHalign = this.toPdfHalign(halign);
    const [r, g, b] = textColor;

    this.backend.setFont(font, fontSize);
    this.backend.drawText(numberFormat.displayValue, textX, textY, {
      halign: pdfHalign,
      valign: 'middle',
      color: [r / 255, g / 255, b / 255],
    });
  }

  // ========================================================================
  // Scientific Notation Format
  // ========================================================================

  /**
   * Render scientific notation: coefficient + "E+" + exponent.
   *
   * Layout: | 1.23E+04 |
   */
  private renderScientificFormat(
    numberFormat: NumberFormatResult,
    textColor: [number, number, number],
    font: FontHandle,
    fontSize: number,
    format: CellFormat,
    bounds: CellBounds,
  ): void {
    const halign = format.horizontalAlignment ?? 'right';
    const textX = this.computeTextX(halign, format, bounds);
    const textY = this.computeTextY(format, bounds, fontSize);

    const pdfHalign = this.toPdfHalign(halign);
    const [r, g, b] = textColor;

    this.backend.setFont(font, fontSize);
    this.backend.drawText(numberFormat.displayValue, textX, textY, {
      halign: pdfHalign,
      valign: 'middle',
      color: [r / 255, g / 255, b / 255],
    });
  }

  // ========================================================================
  // Standard Format
  // ========================================================================

  /**
   * Render a standard formatted value (no special layout needed).
   * Still applies color override from format code.
   */
  private renderStandardFormat(
    numberFormat: NumberFormatResult,
    textColor: [number, number, number],
    font: FontHandle,
    fontSize: number,
    format: CellFormat,
    bounds: CellBounds,
  ): void {
    // Default alignment for numbers: right-aligned
    const halign = format.horizontalAlignment ?? 'right';
    const textX = this.computeTextX(halign, format, bounds);
    const textY = this.computeTextY(format, bounds, fontSize);

    const pdfHalign = this.toPdfHalign(halign);
    const [r, g, b] = textColor;

    this.backend.setFont(font, fontSize);
    this.backend.drawText(numberFormat.displayValue, textX, textY, {
      halign: pdfHalign,
      valign: 'middle',
      color: [r / 255, g / 255, b / 255],
    });
  }

  // ========================================================================
  // Layout Helpers
  // ========================================================================

  /**
   * Compute the text X position based on horizontal alignment.
   */
  private computeTextX(
    halign: NonNullable<CellFormat['horizontalAlignment']>,
    format: CellFormat,
    bounds: CellBounds,
  ): number {
    const indent = (format.indent ?? 0) * INDENT_UNIT;

    switch (halign) {
      case 'left':
      case 'general':
        return bounds.x + CELL_PADDING + indent;
      case 'center':
      case 'centerContinuous':
      case 'fill':
      case 'justify':
      case 'distributed':
        return bounds.x + bounds.width / 2;
      case 'right':
        return bounds.x + bounds.width - CELL_PADDING;
      default:
        return bounds.x + CELL_PADDING;
    }
  }

  /**
   * Compute the text Y position based on vertical alignment.
   */
  private computeTextY(format: CellFormat, bounds: CellBounds, fontSize: number): number {
    const valign = format.verticalAlignment ?? 'bottom';

    switch (valign) {
      case 'top':
        return bounds.y + CELL_PADDING + fontSize;
      case 'middle':
      case 'justify':
      case 'distributed':
        return bounds.y + bounds.height / 2;
      case 'bottom':
        return bounds.y + bounds.height - CELL_PADDING;
      default:
        return bounds.y + bounds.height - CELL_PADDING;
    }
  }

  /**
   * Convert CellFormat horizontal alignment to PDF text alignment.
   */
  private toPdfHalign(
    halign: NonNullable<CellFormat['horizontalAlignment']>,
  ): 'left' | 'center' | 'right' {
    switch (halign) {
      case 'left':
      case 'general':
        return 'left';
      case 'center':
      case 'centerContinuous':
      case 'fill':
      case 'justify':
      case 'distributed':
        return 'center';
      case 'right':
        return 'right';
      default:
        return 'left';
    }
  }

  /**
   * Strip the currency symbol from a formatted display value.
   * Handles both prefix ($1,234.56) and suffix (1,234.56 EUR) positions.
   */
  private stripCurrencySymbol(displayValue: string, symbol: string): string {
    const trimmed = displayValue.trim();
    if (trimmed.startsWith(symbol)) {
      return trimmed.slice(symbol.length);
    }
    if (trimmed.endsWith(symbol)) {
      return trimmed.slice(0, -symbol.length);
    }
    return trimmed;
  }
}
