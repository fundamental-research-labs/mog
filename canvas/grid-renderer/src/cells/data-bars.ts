/**
 * Data Bar Renderer
 *
 * Renders in-cell data bars for conditional formatting.
 * Supports positive/negative values, gradients, axis positioning,
 * and rounded corners for a polished appearance.
 *
 * Ported from grid-canvas/src/conditional-formats/data-bar-renderer.ts.
 *
 * @module grid-renderer/cells/data-bars
 */

import { hexToRgba } from '@mog/canvas-engine';
import type { DataBarData } from '@mog-sdk/contracts/rendering';

// =============================================================================
// Types
// =============================================================================

export interface DataBarRenderOptions {
  /** Cell bounds */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Padding from cell edges */
  padding?: number;
  /** Bar height as percentage of cell height */
  barHeightPercent?: number;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_PADDING = 2;
const DEFAULT_BAR_HEIGHT_PERCENT = 60;

// =============================================================================
// Data Bar Rendering
// =============================================================================

/**
 * Render a data bar inside a cell.
 * The bar is rendered behind the text value.
 *
 * @param ctx - Canvas 2D rendering context
 * @param dataBar - Data bar result from CF evaluation
 * @param options - Rendering options
 */
export function renderDataBar(
  ctx: CanvasRenderingContext2D,
  dataBar: DataBarData,
  options: DataBarRenderOptions,
): void {
  const { x, y, width, height } = options;
  const padding = options.padding ?? DEFAULT_PADDING;
  const barHeightPercent = options.barHeightPercent ?? DEFAULT_BAR_HEIGHT_PERCENT;

  const { fillPercent, color, isNegative, gradient } = dataBar;

  // Calculate bar dimensions
  const barX = x + padding;
  const barWidth = (width - padding * 2) * (fillPercent / 100);
  const barHeight = height * (barHeightPercent / 100);
  const barY = y + (height - barHeight) / 2;

  if (barWidth <= 0) return;

  // Create fill style (gradient or solid)
  if (gradient) {
    const gradientFill = ctx.createLinearGradient(barX, barY, barX + barWidth, barY);
    if (isNegative) {
      // Negative: gradient from transparent to color (right to left appearance)
      gradientFill.addColorStop(0, color);
      gradientFill.addColorStop(1, hexToRgba(color, 0.3));
    } else {
      // Positive: gradient from color to transparent
      gradientFill.addColorStop(0, hexToRgba(color, 0.3));
      gradientFill.addColorStop(1, color);
    }
    ctx.fillStyle = gradientFill;
  } else {
    ctx.fillStyle = hexToRgba(color, 0.7);
  }

  // Draw the bar with rounded corners
  const cornerRadius = Math.min(2, barHeight / 4);
  drawRoundedRect(ctx, barX, barY, barWidth, barHeight, cornerRadius);
  ctx.fill();

  // Draw subtle border
  ctx.strokeStyle = hexToRgba(color, 0.9);
  ctx.lineWidth = 0.5;
  drawRoundedRect(ctx, barX, barY, barWidth, barHeight, cornerRadius);
  ctx.stroke();
}

/**
 * Render a data bar with axis for mixed positive/negative ranges.
 *
 * @param ctx - Canvas 2D rendering context
 * @param dataBar - Data bar result from CF evaluation
 * @param options - Rendering options
 * @param axisPosition - Position of zero axis as percentage (0-100)
 */
export function renderDataBarWithAxis(
  ctx: CanvasRenderingContext2D,
  dataBar: DataBarData,
  options: DataBarRenderOptions,
  axisPosition: number,
): void {
  const { x, y, width, height } = options;
  const padding = options.padding ?? DEFAULT_PADDING;
  const barHeightPercent = options.barHeightPercent ?? DEFAULT_BAR_HEIGHT_PERCENT;

  const { fillPercent, color, isNegative, gradient } = dataBar;

  const innerWidth = width - padding * 2;
  const barHeight = height * (barHeightPercent / 100);
  const barY = y + (height - barHeight) / 2;
  const axisX = x + padding + innerWidth * (axisPosition / 100);

  // Draw axis line
  ctx.strokeStyle = '#808080';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(Math.round(axisX) + 0.5, y + 2);
  ctx.lineTo(Math.round(axisX) + 0.5, y + height - 2);
  ctx.stroke();

  // Calculate bar position and width
  let barX: number;
  let barWidth: number;

  if (isNegative) {
    // Negative bar: grows left from axis
    barWidth = ((innerWidth * axisPosition) / 100) * (fillPercent / 100);
    barX = axisX - barWidth;
  } else {
    // Positive bar: grows right from axis
    barX = axisX;
    barWidth = ((innerWidth * (100 - axisPosition)) / 100) * (fillPercent / 100);
  }

  if (barWidth <= 0) return;

  // Create fill style
  if (gradient) {
    const gradientFill = ctx.createLinearGradient(barX, barY, barX + barWidth, barY);
    if (isNegative) {
      gradientFill.addColorStop(0, hexToRgba(color, 0.3));
      gradientFill.addColorStop(1, color);
    } else {
      gradientFill.addColorStop(0, color);
      gradientFill.addColorStop(1, hexToRgba(color, 0.3));
    }
    ctx.fillStyle = gradientFill;
  } else {
    ctx.fillStyle = hexToRgba(color, 0.7);
  }

  // Draw the bar
  const cornerRadius = Math.min(2, barHeight / 4);
  drawRoundedRect(ctx, barX, barY, barWidth, barHeight, cornerRadius);
  ctx.fill();

  // Draw subtle border
  ctx.strokeStyle = hexToRgba(color, 0.9);
  ctx.lineWidth = 0.5;
  drawRoundedRect(ctx, barX, barY, barWidth, barHeight, cornerRadius);
  ctx.stroke();
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Draw a rounded rectangle path.
 */
function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
