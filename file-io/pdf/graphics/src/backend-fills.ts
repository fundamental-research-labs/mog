/**
 * Backend Fills -- RenderBackend-level gradient and pattern rendering.
 *
 * These helpers render gradients and patterns using only RenderBackend methods
 * (no ContentOps), making them usable by any RenderBackend consumer
 * (cell renderers, drawing renderers, etc.) across any backend.
 */

import type { GradientStop } from './gradient-fill';
import { interpolateStops, linearAngleToCoords } from './gradient-fill';
import type { ExcelPatternType } from './pattern-math';
import { TILE_SIZE, getPatternActions, shouldFillPixel } from './pattern-math';
import type { RenderBackend } from './render-backend';

// Re-export types that consumers need
export type { ExcelPatternType, GradientStop };

/**
 * Generic rectangular bounds for fill operations.
 */
export interface FillBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ============================================================================
// Linear Gradient Fill
// ============================================================================

/**
 * Render a linear gradient fill using RenderBackend methods.
 *
 * Draws 64 bands (quadrilaterals perpendicular to gradient axis) for smooth
 * gradient rendering. Uses `linearAngleToCoords()` from gradient-fill.ts
 * for proper Excel angle-to-coordinate conversion.
 */
export function renderLinearGradientFill(
  backend: RenderBackend,
  options: { angle: number; stops: GradientStop[] },
  bounds: FillBounds,
): void {
  const { stops } = options;

  // Edge cases
  if (stops.length === 0) return;
  if (stops.length === 1) {
    const [r, g, b] = stops[0].color;
    backend.save();
    backend.setFillColor(r, g, b);
    backend.beginPath();
    backend.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    backend.fill();
    backend.restore();
    return;
  }

  const sortedStops = [...stops].sort((a, b) => a.position - b.position);

  // Compute gradient axis endpoints
  const [x0, y0, x1, y1] = linearAngleToCoords(
    options.angle,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
  );

  backend.save();

  // Clip to bounds
  backend.beginPath();
  backend.rect(bounds.x, bounds.y, bounds.width, bounds.height);
  backend.clip();

  // Draw gradient as 64 bands along the gradient axis
  const numBands = 64;
  const axisLen = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);

  if (axisLen < 1e-10) {
    // Degenerate gradient -- fall back to solid fill using first stop color
    backend.save();
    backend.setFillColor(stops[0].color[0], stops[0].color[1], stops[0].color[2]);
    backend.beginPath();
    backend.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    backend.fill();
    backend.restore();
    return;
  }

  const perpX = -(y1 - y0) / axisLen;
  const perpY = (x1 - x0) / axisLen;
  const perpExtent = Math.sqrt(bounds.width ** 2 + bounds.height ** 2);

  for (let i = 0; i < numBands; i++) {
    const t0 = i / numBands;
    const t1 = (i + 1) / numBands;
    const tMid = (t0 + t1) / 2;

    const color = interpolateStops(sortedStops, tMid);

    // Band endpoints along the axis
    const bx0 = x0 + (x1 - x0) * t0;
    const by0 = y0 + (y1 - y0) * t0;
    const bx1 = x0 + (x1 - x0) * t1;
    const by1 = y0 + (y1 - y0) * t1;

    // Build a quadrilateral perpendicular to the gradient axis
    backend.setFillColor(color[0], color[1], color[2]);
    backend.beginPath();
    backend.moveTo(bx0 - perpX * perpExtent, by0 - perpY * perpExtent);
    backend.lineTo(bx0 + perpX * perpExtent, by0 + perpY * perpExtent);
    backend.lineTo(bx1 + perpX * perpExtent, by1 + perpY * perpExtent);
    backend.lineTo(bx1 - perpX * perpExtent, by1 - perpY * perpExtent);
    backend.closePath();
    backend.fill();
  }

  backend.restore();
}

// ============================================================================
// Radial Gradient Fill
// ============================================================================

/**
 * Render a radial gradient fill using RenderBackend methods.
 *
 * Draws 64 concentric circles (approximated via cubic Bezier curves)
 * from outside in, using `interpolateStops()` for color at each ring.
 */
