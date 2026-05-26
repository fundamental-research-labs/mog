/**
 * Border Renderer — maps all 13 Excel border styles to PDF ContentOp sequences.
 *
 * Each border style maps to a specific line width + dash pattern combination.
 * Special handling for:
 * - Double borders (two parallel lines offset by 1.5pt)
 * - Diagonal borders (up, down, both)
 * - SlantDashDot (dash-dot with slant effect)
 */

import type { ContentOp } from './content-ops';
import { lineCapToInt, lineJoinToInt } from './content-ops';
import type { RenderBackend } from './render-backend';

/**
 * All 13 Excel border styles.
 */
export type ExcelBorderStyle =
  | 'thin'
  | 'medium'
  | 'thick'
  | 'hair'
  | 'dashed'
  | 'dotted'
  | 'double'
  | 'dashDot'
  | 'dashDotDot'
  | 'mediumDashed'
  | 'mediumDashDot'
  | 'mediumDashDotDot'
  | 'slantDashDot';

/**
 * Configuration for a single border.
 */
export interface BorderConfig {
  style: ExcelBorderStyle;
  color: [number, number, number];
}

/**
 * Bounding rectangle for diagonal border rendering.
 */
export interface BorderBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Get the line width in points for an Excel border style.
 */
export function getBorderLineWidth(style: ExcelBorderStyle): number {
  switch (style) {
    case 'hair':
      return 0.25;
    case 'thin':
    case 'dashed':
    case 'dotted':
    case 'dashDot':
    case 'dashDotDot':
    case 'slantDashDot':
    case 'double':
      return 0.5;
    case 'medium':
    case 'mediumDashed':
    case 'mediumDashDot':
    case 'mediumDashDotDot':
      return 1;
    case 'thick':
      return 1.5;
  }
}

/**
 * Get the dash pattern for an Excel border style.
 * Returns null for solid (non-dashed) styles.
 */
export function getBorderDashPattern(
  style: ExcelBorderStyle,
): { segments: number[]; phase: number } | null {
  switch (style) {
    case 'thin':
    case 'medium':
    case 'thick':
    case 'hair':
    case 'double':
      return null; // Solid line

    case 'dashed':
      return { segments: [4, 4], phase: 0 };

    case 'dotted':
      return { segments: [1, 2], phase: 0 };

    case 'dashDot':
      return { segments: [4, 2, 1, 2], phase: 0 };

    case 'dashDotDot':
      return { segments: [4, 2, 1, 2, 1, 2], phase: 0 };

    case 'mediumDashed':
      return { segments: [6, 3], phase: 0 };

    case 'mediumDashDot':
      return { segments: [6, 3, 1, 3], phase: 0 };

    case 'mediumDashDotDot':
      return { segments: [6, 3, 1, 3, 1, 3], phase: 0 };

    case 'slantDashDot':
      return { segments: [4, 2, 1, 2], phase: 0 };
  }
}

/**
 * Render a single border side as ContentOps.
 * Handles all 13 styles including double border.
 */
export function renderBorderSide(
  backend: RenderBackend,
  style: ExcelBorderStyle,
  color: [number, number, number],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  if (style === 'double') {
    const isHorizontal = Math.abs(y2 - y1) < Math.abs(x2 - x1);
    renderDoubleBorder(backend, color, x1, y1, x2, y2, isHorizontal);
    return;
  }

  backend.save();

  const [r, g, b] = color;
  backend.setStrokeColor(r, g, b);
  backend.setLineWidth(getBorderLineWidth(style));

  const dashPattern = getBorderDashPattern(style);
  if (dashPattern) {
    backend.setLineDash(dashPattern.segments, dashPattern.phase);
  } else {
    backend.setLineDash([], 0);
  }

  backend.setLineCap('butt');
  backend.setLineJoin('miter');

  backend.moveTo(x1, y1);
  backend.lineTo(x2, y2);
  backend.stroke();

  backend.restore();
}

/**
 * Render a double border: two parallel 0.5pt lines offset by 1.5pt.
 */
export function renderDoubleBorder(
  backend: RenderBackend,
  color: [number, number, number],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  isHorizontal: boolean,
): void {
  const offset = 0.75; // Half of 1.5pt total gap
  const [r, g, b] = color;

  backend.save();
  backend.setStrokeColor(r, g, b);
  backend.setLineWidth(0.5);
  backend.setLineDash([], 0);
  backend.setLineCap('butt');
  backend.setLineJoin('miter');

  if (isHorizontal) {
    // Two horizontal lines offset vertically
    backend.moveTo(x1, y1 - offset);
    backend.lineTo(x2, y2 - offset);
    backend.stroke();

    backend.moveTo(x1, y1 + offset);
    backend.lineTo(x2, y2 + offset);
    backend.stroke();
  } else {
    // Two vertical lines offset horizontally
    backend.moveTo(x1 - offset, y1);
    backend.lineTo(x2 - offset, y2);
    backend.stroke();

    backend.moveTo(x1 + offset, y1);
    backend.lineTo(x2 + offset, y2);
    backend.stroke();
  }

  backend.restore();
}

/**
 * Render a diagonal border (up or down) within a bounding rectangle.
 * Handles double style specially by drawing two offset parallel diagonal lines.
 */
