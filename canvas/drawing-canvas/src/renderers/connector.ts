/**
 * Connector Renderer
 *
 * Renders ConnectorScene objects: straight lines, elbow (bent) connectors,
 * and curved connectors between shapes. Handles outline styling (color,
 * width, dash pattern) and arrow-head decorations at both ends.
 *
 * Pure function with per-object error boundary.
 *
 * @module @mog/drawing-canvas/renderers/connector
 */

import type { Rect } from '@mog/canvas-engine';
import type { HitMap } from '../hit-testing/hit-map';
import type { ConnectorScene, LineEndSize, LineEndType } from '../scene/types';
import { applyLineStyle, withRenderContext } from './render-utils';

// =============================================================================
// Constants
// =============================================================================

/** Default connector line color when no outline is specified. */
const DEFAULT_STROKE_COLOR = '#4472C4';

/** Default connector line width in pixels. */
const DEFAULT_STROKE_WIDTH = 1;

/** Base arrow head length in pixels (scaled by LineEndSize). */
const BASE_ARROW_LENGTH = 9;

/** Base arrow head width (half-width) in pixels (scaled by LineEndSize). */
const BASE_ARROW_HALF_WIDTH = 5;

// =============================================================================
// Line End Size Multipliers
// =============================================================================

function sizeMultiplier(size: LineEndSize | undefined): number {
  switch (size) {
    case 'sm':
      return 0.6;
    case 'lg':
      return 1.4;
    case 'med':
    default:
      return 1.0;
  }
}

// =============================================================================
// Arrow Head Drawing
// =============================================================================

/**
 * Draw an arrowhead at the given point, pointing in the direction of `angle`.
 * `angle` is in radians, measured from the positive X axis.
 */
export function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  endType: LineEndType,
  widthSize: LineEndSize | undefined,
  lengthSize: LineEndSize | undefined,
): void {
  if (endType === 'none') return;

  const wMul = sizeMultiplier(widthSize);
  const lMul = sizeMultiplier(lengthSize);
  const arrowLen = BASE_ARROW_LENGTH * lMul;
  const arrowHalf = BASE_ARROW_HALF_WIDTH * wMul;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  switch (endType) {
    case 'triangle':
    case 'stealth': {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-arrowLen, -arrowHalf);
      ctx.lineTo(-arrowLen, arrowHalf);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'arrow': {
      // Open arrow (no fill, just stroked lines)
      ctx.beginPath();
      ctx.moveTo(-arrowLen, -arrowHalf);
      ctx.lineTo(0, 0);
      ctx.lineTo(-arrowLen, arrowHalf);
      ctx.stroke();
      break;
    }
    case 'diamond': {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-arrowLen / 2, -arrowHalf);
      ctx.lineTo(-arrowLen, 0);
      ctx.lineTo(-arrowLen / 2, arrowHalf);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'oval': {
      ctx.beginPath();
      ctx.ellipse(-arrowLen / 2, 0, arrowLen / 2, arrowHalf, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default:
      break;
  }

  ctx.restore();
}

// =============================================================================
// Connector Path Helpers
// =============================================================================

/**
 * Compute start and end points from bounds.
 * Connectors go from top-left to bottom-right by default.
 */
function getEndpoints(bounds: Rect): { x1: number; y1: number; x2: number; y2: number } {
  return {
    x1: bounds.x,
    y1: bounds.y,
    x2: bounds.x + bounds.width,
    y2: bounds.y + bounds.height,
  };
}

/**
 * Draw a straight connector line.
 */
function drawStraightConnector(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/**
 * Draw a bent (elbow) connector with a single midpoint.
 * Goes horizontally first, then vertically.
 */
function drawBentConnector(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  const midX = (x1 + x2) / 2;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(midX, y1);
  ctx.lineTo(midX, y2);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/**
 * Draw a curved connector using a quadratic bezier.
 */
function drawCurvedConnector(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  const cpx = (x1 + x2) / 2;
  const cpy = (y1 + y2) / 2;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(cpx, y1, cpx, cpy);
  ctx.quadraticCurveTo(cpx, y2, x2, y2);
  ctx.stroke();
}

// =============================================================================
// Connector Renderer
// =============================================================================

/**
 * Render a ConnectorScene object to a Canvas2D context.
 *
 * Pipeline:
 * 1. Apply rotation and flip transforms
 * 2. Apply outline styling (color, width, dash pattern)
 * 3. Draw connector path based on shape type (straight, bent, curved)
 * 4. Draw arrow heads at start (tailEnd) and end (headEnd) if present
 */
export function renderConnector(
  ctx: CanvasRenderingContext2D,
  obj: ConnectorScene,
  hitMap: HitMap | null,
): void {
  withRenderContext(ctx, obj, 'Connector', () => {
    // Apply outline styling
    const outline = obj.data.outline;
    const strokeColor = outline?.color ?? DEFAULT_STROKE_COLOR;
    const strokeWidth = outline?.width ?? DEFAULT_STROKE_WIDTH;
    const strokeStyle = outline?.style ?? 'solid';

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    applyLineStyle(ctx, strokeStyle);

    // Compute endpoints
    const { x1, y1, x2, y2 } = getEndpoints(obj.bounds);

    // Draw connector path based on shape type
    const shapeType = obj.data.shapeType.toLowerCase();
    if (shapeType.includes('curved')) {
      drawCurvedConnector(ctx, x1, y1, x2, y2);
    } else if (shapeType.includes('bent') || shapeType.includes('elbow')) {
      drawBentConnector(ctx, x1, y1, x2, y2);
    } else {
      // Default: straight connector
      drawStraightConnector(ctx, x1, y1, x2, y2);
    }

    // Clear dash for arrow heads (always solid)
    ctx.setLineDash([]);

    // Draw arrow heads
    const angle = Math.atan2(y2 - y1, x2 - x1);

    if (obj.data.headEnd && obj.data.headEnd.type !== 'none') {
      ctx.fillStyle = strokeColor;
      drawArrowHead(
        ctx,
        x2,
        y2,
        angle,
        obj.data.headEnd.type,
        obj.data.headEnd.width,
        obj.data.headEnd.length,
      );
    }

    if (obj.data.tailEnd && obj.data.tailEnd.type !== 'none') {
      ctx.fillStyle = strokeColor;
      // Tail end points in the opposite direction
      drawArrowHead(
        ctx,
        x1,
        y1,
        angle + Math.PI,
        obj.data.tailEnd.type,
        obj.data.tailEnd.width,
        obj.data.tailEnd.length,
      );
    }

    // Register a bounding-box Path2D for hit testing.
    // Connectors are thin lines, so we use the bounding box as the hit region.
    if (hitMap) {
      const b = obj.bounds;
      const hitPath = new Path2D();
      hitPath.rect(b.x, b.y, b.width, b.height);
      hitMap.registerBody(obj.id, hitPath);
    }
  });
}
