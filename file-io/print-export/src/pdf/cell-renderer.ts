/**
 * Cell Renderer -- the core rendering engine for spreadsheet cells in PDF export.
 *
 * Every cell in every exported PDF goes through this code. The renderer
 * translates cell data + formatting into format-agnostic drawing commands
 * via the RenderBackend interface.
 *
 * Rendering order: background -> content -> borders
 *
 * Supports all Excel cell features:
 * - 8 horizontal alignments (general, left, center, right, fill, justify,
 *   centerContinuous, distributed)
 * - 5 vertical alignments (top, middle, bottom, justify, distributed)
 * - Text wrapping, shrink-to-fit, text rotation (0-180, 255=vertical)
 * - Rich text with per-run formatting
 * - All 13 border styles including diagonal borders
 * - Solid, pattern, and gradient fills
 * - Hyperlink styling, comment indicators, checkbox cells
 * - Underline types: single, double, singleAccounting, doubleAccounting
 * - Superscript/subscript
 * - Indent levels (0-15)
 */

import type {
  ExcelPatternType,
  FontHandle,
  RenderBackend,
  TextBlockOptions,
  TextRun,
} from '@mog/pdf-graphics';
import {
  renderLinearGradientFill,
  renderPatternFillRect,
  renderRadialGradientFill,
} from '@mog/pdf-graphics';
import { renderCellBorders } from './border-renderer';
import type { FontResolver } from './font-resolver';
import type { BorderStyle, CellBounds } from './render-shared';

// Re-export shared geometry/style types so existing consumers of
// `./cell-renderer` keep their public import surface.
export type { BorderStyle, CellBounds } from './render-shared';

// ============================================================================
// Types
// ============================================================================

export interface CellRenderData {
  displayValue: string;
  valueType: 'string' | 'number' | 'boolean' | 'error' | 'date' | 'empty';
  richText?: RichTextSegment[];
}

export interface CellFormat {
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: 'none' | 'single' | 'double' | 'singleAccounting' | 'doubleAccounting';
  strikethrough?: boolean;
  fontColor?: [number, number, number];

  horizontalAlignment?:
    | 'general'
    | 'left'
    | 'center'
    | 'right'
    | 'fill'
    | 'justify'
    | 'centerContinuous'
    | 'distributed';
  verticalAlignment?: 'top' | 'middle' | 'bottom' | 'justify' | 'distributed';
  wrapText?: boolean;
  shrinkToFit?: boolean;
  textRotation?: number;
  indent?: number;

  backgroundColor?: [number, number, number];
  patternType?: string;
  patternForeColor?: [number, number, number];
  patternBackColor?: [number, number, number];
  gradientFill?: {
    type: 'linear' | 'radial';
    angle?: number;
    stops: { position: number; color: [number, number, number] }[];
  };

  borderTop?: BorderStyle;
  borderRight?: BorderStyle;
  borderBottom?: BorderStyle;
  borderLeft?: BorderStyle;
  borderDiagonalUp?: BorderStyle;
  borderDiagonalDown?: BorderStyle;

  isHyperlink?: boolean;
}

export interface RichTextSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  fontFamily?: string;
  fontSize?: number;
  color?: [number, number, number];
  superscript?: boolean;
  subscript?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/** Default font family when none specified. */
const DEFAULT_FONT_FAMILY = 'Calibri';

/** Default font size in points. */
const DEFAULT_FONT_SIZE = 11;

/** Default font color (black). */
const DEFAULT_FONT_COLOR: [number, number, number] = [0, 0, 0];

/** Hyperlink color (Excel default blue). */
const HYPERLINK_COLOR: [number, number, number] = [5 / 255, 99 / 255, 193 / 255];

/** Comment indicator color (red). */
const COMMENT_INDICATOR_COLOR: [number, number, number] = [1, 0, 0];

/** Comment indicator size in points. */
const COMMENT_INDICATOR_SIZE = 6;

/** Indent width per level in points (~8px). */
const INDENT_WIDTH = 8;

/** Minimum font size for shrink-to-fit (in points). */
const MIN_SHRINK_FONT_SIZE = 1;

/** Padding inside cell (in points). */
const CELL_PADDING = 2;

/** Line height multiplier. */
const LINE_HEIGHT_MULTIPLIER = 1.2;

/** Checkbox size in points. */
const CHECKBOX_SIZE = 12;

// ============================================================================
// CellRenderer
// ============================================================================

/**
 * Core cell renderer that translates cell data and formatting
 * into RenderBackend drawing commands.
 */