export function renderRadialGradientFill(
  backend: RenderBackend,
  options: { centerX?: number; centerY?: number; stops: GradientStop[] },
  bounds: FillBounds,
): void {
  const { stops } = options;

  // Edge cases
  if (stops.length === 0) return;
  if (stops.length === 1) {
    const [r, g, b] = stops[0].color;
    backend.save();
    backend.setFillColor(r, g, b);
    backend.beginPath();
    backend.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    backend.fill();
    backend.restore();
    return;
  }

  const sortedStops = [...stops].sort((a, b) => a.position - b.position);

  const relCx = options.centerX ?? 0.5;
  const relCy = options.centerY ?? 0.5;
  const cx = bounds.x + relCx * bounds.width;
  const cy = bounds.y + relCy * bounds.height;

  // Max radius: distance from center to farthest corner
  const corners: [number, number][] = [
    [bounds.x, bounds.y],
    [bounds.x + bounds.width, bounds.y],
    [bounds.x, bounds.y + bounds.height],
    [bounds.x + bounds.width, bounds.y + bounds.height],
  ];
  const maxRadius = Math.max(
    ...corners.map(([px, py]) => Math.sqrt((px - cx) ** 2 + (py - cy) ** 2)),
  );

  backend.save();

  // Clip to bounds
  backend.beginPath();
  backend.rect(bounds.x, bounds.y, bounds.width, bounds.height);
  backend.clip();

  // Draw from outside in (so inner rings paint over outer rings)
  const numRings = 64;
  const k = 0.5522847498; // Bezier constant for circular arc approximation

  for (let i = numRings - 1; i >= 0; i--) {
    const t = (i + 0.5) / numRings;
    const radius = maxRadius * ((i + 1) / numRings);
    const color = interpolateStops(sortedStops, t);

    backend.setFillColor(color[0], color[1], color[2]);
    backend.beginPath();

    // Approximate circle with 4 cubic Bezier curves
    backend.moveTo(cx + radius, cy);
    backend.curveTo(cx + radius, cy + k * radius, cx + k * radius, cy + radius, cx, cy + radius);
    backend.curveTo(cx - k * radius, cy + radius, cx - radius, cy + k * radius, cx - radius, cy);
    backend.curveTo(cx - radius, cy - k * radius, cx - k * radius, cy - radius, cx, cy - radius);
    backend.curveTo(cx + k * radius, cy - radius, cx + radius, cy - k * radius, cx + radius, cy);
    backend.closePath();
    backend.fill();
  }

  backend.restore();
}

// ============================================================================
// Pattern Fill
// ============================================================================

/**
 * Render a pattern fill rectangle using RenderBackend methods.
 *
 * Supports all 18 Excel pattern types with proper Bayer-dithered gray
 * patterns and tiled line patterns matching pdf-graphics/pattern-fill.ts.
 */
export function renderPatternFillRect(
  backend: RenderBackend,
  patternType: ExcelPatternType,
  fgColor: [number, number, number],
  bgColor: [number, number, number],
  bounds: FillBounds,
): void {
  if (patternType === 'none') return;

  if (patternType === 'solid') {
    backend.save();
    backend.setFillColor(fgColor[0], fgColor[1], fgColor[2]);
    backend.beginPath();
    backend.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    backend.fill();
    backend.restore();
    return;
  }

  // 1. Fill background
  backend.save();
  backend.setFillColor(bgColor[0], bgColor[1], bgColor[2]);
  backend.beginPath();
  backend.rect(bounds.x, bounds.y, bounds.width, bounds.height);
  backend.fill();
  backend.restore();

  // 2. Draw foreground pattern marks (clipped to bounds)
  backend.save();
  backend.beginPath();
  backend.rect(bounds.x, bounds.y, bounds.width, bounds.height);
  backend.clip();

  backend.setFillColor(fgColor[0], fgColor[1], fgColor[2]);
  backend.setStrokeColor(fgColor[0], fgColor[1], fgColor[2]);

  const tilesX = Math.ceil(bounds.width / TILE_SIZE);
  const tilesY = Math.ceil(bounds.height / TILE_SIZE);

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const tileX = bounds.x + tx * TILE_SIZE;
      const tileY = bounds.y + ty * TILE_SIZE;
      renderPatternTile(backend, patternType, tileX, tileY);
    }
  }

  backend.restore();
}

