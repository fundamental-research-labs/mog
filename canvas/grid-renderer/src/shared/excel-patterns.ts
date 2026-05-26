/**
 * Excel Pattern Fill Library
 *
 * Canvas CanvasPattern implementations for all 18 Excel pattern types.
 * Each pattern is drawn on an 8x8 pixel tile and repeated.
 *
 * Pattern types follow Excel's naming:
 * - Gray fills: darkGray (75%), mediumGray (50%), lightGray (25%), gray125 (12.5%), gray0625 (6.25%)
 * - Stripe fills: horizontal, vertical, up diagonal, down diagonal
 * - Grid fills: grid (cross), trellis (diagonal cross)
 * - Each stripe/grid has dark (thick) and light (thin) variants
 *
 * Uses a cache to avoid recreating patterns for the same color combinations.
 *
 * @module grid-renderer/shared/excel-patterns
 * @see contracts/src/core.ts for PatternType definition
 */

import type { PatternType } from '@mog-sdk/contracts/core';

// =============================================================================
// Pattern Cache
// =============================================================================

/**
 * Cache key format: `${patternType}-${fgColor}-${bgColor}`
 * Patterns are expensive to create, so we cache them.
 */
const PATTERN_CACHE = new Map<string, CanvasPattern>();

/**
 * Offscreen canvas for pattern creation.
 * Reused across all pattern creations to avoid allocation.
 */
let patternCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
let patternCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

/**
 * Initialize the offscreen canvas for pattern creation.
 */
function getPatternContext(): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  if (!patternCtx) {
    // Use OffscreenCanvas if available (better performance), fallback to HTMLCanvasElement
    if (typeof OffscreenCanvas !== 'undefined') {
      patternCanvas = new OffscreenCanvas(8, 8);
      patternCtx = patternCanvas.getContext('2d')!;
    } else {
      patternCanvas = document.createElement('canvas');
      patternCanvas.width = 8;
      patternCanvas.height = 8;
      patternCtx = patternCanvas.getContext('2d')!;
    }
  }
  return patternCtx;
}

// =============================================================================
// Pattern Drawing Functions
// =============================================================================

/**
 * Draw a gray dot pattern with the specified density.
 * Uses a checkerboard-like approach with varying density.
 */
