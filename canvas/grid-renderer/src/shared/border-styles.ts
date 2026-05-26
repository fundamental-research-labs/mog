/**
 * Shared Border Styles
 *
 * Centralized, Excel-compatible border dash patterns and widths.
 * This is the AUTHORITATIVE source for all border rendering.
 *
 * @module grid-renderer/shared/border-styles
 */

import type { BorderStyle } from '@mog-sdk/contracts/core';

// =============================================================================
// Border Dash Patterns (Excel-compatible)
// =============================================================================

export const BORDER_DASH_PATTERNS: Record<BorderStyle['style'], readonly number[]> = {
  none: [],
  thin: [],
  medium: [],
  thick: [],
  double: [],
  dashed: [4, 4],
  dotted: [1, 2],
  hair: [1, 1],
  mediumDashed: [6, 4],
  dashDot: [4, 2, 1, 2],
  dashDotDot: [4, 2, 1, 2, 1, 2],
  mediumDashDot: [6, 3, 2, 3],
  mediumDashDotDot: [6, 3, 2, 3, 2, 3],
  slantDashDot: [8, 2, 1, 2],
} as const;

// =============================================================================
// Border Widths
// =============================================================================

export const BORDER_WIDTHS: Record<BorderStyle['style'], number> = {
  none: 0,
  thin: 1,
  medium: 2,
  thick: 3,
  double: 3,
  dashed: 1,
  dotted: 1,
  hair: 1,
  mediumDashed: 2,
  dashDot: 1,
  dashDotDot: 1,
  mediumDashDot: 2,
  mediumDashDotDot: 2,
  slantDashDot: 2,
} as const;

// =============================================================================
// Utility Functions
// =============================================================================

export function getBorderDashPattern(style: BorderStyle['style'] | string): number[] {
  const pattern = BORDER_DASH_PATTERNS[style as BorderStyle['style']];
  return pattern ? [...pattern] : [];
}

export function getBorderWidth(style: BorderStyle['style'] | string): number {
  const width = BORDER_WIDTHS[style as BorderStyle['style']];
  return width ?? 1;
}

export function applyBorderLineStyle(ctx: CanvasRenderingContext2D, style: string): void {
  ctx.setLineDash(getBorderDashPattern(style));
}