// ── Pattern Tile Rendering ──────────────────────────────────────────────

function renderPatternTile(
  backend: RenderBackend,
  pattern: ExcelPatternType,
  ox: number,
  oy: number,
): void {
  const actions = getPatternActions(pattern);
  for (const action of actions) {
    switch (action.type) {
      case 'grayDots':
        renderGrayDots(backend, ox, oy, action.density);
        break;
      case 'horizontalLines':
        renderHorizontalLines(backend, ox, oy, action.lineWidth, action.spacing);
        break;
      case 'verticalLines':
        renderVerticalLines(backend, ox, oy, action.lineWidth, action.spacing);
        break;
      case 'diagonalDown':
        renderDiagonalDown(backend, ox, oy, action.lineWidth);
        break;
      case 'diagonalUp':
        renderDiagonalUp(backend, ox, oy, action.lineWidth);
        break;
    }
  }
}

// ── Gray Dots (Bayer dithering) ─────────────────────────────────────────

function renderGrayDots(backend: RenderBackend, ox: number, oy: number, density: number): void {
  const pixelSize = 1;
  const totalPixels = TILE_SIZE * TILE_SIZE;
  const filledCount = Math.round(totalPixels * density);

  let count = 0;
  let hasPixels = false;

  for (let py = 0; py < TILE_SIZE && count < filledCount; py++) {
    for (let px = 0; px < TILE_SIZE && count < filledCount; px++) {
      if (shouldFillPixel(px, py, density)) {
        if (!hasPixels) {
          backend.beginPath();
          hasPixels = true;
        }
        backend.rect(ox + px * pixelSize, oy + py * pixelSize, pixelSize, pixelSize);
        count++;
      }
    }
  }

  if (hasPixels) {
    backend.fill();
  }
}

// ── Line Patterns ───────────────────────────────────────────────────────

function renderHorizontalLines(
  backend: RenderBackend,
  ox: number,
  oy: number,
  lineWidth: number,
  spacing: number,
): void {
  backend.setLineWidth(lineWidth);
  backend.beginPath();
  for (let y = spacing / 2; y < TILE_SIZE; y += spacing) {
    backend.moveTo(ox, oy + y);
    backend.lineTo(ox + TILE_SIZE, oy + y);
  }
  backend.stroke();
}

function renderVerticalLines(
  backend: RenderBackend,
  ox: number,
  oy: number,
  lineWidth: number,
  spacing: number,
): void {
  backend.setLineWidth(lineWidth);
  backend.beginPath();
  for (let x = spacing / 2; x < TILE_SIZE; x += spacing) {
    backend.moveTo(ox + x, oy);
    backend.lineTo(ox + x, oy + TILE_SIZE);
  }
  backend.stroke();
}

function renderDiagonalDown(
  backend: RenderBackend,
  ox: number,
  oy: number,
  lineWidth: number,
): void {
  backend.setLineWidth(lineWidth);
  backend.beginPath();
  // Main diagonal
  backend.moveTo(ox, oy);
  backend.lineTo(ox + TILE_SIZE, oy + TILE_SIZE);
  // Wrap-around diagonals for seamless tiling
  backend.moveTo(ox + TILE_SIZE / 2, oy);
  backend.lineTo(ox + TILE_SIZE, oy + TILE_SIZE / 2);
  backend.moveTo(ox, oy + TILE_SIZE / 2);
  backend.lineTo(ox + TILE_SIZE / 2, oy + TILE_SIZE);
  backend.stroke();
}

function renderDiagonalUp(backend: RenderBackend, ox: number, oy: number, lineWidth: number): void {
  backend.setLineWidth(lineWidth);
  backend.beginPath();
  // Main diagonal (up)
  backend.moveTo(ox, oy + TILE_SIZE);
  backend.lineTo(ox + TILE_SIZE, oy);
  // Wrap-around diagonals for seamless tiling
  backend.moveTo(ox, oy + TILE_SIZE / 2);
  backend.lineTo(ox + TILE_SIZE / 2, oy);
  backend.moveTo(ox + TILE_SIZE / 2, oy + TILE_SIZE);
  backend.lineTo(ox + TILE_SIZE, oy + TILE_SIZE / 2);
  backend.stroke();
}