function drawGrayPattern(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  density: number,
  fgColor: string,
): void {
  ctx.fillStyle = fgColor;

  if (density >= 0.75) {
    // darkGray - 75%: fill most pixels, leave some gaps
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        if (!((x + y) % 4 === 0)) {
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  } else if (density >= 0.5) {
    // mediumGray - 50%: alternating pixels
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        if ((x + y) % 2 === 0) {
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  } else if (density >= 0.25) {
    // lightGray - 25%: sparse checkerboard
    for (let y = 0; y < 8; y += 2) {
      for (let x = 0; x < 8; x += 2) {
        if ((x / 2 + y / 2) % 2 === 0) {
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  } else if (density >= 0.125) {
    // gray125 - 12.5%: very sparse
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillRect(4, 4, 1, 1);
  } else {
    // gray0625 - 6.25%: minimal
    ctx.fillRect(0, 0, 1, 1);
  }
}

/**
 * Draw horizontal stripe pattern.
 */
function drawHorizontalStripes(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  dark: boolean,
  fgColor: string,
): void {
  ctx.fillStyle = fgColor;
  if (dark) {
    // Dark: 2px stripes every 4px
    ctx.fillRect(0, 0, 8, 2);
    ctx.fillRect(0, 4, 8, 2);
  } else {
    // Light: 1px stripes every 4px
    ctx.fillRect(0, 0, 8, 1);
    ctx.fillRect(0, 4, 8, 1);
  }
}

/**
 * Draw vertical stripe pattern.
 */
function drawVerticalStripes(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  dark: boolean,
  fgColor: string,
): void {
  ctx.fillStyle = fgColor;
  if (dark) {
    // Dark: 2px stripes every 4px
    ctx.fillRect(0, 0, 2, 8);
    ctx.fillRect(4, 0, 2, 8);
  } else {
    // Light: 1px stripes every 4px
    ctx.fillRect(0, 0, 1, 8);
    ctx.fillRect(4, 0, 1, 8);
  }
}

/**
 * Draw diagonal down stripe pattern (top-left to bottom-right).
 */
function drawDiagonalDown(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  dark: boolean,
  fgColor: string,
): void {
  ctx.fillStyle = fgColor;
  const width = dark ? 2 : 1;

  // Draw diagonal lines
  for (let i = 0; i < 8; i++) {
    for (let w = 0; w < width; w++) {
      const x = (i + w) % 8;
      const y = i;
      ctx.fillRect(x, y, 1, 1);
    }
  }

  // Wrap around for seamless tiling
  if (dark) {
    for (let i = 0; i < 8; i++) {
      const x = (i + 1) % 8;
      const y = (i + 7) % 8;
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

/**
 * Draw diagonal up stripe pattern (bottom-left to top-right).
 */
function drawDiagonalUp(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  dark: boolean,
  fgColor: string,
): void {
  ctx.fillStyle = fgColor;
  const width = dark ? 2 : 1;

  // Draw diagonal lines (going up)
  for (let i = 0; i < 8; i++) {
    for (let w = 0; w < width; w++) {
      const x = (i + w) % 8;
      const y = (7 - i + 8) % 8;
      ctx.fillRect(x, y, 1, 1);
    }
  }

  // Wrap around for seamless tiling
  if (dark) {
    for (let i = 0; i < 8; i++) {
      const x = (i + 1) % 8;
      const y = (8 - i) % 8;
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

/**
 * Draw grid pattern (horizontal + vertical cross).
 */
function drawGrid(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  dark: boolean,
  fgColor: string,
): void {
  drawHorizontalStripes(ctx, dark, fgColor);
  drawVerticalStripes(ctx, dark, fgColor);
}

/**
 * Draw trellis pattern (diagonal cross/hatch).
 */
function drawTrellis(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  dark: boolean,
  fgColor: string,
): void {
  drawDiagonalUp(ctx, dark, fgColor);
  drawDiagonalDown(ctx, dark, fgColor);
}

// =============================================================================
// Pattern Creation
// =============================================================================

/**
 * Create a CanvasPattern for the specified pattern type and colors.
 */
function createPatternInternal(
  targetCtx: CanvasRenderingContext2D,
  patternType: PatternType,
  fgColor: string,
  bgColor: string,
): CanvasPattern | null {
  // 'none' and 'solid' don't use patterns
  if (patternType === 'none' || patternType === 'solid') {
    return null;
  }

  const pctx = getPatternContext();

  // Clear and fill with background color
  pctx.fillStyle = bgColor;
  pctx.fillRect(0, 0, 8, 8);

  // Draw the pattern
  switch (patternType) {
    // Gray fills
    case 'darkGray':
      drawGrayPattern(pctx, 0.75, fgColor);
      break;
    case 'mediumGray':
      drawGrayPattern(pctx, 0.5, fgColor);
      break;
    case 'lightGray':
      drawGrayPattern(pctx, 0.25, fgColor);
      break;
    case 'gray125':
      drawGrayPattern(pctx, 0.125, fgColor);
      break;
    case 'gray0625':
      drawGrayPattern(pctx, 0.0625, fgColor);
      break;

    // Horizontal stripes
    case 'darkHorizontal':
      drawHorizontalStripes(pctx, true, fgColor);
      break;
    case 'lightHorizontal':
      drawHorizontalStripes(pctx, false, fgColor);
      break;

    // Vertical stripes
    case 'darkVertical':
      drawVerticalStripes(pctx, true, fgColor);
      break;
    case 'lightVertical':
      drawVerticalStripes(pctx, false, fgColor);
      break;

    // Diagonal down (top-left to bottom-right)
    case 'darkDown':
      drawDiagonalDown(pctx, true, fgColor);
      break;
    case 'lightDown':
      drawDiagonalDown(pctx, false, fgColor);
      break;

    // Diagonal up (bottom-left to top-right)
    case 'darkUp':
      drawDiagonalUp(pctx, true, fgColor);
      break;
    case 'lightUp':
      drawDiagonalUp(pctx, false, fgColor);
      break;

    // Grid (horizontal + vertical)
    case 'darkGrid':
      drawGrid(pctx, true, fgColor);
      break;
    case 'lightGrid':
      drawGrid(pctx, false, fgColor);
      break;

    // Trellis (diagonal cross)
    case 'darkTrellis':
      drawTrellis(pctx, true, fgColor);
      break;
    case 'lightTrellis':
      drawTrellis(pctx, false, fgColor);
      break;

    default:
      // Unknown pattern type - return null
      return null;
  }

  // Create pattern from the tile
  // Note: We use the targetCtx to create the pattern so it's compatible with that context
  const canvas = patternCanvas as HTMLCanvasElement | OffscreenCanvas;
  return targetCtx.createPattern(canvas, 'repeat');
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Get or create a cached CanvasPattern for the specified pattern type and colors.
 *
 * @param ctx - The canvas context where the pattern will be used
 * @param patternType - Excel pattern type (from CellFormat.patternType)
 * @param fgColor - Foreground/pattern color (from CellFormat.patternForegroundColor or default black)
 * @param bgColor - Background color (from CellFormat.backgroundColor or default white)
 * @returns CanvasPattern for use with ctx.fillStyle, or null if no pattern needed
 *
 * @example
 * const pattern = getExcelPattern(ctx, 'mediumGray', '#000000', '#ffffff');
 * if (pattern) {
 *   ctx.fillStyle = pattern;
 *   ctx.fillRect(x, y, width, height);
 * }
 */
export function getExcelPattern(
  ctx: CanvasRenderingContext2D,
  patternType: PatternType,
  fgColor: string = '#000000',
  bgColor: string = '#ffffff',
): CanvasPattern | null {
  // 'none' and 'solid' don't use patterns
  if (patternType === 'none' || patternType === 'solid') {
    return null;
  }

  // Check cache
  const cacheKey = `${patternType}-${fgColor}-${bgColor}`;
  const cached = PATTERN_CACHE.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Create new pattern
  const pattern = createPatternInternal(ctx, patternType, fgColor, bgColor);
  if (pattern) {
    PATTERN_CACHE.set(cacheKey, pattern);
  }

  return pattern;
}

/**
 * Clear the pattern cache.
 * Call this when changing themes or to free memory.
 */
export function clearPatternCache(): void {
  PATTERN_CACHE.clear();
}

/**
 * Get the current cache size (for debugging/monitoring).
 */
export function getPatternCacheSize(): number {
  return PATTERN_CACHE.size;
}
