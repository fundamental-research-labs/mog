/**
 * Border Renderer
 *
 * All border rendering types: static cell borders and table style borders.
 * Supports all 14 Excel border styles including diagonal borders and
 * double-line borders. CF borders are now baked into the format palette
 * by Rust — no separate override needed.
 *
 * Uses pixel-grid snapping for crisp 1px lines on high-DPI displays.
 *
 * @module grid-renderer/cells/borders
 */

import type { CellBorders } from '@mog-sdk/contracts/core';
import { snapToPixelGrid } from '@mog/canvas-engine';

import { getBorderDashPattern, getBorderWidth } from '../shared/border-styles';
import { getCellBounds } from '../shared/cell-bounds';
import type { CellRenderInfo } from './types';

// Re-export shared utilities for consumers that import from borders module
export { getBorderDashPattern, getBorderWidth } from '../shared/border-styles';
export { snapToPixelGrid } from '@mog/canvas-engine';

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_BORDER_COLOR = '#000000';

// =============================================================================
// Main Border Renderer
// =============================================================================

/**
 * Render all border layers for a single cell.
 *
 * CF borders are now baked into the format palette by Rust, so only
 * static cell borders (from CellFormat.borders) need rendering here.
 *
 * @param ctx - Canvas 2D rendering context
 * @param cellInfo - Per-cell computed render data
 * @param dpr - Device pixel ratio for pixel-grid snapping
 */
export function renderBorders(
  ctx: CanvasRenderingContext2D,
  cellInfo: CellRenderInfo,
  dpr: number,
): void {
  const { x, y, width, height } = getCellBounds(cellInfo);

  // Static cell borders (includes table borders and CF borders via Rust viewport)
  if (cellInfo.format?.borders) {
    renderStaticBorders(ctx, cellInfo.format.borders, x, y, width, height, dpr);
  }
}

// =============================================================================
// Static Cell Borders
// =============================================================================

/**
 * Render static cell borders from CellFormat.borders.
 * Supports all Excel border styles including diagonal borders.
 */
function renderStaticBorders(
  ctx: CanvasRenderingContext2D,
  borders: CellBorders,
  x: number,
  y: number,
  width: number,
  height: number,
  dpr: number,
): void {
  // Helper to draw a single border with dash pattern support
  const drawBorder = (
    borderStyle: string,
    borderColor: string | undefined,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ) => {
    ctx.strokeStyle = borderColor ?? DEFAULT_BORDER_COLOR;
    ctx.lineWidth = getBorderWidth(borderStyle);
    ctx.setLineDash(getBorderDashPattern(borderStyle));

    // Special handling for double borders
    if (borderStyle === 'double') {
      const offset = 1.5;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      const nx = dy / len; // Normal x
      const ny = -dx / len; // Normal y

      ctx.lineWidth = 1;
      // First line
      ctx.beginPath();
      ctx.moveTo(x1 + nx * offset, y1 + ny * offset);
      ctx.lineTo(x2 + nx * offset, y2 + ny * offset);
      ctx.stroke();
      // Second line
      ctx.beginPath();
      ctx.moveTo(x1 - nx * offset, y1 - ny * offset);
      ctx.lineTo(x2 - nx * offset, y2 - ny * offset);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Reset dash pattern
    ctx.setLineDash([]);
  };

  // Top border
  if (borders.top && borders.top.style !== 'none') {
    const sy = snapToPixelGrid(y, dpr);
    drawBorder(borders.top.style, borders.top.color, x, sy, x + width, sy);
  }

  // Right border
  if (borders.right && borders.right.style !== 'none') {
    const sx = snapToPixelGrid(x + width, dpr);
    drawBorder(borders.right.style, borders.right.color, sx, y, sx, y + height);
  }

  // Bottom border
  if (borders.bottom && borders.bottom.style !== 'none') {
    const sy = snapToPixelGrid(y + height, dpr);
    drawBorder(borders.bottom.style, borders.bottom.color, x, sy, x + width, sy);
  }

  // Left border
  if (borders.left && borders.left.style !== 'none') {
    const sx = snapToPixelGrid(x, dpr);
    drawBorder(borders.left.style, borders.left.color, sx, y, sx, y + height);
  }

  // Diagonal borders
  if (borders.diagonal && borders.diagonal.style !== 'none') {
    const direction = borders.diagonal.direction ?? 'both';

    // Diagonal up: bottom-left to top-right
    if (direction === 'up' || direction === 'both') {
      drawBorder(borders.diagonal.style, borders.diagonal.color, x, y + height, x + width, y);
    }

    // Diagonal down: top-left to bottom-right
    if (direction === 'down' || direction === 'both') {
      drawBorder(borders.diagonal.style, borders.diagonal.color, x, y, x + width, y + height);
    }
  }
}
