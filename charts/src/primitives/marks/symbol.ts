/**
 * Symbol mark - for scatter plots, data points.
 *
 * Supports multiple shapes: circle, square, diamond, cross, triangle-up, triangle-down.
 * Pure functions, no side effects outside canvas drawing.
 */

import type { SymbolMark, SymbolShape } from '../types';
import { applyStyle } from './rect';

/**
 * Create a symbol mark.
 *
 * @param props - Symbol properties (excluding type)
 * @returns Complete SymbolMark
 */
export function createSymbol(props: Omit<SymbolMark, 'type'>): SymbolMark {
  return { type: 'symbol', ...props };
}

/**
 * Calculate the radius of a symbol from its area.
 * For non-circular shapes, this is the "effective radius" used for sizing.
 */
export function sizeToRadius(size: number): number {
  // Size is area in square pixels
  // For a circle: area = PI * r^2, so r = sqrt(area / PI)
  return Math.sqrt(size / Math.PI);
}

/**
 * Draw a circle symbol.
 */
function drawCircle(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const radius = sizeToRadius(size);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, 2 * Math.PI);
  ctx.closePath();
}

/**
 * Draw a square symbol.
 */
function drawSquare(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  // For a square with the same area as a circle of that size
  const side = Math.sqrt(size);
  const halfSide = side / 2;
  ctx.beginPath();
  ctx.rect(x - halfSide, y - halfSide, side, side);
  ctx.closePath();
}

/**
 * Draw a diamond symbol.
 */
function drawDiamond(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  // Diamond inscribed in a square of the same area
  const side = Math.sqrt(size);
  const halfDiag = (side * Math.sqrt(2)) / 2;
  ctx.beginPath();
  ctx.moveTo(x, y - halfDiag); // Top
  ctx.lineTo(x + halfDiag, y); // Right
  ctx.lineTo(x, y + halfDiag); // Bottom
  ctx.lineTo(x - halfDiag, y); // Left
  ctx.closePath();
}

/**
 * Draw a cross (plus) symbol.
 */
function drawCross(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const radius = sizeToRadius(size) * 1.2; // Make cross slightly larger for visual balance
  const armWidth = radius * 0.35;

  ctx.beginPath();
  // Horizontal arm
  ctx.rect(x - radius, y - armWidth / 2, radius * 2, armWidth);
  // Vertical arm (using moveTo/lineTo for proper union)
  ctx.moveTo(x - armWidth / 2, y - radius);
  ctx.lineTo(x + armWidth / 2, y - radius);
  ctx.lineTo(x + armWidth / 2, y + radius);
  ctx.lineTo(x - armWidth / 2, y + radius);
  ctx.closePath();
}

/**
 * Draw an upward-pointing triangle symbol.
 */
function drawTriangleUp(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  // Equilateral triangle with the given area
  // Area of equilateral triangle = (sqrt(3)/4) * side^2
  // So side = sqrt(4 * area / sqrt(3))
  const side = Math.sqrt((4 * size) / Math.sqrt(3));
  const height = (side * Math.sqrt(3)) / 2;

  // Center the triangle vertically
  const yOffset = height / 3; // Centroid is 1/3 from base

  ctx.beginPath();
  ctx.moveTo(x, y - height + yOffset); // Top vertex
  ctx.lineTo(x + side / 2, y + yOffset); // Bottom right
  ctx.lineTo(x - side / 2, y + yOffset); // Bottom left
  ctx.closePath();
}

/**
 * Draw a downward-pointing triangle symbol.
 */
function drawTriangleDown(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  // Same as triangle-up but flipped
  const side = Math.sqrt((4 * size) / Math.sqrt(3));
  const height = (side * Math.sqrt(3)) / 2;
  const yOffset = height / 3;

  ctx.beginPath();
  ctx.moveTo(x, y + height - yOffset); // Bottom vertex
  ctx.lineTo(x + side / 2, y - yOffset); // Top right
  ctx.lineTo(x - side / 2, y - yOffset); // Top left
  ctx.closePath();
}

/**
 * Draw a symbol shape to canvas.
 */
export function drawSymbolShape(
  ctx: CanvasRenderingContext2D,
  shape: SymbolShape,
  x: number,
  y: number,
  size: number,
): void {
  switch (shape) {
    case 'circle':
      drawCircle(ctx, x, y, size);
      break;
    case 'square':
      drawSquare(ctx, x, y, size);
      break;
    case 'diamond':
      drawDiamond(ctx, x, y, size);
      break;
    case 'cross':
      drawCross(ctx, x, y, size);
      break;
    case 'triangle-up':
      drawTriangleUp(ctx, x, y, size);
      break;
    case 'triangle-down':
      drawTriangleDown(ctx, x, y, size);
      break;
  }
}

/**
 * Render a symbol mark to canvas.
 *
 * @param ctx - Canvas 2D rendering context
 * @param mark - Symbol mark to render
 */
export function renderSymbol(ctx: CanvasRenderingContext2D, mark: SymbolMark): void {
  ctx.save();
  applyStyle(ctx, mark.style);

  drawSymbolShape(ctx, mark.shape, mark.x, mark.y, mark.size);

  if (mark.style.fill) {
    ctx.fill();
  }
  if (mark.style.stroke) {
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Check if a point is inside a symbol mark.
 * Uses a circular approximation for all shapes.
 *
 * @param mark - Symbol mark
 * @param px - Point x coordinate
 * @param py - Point y coordinate
 * @returns True if point is inside the symbol
 */
export function hitTestSymbol(mark: SymbolMark, px: number, py: number): boolean {
  const dx = px - mark.x;
  const dy = py - mark.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const radius = sizeToRadius(mark.size);

  // Add a small padding for easier clicking
  return distance <= radius * 1.2;
}

/**
 * Get all available symbol shapes.
 */
export function getSymbolShapes(): SymbolShape[] {
  return ['circle', 'square', 'diamond', 'cross', 'triangle-up', 'triangle-down'];
}

/**
 * Get the default symbol size (in square pixels).
 */
export function defaultSymbolSize(): number {
  return 64; // ~4.5px radius for circle
}

/**
 * Create symbol marks for a scatter plot from data points.
 *
 * @param points - Array of [x, y] coordinates
 * @param shape - Symbol shape
 * @param size - Symbol size (area in square pixels)
 * @param color - Fill color
 * @param data - Optional data array for datum property
 * @returns Array of symbol marks
 */
export function createScatterSymbols(
  points: [number, number][],
  shape: SymbolShape = 'circle',
  size: number = 64,
  color: string = '#4e79a7',
  data?: unknown[],
): SymbolMark[] {
  return points.map((point, i) =>
    createSymbol({
      x: point[0],
      y: point[1],
      shape,
      size,
      datum: data ? data[i] : { x: point[0], y: point[1], index: i },
      style: {
        fill: color,
        stroke: '#ffffff',
        strokeWidth: 1,
        opacity: 0.8,
      },
    }),
  );
}