export function renderDiagonalBorder(
  backend: RenderBackend,
  config: BorderConfig,
  bounds: BorderBounds,
  direction: 'up' | 'down',
): void {
  const { x, y, width, height } = bounds;
  const [r, g, b] = config.color;

  backend.save();
  backend.setStrokeColor(r, g, b);

  if (config.style === 'double') {
    // Double diagonal: two parallel diagonals offset by 1.5pt
    backend.setLineWidth(0.5);
    backend.setLineDash([], 0);
    backend.setLineCap('butt');
    backend.setLineJoin('miter');

    const offset = 1.5;
    if (direction === 'down') {
      backend.moveTo(x + offset, y);
      backend.lineTo(x + width, y + height - offset);
      backend.stroke();

      backend.moveTo(x, y + offset);
      backend.lineTo(x + width - offset, y + height);
      backend.stroke();
    } else {
      backend.moveTo(x, y + height - offset);
      backend.lineTo(x + width - offset, y);
      backend.stroke();

      backend.moveTo(x + offset, y + height);
      backend.lineTo(x + width, y + offset);
      backend.stroke();
    }
  } else {
    backend.setLineWidth(getBorderLineWidth(config.style));

    const dashPattern = getBorderDashPattern(config.style);
    if (dashPattern) {
      backend.setLineDash(dashPattern.segments, dashPattern.phase);
    } else {
      backend.setLineDash([], 0);
    }

    backend.setLineCap('butt');
    backend.setLineJoin('miter');

    if (direction === 'down') {
      // Top-left to bottom-right
      backend.moveTo(x, y);
      backend.lineTo(x + width, y + height);
    } else {
      // Bottom-left to top-right
      backend.moveTo(x, y + height);
      backend.lineTo(x + width, y);
    }

    backend.stroke();
  }

  backend.restore();
}

/**
 * Generate ContentOps directly for a border side (for testing without a RenderBackend).
 */
export function generateBorderOps(
  style: ExcelBorderStyle,
  color: [number, number, number],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): ContentOp[] {
  if (style === 'double') {
    return generateDoubleBorderOps(color, x1, y1, x2, y2, Math.abs(y2 - y1) < Math.abs(x2 - x1));
  }

  const ops: ContentOp[] = [];
  const [r, g, b] = color;

  ops.push({ op: 'SaveState' });
  ops.push({ op: 'SetStrokeColorRGB', r, g, b });
  ops.push({ op: 'SetLineWidth', width: getBorderLineWidth(style) });

  const dashPattern = getBorderDashPattern(style);
  if (dashPattern) {
    ops.push({ op: 'SetLineDash', segments: dashPattern.segments, phase: dashPattern.phase });
  } else {
    ops.push({ op: 'SetLineDash', segments: [], phase: 0 });
  }

  ops.push({ op: 'SetLineCap', cap: lineCapToInt('butt') });
  ops.push({ op: 'SetLineJoin', join: lineJoinToInt('miter') });
  ops.push({ op: 'MoveTo', x: x1, y: y1 });
  ops.push({ op: 'LineTo', x: x2, y: y2 });
  ops.push({ op: 'Stroke' });
  ops.push({ op: 'RestoreState' });

  return ops;
}

/**
 * Generate ContentOps for a double border.
 */
function generateDoubleBorderOps(
  color: [number, number, number],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  isHorizontal: boolean,
): ContentOp[] {
  const offset = 0.75;
  const [r, g, b] = color;
  const ops: ContentOp[] = [];

  ops.push({ op: 'SaveState' });
  ops.push({ op: 'SetStrokeColorRGB', r, g, b });
  ops.push({ op: 'SetLineWidth', width: 0.5 });
  ops.push({ op: 'SetLineDash', segments: [], phase: 0 });
  ops.push({ op: 'SetLineCap', cap: lineCapToInt('butt') });
  ops.push({ op: 'SetLineJoin', join: lineJoinToInt('miter') });

  if (isHorizontal) {
    ops.push({ op: 'MoveTo', x: x1, y: y1 - offset });
    ops.push({ op: 'LineTo', x: x2, y: y2 - offset });
    ops.push({ op: 'Stroke' });
    ops.push({ op: 'MoveTo', x: x1, y: y1 + offset });
    ops.push({ op: 'LineTo', x: x2, y: y2 + offset });
    ops.push({ op: 'Stroke' });
  } else {
    ops.push({ op: 'MoveTo', x: x1 - offset, y: y1 });
    ops.push({ op: 'LineTo', x: x2 - offset, y: y2 });
    ops.push({ op: 'Stroke' });
    ops.push({ op: 'MoveTo', x: x1 + offset, y: y1 });
    ops.push({ op: 'LineTo', x: x2 + offset, y: y2 });
    ops.push({ op: 'Stroke' });
  }

  ops.push({ op: 'RestoreState' });
  return ops;
}

/**
 * All border styles as an array for iteration.
 */
export const ALL_BORDER_STYLES: ExcelBorderStyle[] = [
  'thin',
  'medium',
  'thick',
  'hair',
  'dashed',
  'dotted',
  'double',
  'dashDot',
  'dashDotDot',
  'mediumDashed',
  'mediumDashDot',
  'mediumDashDotDot',
  'slantDashDot',
];
