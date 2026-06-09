/**
 * Rotated Text Rendering
 *
 * Renders text with angular rotation (0-180 degrees) and vertical text
 * stacking (textRotation = 255).
 *
 * Excel rotation values:
 * - 0-90: Counter-clockwise rotation
 * - 91-180: Maps to -1 to -90 clockwise
 * - 255: Vertical stacking (each character on its own line, top-to-bottom)
 *
 * @module grid-renderer/cells/rotated-text
 */

import type { TextMeasurer } from '@mog/canvas-engine';
import type { CellFormat } from '@mog-sdk/contracts/core';
import type { ThemeDefinition } from '@mog-sdk/contracts/theme';
import { buildCellFont, clipTextToCell, getCellStyle, hasExplicitFontColor } from './text';
import type { CellRenderInfo } from './types';

// =============================================================================
// Types
// =============================================================================

/** Options for renderRotatedText */
export interface RenderRotatedTextOptions {
  /** Whether the cell has a hyperlink */
  hasHyperlink: boolean;
  /** Whether this is a cut cell */
  isCutCell: boolean;
  /** Theme definition */
  theme: ThemeDefinition;
  /** Text measurer for width calculations */
  textMeasurer: TextMeasurer;
  /** CF font color override (takes priority over all other color sources) */
  fontColorOverride?: string | null;
  /** Renderer default for automatic font color. Explicit format colors remain exact. */
  defaultFontColor?: string;
}

// =============================================================================
// Rotated Text Rendering
// =============================================================================

/**
 * Render text with rotation.
 *
 * Handles both angular rotation (0-180 degrees) and vertical stacking (255).
 * For textRotation = 255, delegates to renderVerticalStackedText.
 *
 * @param ctx - Canvas rendering context
 * @param cellInfo - Per-cell computed render data
 * @param format - Cell format
 * @param textRotation - Rotation in degrees (0-180, or 255 for vertical stacking)
 * @param options - Rendering options
 */
export function renderRotatedText(
  ctx: CanvasRenderingContext2D,
  cellInfo: CellRenderInfo,
  format: CellFormat | undefined,
  textRotation: number,
  options: RenderRotatedTextOptions,
): void {
  const { displayText, x, y, width, height } = cellInfo;
  if (!displayText) return;

  const style = getCellStyle(format, options.theme, options.defaultFontColor);
  const font = buildCellFont(format, options.theme, displayText);
  ctx.font = font;

  // Set fill color (CF override > hyperlink blue > resolved font color)
  if (options.fontColorOverride) {
    ctx.fillStyle = options.fontColorOverride;
  } else if (options.hasHyperlink && !hasExplicitFontColor(format)) {
    ctx.fillStyle = '#0563C1';
  } else {
    ctx.fillStyle = style.color;
  }

  ctx.save();
  clipTextToCell(ctx, x, y, width, height);

  // Cut cell dimming
  if (options.isCutCell) {
    ctx.globalAlpha = 0.5;
  }

  // Special case: 255 = vertical stacking
  if (textRotation === 255) {
    renderVerticalStackedText(ctx, displayText, x, y, width, height, style.fontSize);
    ctx.restore();
    return;
  }

  // Angular rotation
  ctx.save();

  // Calculate cell center
  const cx = x + width / 2;
  const cy = y + height / 2;

  // Convert Excel rotation to canvas radians
  // Excel: 0-90 = counter-clockwise, 91-180 maps to -1 to -90 (clockwise)
  let angleDegrees: number;
  if (textRotation <= 90) {
    angleDegrees = textRotation;
  } else {
    angleDegrees = 90 - textRotation; // 91-180 becomes -1 to -90
  }
  const radians = (-angleDegrees * Math.PI) / 180;

  // Move to cell center and rotate
  ctx.translate(cx, cy);
  ctx.rotate(radians);

  // Set text properties (centered at origin)
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Font shadow
  if (format?.fontShadow) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
    ctx.shadowBlur = 1;
  }

  // Font outline
  if (format?.fontOutline) {
    ctx.strokeStyle = style.color;
    ctx.lineWidth = 1;
    ctx.strokeText(displayText, 0, 0);
  }

  ctx.fillText(displayText, 0, 0);

  // Clear shadow
  if (format?.fontShadow) {
    ctx.shadowColor = 'transparent';
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.shadowBlur = 0;
  }

  ctx.restore();

  ctx.restore();
}

// =============================================================================
// Vertical Stacked Text
// =============================================================================

/**
 * Render vertically stacked text (textRotation = 255).
 *
 * Each character is drawn on its own line, reading top-to-bottom.
 * Text is centered both horizontally and vertically within the cell.
 *
 * @param ctx - Canvas rendering context
 * @param text - Text to render
 * @param x - Cell x position
 * @param y - Cell y position
 * @param width - Cell width
 * @param height - Cell height
 * @param fontSize - Font size in pixels
 */
export function renderVerticalStackedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fontSize: number,
): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const charHeight = fontSize * 1.2; // Line spacing for stacked chars
  const totalHeight = text.length * charHeight;
  const startY = y + (height - totalHeight) / 2; // Center vertically
  const charX = x + width / 2; // Center horizontally

  for (let i = 0; i < text.length; i++) {
    ctx.fillText(text[i], charX, startY + i * charHeight);
  }
}
