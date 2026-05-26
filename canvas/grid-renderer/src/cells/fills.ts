/**
 * Cell Fill Renderer
 *
 * Background fill rendering: solid, pattern, gradient,
 * CF background overrides, spill range, and merged cell backgrounds.
 *
 * Priority order (highest to lowest):
 * 1. CF background color override (pre-resolved hex string from viewport)
 * 2. Gradient fill
 * 3. Pattern fill (non-solid, non-none)
 * 4. Solid fill (backgroundColor) — includes table style via Rust viewport
 * 5. Spill range background
 * 6. Merged cell white background
 *
 * @module grid-renderer/cells/fills
 */

import { computeLinearGradientEndpoints } from '@mog/canvas-engine';
import type { CellFormat, GradientFill } from '@mog-sdk/contracts/core';
import type { ResolvedSheetViewSkin } from '@mog-sdk/contracts/rendering/sheet-view-skin';

import { getCellBounds } from '../shared/cell-bounds';
import { SPILL_CELL_BG_COLOR } from '../shared/constants';
import { getExcelPattern } from '../shared/excel-patterns';
import type { CellRenderInfo } from './types';

// =============================================================================
// Main Fill Renderer
// =============================================================================

/**
 * Render all fill layers for a single cell.
 *
 * This function handles the full fill pipeline:
 * 1. Merged cell white background (base layer)
 * 2. Spill range background
 * 3. Solid / pattern / gradient fills from cell format (includes table style via Rust viewport)
 * 4. CF background color overrides (topmost)
 *
 * @param ctx - Canvas 2D rendering context
 * @param cellInfo - Per-cell computed render data
 * @param format - Resolved cell format (may include table overrides). Color fields
 *   are pre-resolved to hex by the Rust viewport wire — no TS-side theme resolution needed.
 * @param options - Additional rendering options
 */
export function renderCellFill(
  ctx: CanvasRenderingContext2D,
  cellInfo: CellRenderInfo,
  format: CellFormat | undefined,
  options?: {
    /** Pre-resolved CF background color hex string (e.g. "#FF0000") */
    bgColorOverride?: string | null;
    /** Whether this cell is a projected position (receives value from dynamic array) */
    isProjectedPosition?: boolean;
    /** Resolved sheet skin for no-fill/default visual paint. */
    sheetViewSkin?: ResolvedSheetViewSkin;
  },
): void {
  const { x, y, width, height } = getCellBounds(cellInfo);

  // Layer 1: Merged cell white background
  if (cellInfo.merge) {
    ctx.fillStyle = options?.sheetViewSkin?.defaultCellBackground ?? '#ffffff';
    ctx.fillRect(x, y, width, height);
  }

  // Layer 2: Projection range background
  if (options?.isProjectedPosition) {
    ctx.fillStyle = SPILL_CELL_BG_COLOR;
    ctx.fillRect(x, y, width, height);
  }

  // Layer 3: Cell format fills (gradient > pattern > solid)
  if (format) {
    renderFormatFill(
      ctx,
      format,
      x,
      y,
      width,
      height,
      options?.sheetViewSkin?.defaultCellBackground ?? '#ffffff',
    );
  }

  // Layer 4: CF background color override (topmost, pre-resolved hex from viewport)
  if (options?.bgColorOverride) {
    ctx.fillStyle = options.bgColorOverride;
    ctx.fillRect(x, y, width, height);
  }
}

// =============================================================================
// Format Fill (Gradient / Pattern / Solid)
// =============================================================================

/**
 * Render cell fill from CellFormat properties.
 * Priority: gradientFill > patternType > backgroundColor (solid)
 */
function renderFormatFill(
  ctx: CanvasRenderingContext2D,
  format: CellFormat,
  x: number,
  y: number,
  width: number,
  height: number,
  defaultCellBackground: string,
): void {
  // Priority 1: Gradient fill (overrides everything)
  if (format.gradientFill) {
    renderGradientFill(ctx, format.gradientFill, x, y, width, height);
    return;
  }

  // Priority 2: Pattern fill (non-solid, non-none)
  if (format.patternType && format.patternType !== 'none' && format.patternType !== 'solid') {
    renderPatternFill(ctx, format, x, y, width, height, defaultCellBackground);
    return;
  }

  // Priority 3: Solid fill (backgroundColor only — already resolved hex from Rust wire)
  if (format.backgroundColor) {
    ctx.fillStyle = format.backgroundColor;
    ctx.fillRect(x, y, width, height);
  }
}

// =============================================================================
// Pattern Fill
// =============================================================================

/**
 * Render pattern fill using the Excel patterns library.
 */
function renderPatternFill(
  ctx: CanvasRenderingContext2D,
  format: CellFormat,
  x: number,
  y: number,
  width: number,
  height: number,
  defaultCellBackground: string,
): void {
  if (!format.patternType || format.patternType === 'none' || format.patternType === 'solid') {
    return;
  }

  // Colors are pre-resolved hex from Rust wire
  const fgColor = format.patternForegroundColor ?? '#000000';
  const bgColor = format.backgroundColor ?? defaultCellBackground;

  // Get or create the pattern
  const pattern = getExcelPattern(ctx, format.patternType, fgColor, bgColor);
  if (pattern) {
    ctx.fillStyle = pattern;
    ctx.fillRect(x, y, width, height);
  }
}

// =============================================================================
// Gradient Fill
// =============================================================================

/**
 * Render gradient fill (linear or path/radial).
 */
function renderGradientFill(
  ctx: CanvasRenderingContext2D,
  gradientFill: GradientFill,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  let gradient: CanvasGradient;

  if (gradientFill.type === 'linear') {
    // Linear gradient: use degree to calculate start/end points
    // 0 deg = left to right, 90 deg = bottom to top (invertY for canvas coords)
    const degree = gradientFill.degree ?? 0;
    const radians = (degree * Math.PI) / 180;
    const cx = x + width / 2;
    const cy = y + height / 2;
    const { x1, y1, x2, y2 } = computeLinearGradientEndpoints(
      cx,
      cy,
      width,
      height,
      radians,
      true /* invertY */,
    );

    gradient = ctx.createLinearGradient(x1, y1, x2, y2);
  } else {
    // Path/radial gradient: use center point
    const center = gradientFill.center ?? { left: 0.5, top: 0.5 };
    const cx = x + width * center.left;
    const cy = y + height * center.top;
    const radius = Math.max(width, height) / 2;

    gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  }

  // Add color stops (colors are pre-resolved hex from Rust wire)
  for (const stop of gradientFill.stops) {
    gradient.addColorStop(stop.position, stop.color);
  }

  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, width, height);
}