export class CellRenderer {
  constructor(
    private backend: RenderBackend,
    private fontResolver: FontResolver,
  ) {}

  /**
   * Render a complete cell: background, content, and borders.
   */
  renderCell(data: CellRenderData, format: CellFormat, bounds: CellBounds): void {
    // 1. Background fill (gradient > pattern > solid)
    this.renderBackground(format, bounds);

    // 2. Cell content (text with formatting)
    this.renderContent(data, format, bounds);

    // 3. Borders (4 sides + diagonal)
    this.renderBorders(format, bounds);
  }

  /**
   * Render a comment indicator (red triangle in top-right corner).
   */
  renderCommentIndicator(bounds: CellBounds): void {
    const { x, y, width } = bounds;
    const size = COMMENT_INDICATOR_SIZE;
    const [r, g, b] = COMMENT_INDICATOR_COLOR;

    this.backend.save();
    this.backend.setFillColor(r, g, b);
    this.backend.beginPath();
    this.backend.moveTo(x + width - size, y);
    this.backend.lineTo(x + width, y);
    this.backend.lineTo(x + width, y + size);
    this.backend.closePath();
    this.backend.fill();
    this.backend.restore();
  }

  /**
   * Render a checkbox cell.
   */
  renderCheckbox(checked: boolean, bounds: CellBounds): void {
    const cx = bounds.x + (bounds.width - CHECKBOX_SIZE) / 2;
    const cy = bounds.y + (bounds.height - CHECKBOX_SIZE) / 2;

    this.backend.save();

    // Draw checkbox border
    this.backend.setStrokeColor(0.4, 0.4, 0.4);
    this.backend.setLineWidth(0.75);
    this.backend.setLineDash([], 0);
    this.backend.beginPath();
    this.backend.rect(cx, cy, CHECKBOX_SIZE, CHECKBOX_SIZE);
    this.backend.stroke();

    if (checked) {
      // Draw checkmark
      this.backend.setStrokeColor(0, 0, 0);
      this.backend.setLineWidth(1.5);
      this.backend.setLineCap('round');
      this.backend.setLineJoin('round');
      this.backend.beginPath();
      // Checkmark path: short leg up, then long leg down-right
      this.backend.moveTo(cx + 2, cy + CHECKBOX_SIZE * 0.5);
      this.backend.lineTo(cx + CHECKBOX_SIZE * 0.4, cy + CHECKBOX_SIZE - 2.5);
      this.backend.lineTo(cx + CHECKBOX_SIZE - 2, cy + 2.5);
      this.backend.stroke();
    }

    this.backend.restore();
  }

  // ==========================================================================
  // Background Rendering
  // ==========================================================================

  private renderBackground(format: CellFormat, bounds: CellBounds): void {
    // Priority: gradient > pattern > solid
    if (format.gradientFill) {
      this.renderGradientFill(format.gradientFill, bounds);
    } else if (format.patternType && format.patternType !== 'none') {
      this.renderPatternFill(format, bounds);
    } else if (format.backgroundColor) {
      this.renderSolidFill(format.backgroundColor, bounds);
    }
  }

  private renderSolidFill(color: [number, number, number], bounds: CellBounds): void {
    const [r, g, b] = color;
    this.backend.save();
    this.backend.setFillColor(r, g, b);
    this.backend.beginPath();
    this.backend.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    this.backend.fill();
    this.backend.restore();
  }

  private renderGradientFill(
    gradient: NonNullable<CellFormat['gradientFill']>,
    bounds: CellBounds,
  ): void {
    const stops = gradient.stops;
    if (stops.length < 2) {
      if (stops.length === 1) {
        this.renderSolidFill(stops[0].color, bounds);
      }
      return;
    }

    if (gradient.type === 'linear') {
      renderLinearGradientFill(
        this.backend,
        {
          angle: gradient.angle ?? 0,
          stops,
        },
        bounds,
      );
    } else {
      renderRadialGradientFill(
        this.backend,
        {
          stops,
        },
        bounds,
      );
    }
  }

  private renderPatternFill(format: CellFormat, bounds: CellBounds): void {
    const patternType = format.patternType as ExcelPatternType | undefined;
    if (!patternType || patternType === 'none') return;

    renderPatternFillRect(
      this.backend,
      patternType,
      format.patternForeColor ?? [0, 0, 0],
      format.patternBackColor ?? [1, 1, 1],
      bounds,
    );
  }

