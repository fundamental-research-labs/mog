/**
 * Border Renderer -- renders cell borders using the RenderBackend interface.
 *
 * This module is a thin wrapper around @mog/pdf-graphics border-renderer,
 * adapting its API to work with the print-export BorderStyle and CellBounds types.
 *
 * All 13 Excel border styles are supported:
 * - thin (0.5pt solid), medium (1pt solid), thick (1.5pt solid), hair (0.25pt solid)
 * - dashed [4,4], dotted [1,2], double (two parallel lines)
 * - dashDot [4,2,1,2], dashDotDot [4,2,1,2,1,2]
 * - mediumDashed [6,3], mediumDashDot [6,3,1,3], mediumDashDotDot [6,3,1,3,1,3]
 * - slantDashDot [4,2,1,2]
 */

import type { RenderBackend } from '@mog/pdf-graphics';
import {
  getBorderDashPattern,
  getBorderLineWidth,
  renderBorderSide as pdfGraphicsRenderBorderSide,
  renderDiagonalBorder as pdfGraphicsRenderDiagonalBorder,
} from '@mog/pdf-graphics';
import type { BorderStyle, CellBounds } from './render-shared';

// ============================================================================
// Re-exports (keeping existing API names)
// ============================================================================

/**
 * Get the line width for a border style.
 */
export function getBorderWidth(style: BorderStyle['style']): number {
  return getBorderLineWidth(style);
}

/**
 * Get the dash pattern for a border style.
 */
export function getBorderDash(
  style: BorderStyle['style'],
): { segments: number[]; phase: number } | null {
  return getBorderDashPattern(style);
}

// ============================================================================
// Wrappers (adapt print-export's object-based API to pdf-graphics)
// ============================================================================

/**
 * Render a border side (handles double borders specially).
 * Wraps pdf-graphics renderBorderSide, adapting the BorderStyle object
 * to the separate style+color parameters.
 */
export function renderBorderSide(
  backend: RenderBackend,
  border: BorderStyle,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  pdfGraphicsRenderBorderSide(backend, border.style, border.color, x1, y1, x2, y2);
}

/**
 * Render a diagonal border within a cell.
 * Wraps pdf-graphics renderDiagonalBorder, passing the BorderStyle object
 * as a BorderConfig (structurally compatible).
 */
export function renderDiagonalBorder(
  backend: RenderBackend,
  border: BorderStyle,
  bounds: CellBounds,
  direction: 'up' | 'down',
): void {
  pdfGraphicsRenderDiagonalBorder(backend, border, bounds, direction);
}

// ============================================================================
// Cell Border Orchestrator
// ============================================================================

/**
 * Render all borders for a cell.
 *
 * Border rendering order: top, right, bottom, left, diagonal-up, diagonal-down.
 * Each border is optional and independently styled.
 */
export function renderCellBorders(
  backend: RenderBackend,
  bounds: CellBounds,
  options: {
    borderTop?: BorderStyle;
    borderRight?: BorderStyle;
    borderBottom?: BorderStyle;
    borderLeft?: BorderStyle;
    borderDiagonalUp?: BorderStyle;
    borderDiagonalDown?: BorderStyle;
  },
): void {
  const { x, y, width, height } = bounds;

  // Top border
  if (options.borderTop) {
    renderBorderSide(backend, options.borderTop, x, y, x + width, y);
  }

  // Right border
  if (options.borderRight) {
    renderBorderSide(backend, options.borderRight, x + width, y, x + width, y + height);
  }

  // Bottom border
  if (options.borderBottom) {
    renderBorderSide(backend, options.borderBottom, x, y + height, x + width, y + height);
  }

  // Left border
  if (options.borderLeft) {
    renderBorderSide(backend, options.borderLeft, x, y, x, y + height);
  }

  // Diagonal up (bottom-left to top-right)
  if (options.borderDiagonalUp) {
    renderDiagonalBorder(backend, options.borderDiagonalUp, bounds, 'up');
  }

  // Diagonal down (top-left to bottom-right)
  if (options.borderDiagonalDown) {
    renderDiagonalBorder(backend, options.borderDiagonalDown, bounds, 'down');
  }
}