  // ==========================================================================
  // Content Rendering
  // ==========================================================================

  private renderContent(data: CellRenderData, format: CellFormat, bounds: CellBounds): void {
    if (data.valueType === 'empty' && !data.displayValue) return;

    const fontSize = format.fontSize ?? DEFAULT_FONT_SIZE;
    const fontFamily = format.fontFamily ?? DEFAULT_FONT_FAMILY;
    const bold = format.bold ?? false;
    const italic = format.italic ?? false;

    // Resolve font
    const font = this.fontResolver.resolve(fontFamily, bold, italic);

    // Determine text color
    let textColor: [number, number, number];
    if (format.isHyperlink) {
      textColor = HYPERLINK_COLOR;
    } else {
      textColor = format.fontColor ?? DEFAULT_FONT_COLOR;
    }

    // Compute content area (with padding and indent)
    const indent = (format.indent ?? 0) * INDENT_WIDTH;
    const contentBounds: CellBounds = {
      x: bounds.x + CELL_PADDING + indent,
      y: bounds.y + CELL_PADDING,
      width: bounds.width - 2 * CELL_PADDING - indent,
      height: bounds.height - 2 * CELL_PADDING,
    };

    if (contentBounds.width <= 0 || contentBounds.height <= 0) return;

    // Set clipping region to prevent text overflow
    this.backend.save();
    this.backend.beginPath();
    this.backend.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    this.backend.clip();

    // Handle text rotation
    if (format.textRotation && format.textRotation !== 0) {
      this.renderRotatedText(data, format, font, fontSize, textColor, contentBounds);
    } else if (data.richText && data.richText.length > 0) {
      this.renderRichText(data.richText, format, fontSize, textColor, contentBounds);
    } else {
      this.renderPlainText(data, format, font, fontSize, textColor, contentBounds);
    }

    this.backend.restore();
  }

  private renderPlainText(
    data: CellRenderData,
    format: CellFormat,
    font: FontHandle,
    fontSize: number,
    textColor: [number, number, number],
    contentBounds: CellBounds,
  ): void {
    const text = data.displayValue;
    if (!text) return;

    const halign = this.resolveHorizontalAlignment(
      format.horizontalAlignment ?? 'general',
      data.valueType,
    );
    const valign = format.verticalAlignment ?? 'bottom';

    // Handle fill alignment (repeat text to fill width)
    if (halign === 'fill') {
      this.renderFillAlignment(text, font, fontSize, textColor, format, contentBounds);
      return;
    }

    // Handle distributed alignment (equal spacing between characters)
    if (halign === 'distributed') {
      this.renderDistributedText(text, font, fontSize, textColor, format, contentBounds);
      return;
    }

    let effectiveFontSize = fontSize;

    // Handle shrink-to-fit
    if (format.shrinkToFit && !format.wrapText) {
      const textWidth = this.backend.measureText(text, font, fontSize);
      if (textWidth > contentBounds.width) {
        effectiveFontSize = Math.max(
          MIN_SHRINK_FONT_SIZE,
          fontSize * (contentBounds.width / textWidth),
        );
      }
    }

    const effectiveLineHeight = effectiveFontSize * LINE_HEIGHT_MULTIPLIER;

    // Handle text wrapping
    let lines: string[];
    if (format.wrapText) {
      lines = this.wrapTextLines(text, font, effectiveFontSize, contentBounds.width);
    } else {
      lines = [text];
    }

    // Calculate vertical position
    const totalTextHeight = lines.length * effectiveLineHeight;
    const startY = this.computeVerticalPosition(
      valign,
      contentBounds,
      totalTextHeight,
      effectiveLineHeight,
    );

    // Render each line
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      const lineWidth = this.backend.measureText(line, font, effectiveFontSize);
      const textX = this.computeHorizontalPosition(halign, contentBounds, lineWidth);
      const textY = startY + i * effectiveLineHeight;

      // Underline for hyperlinks
      const underline = format.isHyperlink ? 'single' : (format.underline ?? 'none');

      this.drawTextLine(
        line,
        textX,
        textY,
        font,
        effectiveFontSize,
        textColor,
        underline,
        format.strikethrough ?? false,
        contentBounds.width,
      );
    }
  }

  private renderRichText(
    segments: RichTextSegment[],
    format: CellFormat,
    baseFontSize: number,
    baseColor: [number, number, number],
    contentBounds: CellBounds,
  ): void {
    const halign = this.resolveHorizontalAlignment(
      format.horizontalAlignment ?? 'general',
      'string',
    );
    const valign = format.verticalAlignment ?? 'bottom';

    // Convert RichTextSegments to TextRuns
    const runs: TextRun[] = segments.map((seg) => {
      const segFontSize = seg.fontSize ?? baseFontSize;
      const segBold = seg.bold ?? false;
      const segItalic = seg.italic ?? false;
      const segFont = this.fontResolver.resolve(
        seg.fontFamily ?? format.fontFamily ?? DEFAULT_FONT_FAMILY,
        segBold,
        segItalic,
      );

      return {
        text: seg.text,
        font: segFont,
        size: segFontSize,
        color: seg.color ?? baseColor,
        bold: segBold,
        italic: segItalic,
        underline: seg.underline,
        strikethrough: seg.strikethrough,
        superscript: seg.superscript,
        subscript: seg.subscript,
      };
    });

    // Measure the text block
    const maxWidth = format.wrapText ? contentBounds.width : Infinity;
    const measurement = this.backend.measureTextRuns(runs, maxWidth);

    // Calculate vertical position
    const startY = this.computeVerticalPosition(
      valign,
      contentBounds,
      measurement.height,
      baseFontSize * LINE_HEIGHT_MULTIPLIER,
    );

    // Map halign to TextBlockOptions halign
    const blockHalign = mapHalignToBlockHalign(halign);

    // Draw the rich text
    const blockOptions: TextBlockOptions = {
      maxWidth: contentBounds.width,
      lineHeight: baseFontSize * LINE_HEIGHT_MULTIPLIER,
      halign: blockHalign,
      valign: 'top',
    };

    this.backend.drawTextRuns(runs, contentBounds.x, startY, blockOptions);
  }

  private renderRotatedText(
    data: CellRenderData,
    format: CellFormat,
    font: FontHandle,
    fontSize: number,
    textColor: [number, number, number],
    contentBounds: CellBounds,
  ): void {
    const rotation = format.textRotation!;
    const text = data.displayValue;
    if (!text) return;

    this.backend.save();

    if (rotation === 255) {
      // Vertical text: stack characters vertically
      this.renderVerticalText(text, font, fontSize, textColor, contentBounds);
    } else {
      // Angular rotation
      // Excel: 0-90 = counter-clockwise, 91-180 = clockwise (mapped as -(rotation-90))
      let angleRad: number;
      if (rotation <= 90) {
        angleRad = (rotation * Math.PI) / 180;
      } else {
        angleRad = -((rotation - 90) * Math.PI) / 180;
      }

      // Translate to center of content area, then rotate
      const centerX = contentBounds.x + contentBounds.width / 2;
      const centerY = contentBounds.y + contentBounds.height / 2;

      this.backend.translate(centerX, centerY);
      this.backend.rotate(angleRad);

      // Draw text centered at origin
      const textWidth = this.backend.measureText(text, font, fontSize);
      this.backend.drawText(text, -textWidth / 2, fontSize / 3, {
        color: textColor,
        underline:
          format.underline === 'single' ||
          format.underline === 'singleAccounting' ||
          format.isHyperlink,
        strikethrough: format.strikethrough,
      });
    }

    this.backend.restore();
  }

  private renderVerticalText(
    text: string,
    font: FontHandle,
    fontSize: number,
    textColor: [number, number, number],
    contentBounds: CellBounds,
  ): void {
    const charHeight = fontSize * LINE_HEIGHT_MULTIPLIER;
    const totalHeight = text.length * charHeight;

    // Center vertically
    let startY = contentBounds.y;
    if (totalHeight < contentBounds.height) {
      startY += (contentBounds.height - totalHeight) / 2;
    }

    // Center each character horizontally
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const charWidth = this.backend.measureText(ch, font, fontSize);
      const charX = contentBounds.x + (contentBounds.width - charWidth) / 2;
      const charY = startY + i * charHeight + fontSize;

      this.backend.drawText(ch, charX, charY, { color: textColor });
    }
  }

  private renderFillAlignment(
    text: string,
    font: FontHandle,
    fontSize: number,
    textColor: [number, number, number],
    format: CellFormat,
    contentBounds: CellBounds,
  ): void {
    if (!text) return;

    const textWidth = this.backend.measureText(text, font, fontSize);
    if (textWidth <= 0) return;

    const repetitions = Math.floor(contentBounds.width / textWidth);
    if (repetitions <= 0) return;

    const lineHeight = fontSize * LINE_HEIGHT_MULTIPLIER;
    const valign = format.verticalAlignment ?? 'bottom';
    const textY = this.computeVerticalPosition(valign, contentBounds, lineHeight, lineHeight);

    for (let i = 0; i < repetitions; i++) {
      const textX = contentBounds.x + i * textWidth;
      this.backend.drawText(text, textX, textY, { color: textColor });
    }
  }

  private renderDistributedText(
    text: string,
    font: FontHandle,
    fontSize: number,
    textColor: [number, number, number],
    format: CellFormat,
    contentBounds: CellBounds,
  ): void {
    if (text.length <= 1) {
      // Single char or empty: center it
      const charWidth = text.length === 1 ? this.backend.measureText(text, font, fontSize) : 0;
      const textX = contentBounds.x + (contentBounds.width - charWidth) / 2;
      const lineHeight = fontSize * LINE_HEIGHT_MULTIPLIER;
      const valign = format.verticalAlignment ?? 'bottom';
      const textY = this.computeVerticalPosition(valign, contentBounds, lineHeight, lineHeight);
      if (text.length === 1) {
        this.backend.drawText(text, textX, textY, { color: textColor });
      }
      return;
    }

    // Distribute characters evenly across the width
    const chars = text.split('');
    const charWidths = chars.map((ch) => this.backend.measureText(ch, font, fontSize));
    const totalCharWidth = charWidths.reduce((sum, w) => sum + w, 0);
    const totalGap = contentBounds.width - totalCharWidth;
    const gapPerSpace = totalGap / (chars.length - 1);

    const lineHeight = fontSize * LINE_HEIGHT_MULTIPLIER;
    const valign = format.verticalAlignment ?? 'bottom';
    const textY = this.computeVerticalPosition(valign, contentBounds, lineHeight, lineHeight);

    let currentX = contentBounds.x;
    for (let i = 0; i < chars.length; i++) {
      this.backend.drawText(chars[i], currentX, textY, { color: textColor });
      currentX += charWidths[i] + (i < chars.length - 1 ? gapPerSpace : 0);
    }
  }

  // ==========================================================================
  // Text Drawing Helpers
  // ==========================================================================

  private drawTextLine(
    text: string,
    x: number,
    y: number,
    font: FontHandle,
    fontSize: number,
    color: [number, number, number],
    underline: string,
    strikethrough: boolean,
    cellWidth: number,
  ): void {
    const textWidth = this.backend.measureText(text, font, fontSize);

    // Draw the text
    this.backend.drawText(text, x, y, {
      color,
      underline: underline === 'single' || underline === 'double',
      strikethrough,
    });

    // Draw additional underline decorations
    if (underline === 'double') {
      this.renderDoubleUnderline(x, y, textWidth, fontSize, color);
    }

    // Accounting underlines extend to cell width
    if (underline === 'singleAccounting' || underline === 'doubleAccounting') {
      this.renderAccountingUnderline(
        x,
        y,
        cellWidth,
        fontSize,
        color,
        underline === 'doubleAccounting',
      );
    }
  }

  private renderDoubleUnderline(
    x: number,
    y: number,
    textWidth: number,
    fontSize: number,
    color: [number, number, number],
  ): void {
    const [r, g, b] = color;
    const underlineY = y + fontSize * 0.15;
    const gap = fontSize * 0.06;

    this.backend.save();
    this.backend.setStrokeColor(r, g, b);
    this.backend.setLineWidth(0.5);
    this.backend.setLineDash([], 0);

    // First underline
    this.backend.beginPath();
    this.backend.moveTo(x, underlineY - gap);
    this.backend.lineTo(x + textWidth, underlineY - gap);
    this.backend.stroke();

    // Second underline
    this.backend.beginPath();
    this.backend.moveTo(x, underlineY + gap);
    this.backend.lineTo(x + textWidth, underlineY + gap);
    this.backend.stroke();

    this.backend.restore();
  }

  private renderAccountingUnderline(
    x: number,
    y: number,
    cellWidth: number,
    fontSize: number,
    color: [number, number, number],
    isDouble: boolean,
  ): void {
    const [r, g, b] = color;
    const underlineY = y + fontSize * 0.15;

    this.backend.save();
    this.backend.setStrokeColor(r, g, b);
    this.backend.setLineWidth(0.5);
    this.backend.setLineDash([], 0);

    if (isDouble) {
      const gap = fontSize * 0.06;
      this.backend.beginPath();
      this.backend.moveTo(x, underlineY - gap);
      this.backend.lineTo(x + cellWidth, underlineY - gap);
      this.backend.stroke();

      this.backend.beginPath();
      this.backend.moveTo(x, underlineY + gap);
      this.backend.lineTo(x + cellWidth, underlineY + gap);
      this.backend.stroke();
    } else {
      this.backend.beginPath();
      this.backend.moveTo(x, underlineY);
      this.backend.lineTo(x + cellWidth, underlineY);
      this.backend.stroke();
    }

    this.backend.restore();
  }

  // ==========================================================================
  // Border Rendering
  // ==========================================================================

  private renderBorders(format: CellFormat, bounds: CellBounds): void {
    const hasBorders =
      format.borderTop ||
      format.borderRight ||
      format.borderBottom ||
      format.borderLeft ||
      format.borderDiagonalUp ||
      format.borderDiagonalDown;

    if (!hasBorders) return;

    renderCellBorders(this.backend, bounds, {
      borderTop: format.borderTop,
      borderRight: format.borderRight,
      borderBottom: format.borderBottom,
      borderLeft: format.borderLeft,
      borderDiagonalUp: format.borderDiagonalUp,
      borderDiagonalDown: format.borderDiagonalDown,
    });
  }

  // ==========================================================================
  // Alignment Helpers
  // ==========================================================================

  /**
   * Resolve "general" alignment based on value type.
   * - Numbers, dates: right
   * - Booleans: center
   * - Errors: left
   * - Text: left
   */
  private resolveHorizontalAlignment(
    alignment: CellFormat['horizontalAlignment'],
    valueType: CellRenderData['valueType'],
  ): string {
    if (alignment && alignment !== 'general') return alignment;

    switch (valueType) {
      case 'number':
      case 'date':
        return 'right';
      case 'boolean':
        return 'center';
      case 'error':
        return 'left';
      default:
        return 'left';
    }
  }

  private computeHorizontalPosition(
    halign: string,
    contentBounds: CellBounds,
    textWidth: number,
  ): number {
    switch (halign) {
      case 'center':
      case 'centerContinuous':
        return contentBounds.x + (contentBounds.width - textWidth) / 2;
      case 'right':
        return contentBounds.x + contentBounds.width - textWidth;
      case 'justify':
      case 'left':
      default:
        return contentBounds.x;
    }
  }

  private computeVerticalPosition(
    valign: string,
    contentBounds: CellBounds,
    totalTextHeight: number,
    lineHeight: number,
  ): number {
    // Y position is the baseline of the first line of text
    const ascender = lineHeight * 0.8; // Approximate ascender

    switch (valign) {
      case 'top':
        return contentBounds.y + ascender;
      case 'middle':
      case 'justify':
      case 'distributed':
        return contentBounds.y + (contentBounds.height - totalTextHeight) / 2 + ascender;
      case 'bottom':
      default:
        return contentBounds.y + contentBounds.height - totalTextHeight + ascender;
    }
  }

  // ==========================================================================
  // Text Wrapping
  // ==========================================================================

  private wrapTextLines(
    text: string,
    font: FontHandle,
    fontSize: number,
    maxWidth: number,
  ): string[] {
    if (maxWidth <= 0) return [text];

    const words = text.split(/(\s+)/);
    const lines: string[] = [];
    let currentLine = '';
    let currentWidth = 0;

    for (const word of words) {
      if (word.length === 0) continue;

      const wordWidth = this.backend.measureText(word, font, fontSize);

      if (currentLine === '') {
        currentLine = word;
        currentWidth = wordWidth;
      } else if (currentWidth + wordWidth <= maxWidth) {
        currentLine += word;
        currentWidth += wordWidth;
      } else {
        lines.push(currentLine.trimEnd());
        if (word.trim().length === 0) {
          currentLine = '';
          currentWidth = 0;
        } else {
          currentLine = word;
          currentWidth = wordWidth;
        }
      }
    }

    if (currentLine.length > 0) {
      lines.push(currentLine.trimEnd());
    }

    if (lines.length === 0) {
      lines.push('');
    }

    return lines;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Map cell horizontal alignment to TextBlockOptions halign.
 */
function mapHalignToBlockHalign(halign: string): TextBlockOptions['halign'] {
  switch (halign) {
    case 'center':
    case 'centerContinuous':
      return 'center';
    case 'right':
      return 'right';
    case 'justify':
      return 'justify';
    case 'distributed':
      return 'distributed';
    case 'left':
    case 'fill':
    default:
      return 'left';
  }
}
