/**
 * Shared Render Utilities
 *
 * Fill rendering, border rendering, gradient creation, and error placeholder
 * drawing. Used by all 8 object renderers.
 *
 * Ported from grid-canvas/src/layers/overlay/utils/fill-utils.ts and
 * border-utils.ts, adapted to use drawing-canvas SceneObject types.
 *
 * @module @mog/drawing-canvas/renderers/render-utils
 */

import { computeLinearGradientEndpoints, type Rect } from '@mog/canvas-engine';
import type { ObjectBorderConfig, ObjectFillConfig, SceneObjectBase } from '../scene/types';

// =============================================================================
// Fill Rendering
// =============================================================================

/**
 * Render a fill to the given bounds rectangle.
 */
export function renderFill(
  ctx: CanvasRenderingContext2D,
  bounds: Rect,
  fill: ObjectFillConfig,
): void {
  if (fill.type === 'none') return;

  if (fill.type === 'solid' && fill.color) {
    ctx.fillStyle = fill.color;
    ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  } else if (fill.type === 'gradient' && fill.gradient) {
    const gradient =
      fill.gradient.type === 'linear'
        ? createLinearGradient(ctx, bounds, fill.gradient)
        : createRadialGradient(ctx, bounds, fill.gradient);

    if (gradient) {
      ctx.fillStyle = gradient;
      ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
    }
  }
}

/**
 * Apply a fill style to the context without drawing.
 * Used for shapes where the fill is applied before a path operation.
 */
export function applyFillStyle(
  ctx: CanvasRenderingContext2D,
  bounds: Rect,
  fill: ObjectFillConfig,
): void {
  if (fill.type === 'none') return;

  if (fill.type === 'solid' && fill.color) {
    ctx.fillStyle = fill.color;
  } else if (fill.type === 'gradient' && fill.gradient) {
    const gradient =
      fill.gradient.type === 'linear'
        ? createLinearGradient(ctx, bounds, fill.gradient)
        : createRadialGradient(ctx, bounds, fill.gradient);

    if (gradient) {
      ctx.fillStyle = gradient;
    }
  }
}

// =============================================================================
// Gradient Creation
// =============================================================================

function createLinearGradient(
  ctx: CanvasRenderingContext2D,
  bounds: Rect,
  gradientConfig: NonNullable<ObjectFillConfig['gradient']>,
): CanvasGradient {
  const angle = gradientConfig.angle ?? 0;
  const rad = (angle * Math.PI) / 180;
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const { x1, y1, x2, y2 } = computeLinearGradientEndpoints(
    cx,
    cy,
    bounds.width,
    bounds.height,
    rad,
  );

  const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
  for (const stop of gradientConfig.stops) {
    gradient.addColorStop(stop.offset, stop.color);
  }
  return gradient;
}

function createRadialGradient(
  ctx: CanvasRenderingContext2D,
  bounds: Rect,
  gradientConfig: NonNullable<ObjectFillConfig['gradient']>,
): CanvasGradient {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const radius = Math.max(bounds.width, bounds.height) / 2;

  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  for (const stop of gradientConfig.stops) {
    gradient.addColorStop(stop.offset, stop.color);
  }
  return gradient;
}

// =============================================================================
// Border Rendering
// =============================================================================

/**
 * Render a rectangular border around bounds.
 */
export function renderBorder(
  ctx: CanvasRenderingContext2D,
  bounds: Rect,
  border: ObjectBorderConfig,
): void {
  ctx.strokeStyle = border.color;
  ctx.lineWidth = border.width;
  applyLineStyle(ctx, border.style);
  ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
}

/**
 * Apply line dash pattern based on style name.
 */
export function applyLineStyle(ctx: CanvasRenderingContext2D, style: string): void {
  switch (style) {
    case 'dashed':
      ctx.setLineDash([6, 3]);
      break;
    case 'dotted':
      ctx.setLineDash([2, 2]);
      break;
    case 'dashDot':
      ctx.setLineDash([6, 3, 2, 3]);
      break;
    case 'dashDotDot':
      ctx.setLineDash([6, 3, 2, 3, 2, 3]);
      break;
    case 'solid':
    default:
      ctx.setLineDash([]);
      break;
  }
}

// =============================================================================
// Placeholder Rendering
// =============================================================================

/**
 * Options for placeholder rendering style.
 */
export interface PlaceholderOptions {
  /** Background fill color */
  fill?: string;
  /** Border stroke color */
  stroke?: string;
  /** Label text color */
  textColor?: string;
  /** Font for the label text */
  font?: string;
  /** Corner radius (0 for square corners) */
  cornerRadius?: number;
}

/**
 * Render a styled placeholder rectangle with a centered label.
 *
 * Shared by error placeholders (square corners, lighter gray) and
 * empty/loading placeholders (rounded corners, custom fonts).
 */
export function renderPlaceholder(
  ctx: CanvasRenderingContext2D,
  bounds: Rect,
  label: string,
  options?: PlaceholderOptions,
): void {
  const fill = options?.fill ?? '#f0f0f0';
  const stroke = options?.stroke ?? '#cccccc';
  const textColor = options?.textColor ?? '#999999';
  const font = options?.font ?? '12px sans-serif';
  const cornerRadius = options?.cornerRadius ?? 0;

  ctx.save();

  // Background + border
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;

  if (cornerRadius > 0) {
    ctx.beginPath();
    ctx.roundRect(bounds.x, bounds.y, bounds.width, bounds.height, cornerRadius);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
  }

  // Label text
  ctx.fillStyle = textColor;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, bounds.width - 8);

  ctx.restore();
}

/**
 * Render a gray error placeholder when a renderer fails.
 * Per-renderer error boundary: one broken object doesn't kill the layer.
 */
export function renderErrorPlaceholder(
  ctx: CanvasRenderingContext2D,
  bounds: Rect,
  label: string,
): void {
  renderPlaceholder(ctx, bounds, label);
}

// =============================================================================
// Common Transform Helpers
// =============================================================================

/**
 * Apply rotation transform around the center of bounds.
 * Returns true if rotation was applied (caller should save/restore ctx).
 */
export function applyRotation(
  ctx: CanvasRenderingContext2D,
  bounds: Rect,
  rotationDegrees: number | undefined,
): boolean {
  if (!rotationDegrees) return false;

  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  ctx.translate(cx, cy);
  ctx.rotate((rotationDegrees * Math.PI) / 180);
  ctx.translate(-cx, -cy);
  return true;
}

/**
 * Apply flip transforms.
 */
export function applyFlip(
  ctx: CanvasRenderingContext2D,
  bounds: Rect,
  flipH: boolean | undefined,
  flipV: boolean | undefined,
): boolean {
  if (!flipH && !flipV) return false;

  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  ctx.translate(cx, cy);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.translate(-cx, -cy);
  return true;
}

// =============================================================================
// Render Context Wrapper
// =============================================================================

/**
 * Higher-order wrapper that handles the shared save/restore/rotate/flip/catch
 * boilerplate for all object renderers.
 *
 * - Saves the canvas context
 * - Applies rotation and flip transforms from the scene object
 * - Calls the renderer body
 * - Restores the context in a `finally` block (guaranteed even on throw)
 * - Catches errors and renders an error placeholder
 *
 * Visibility and opacity are NOT handled here — the dispatcher already
 * handles both (lines 49 and 52-56 of dispatcher.ts).
 */
export function withRenderContext(
  ctx: CanvasRenderingContext2D,
  obj: SceneObjectBase,
  label: string,
  renderBody: () => void,
): void {
  try {
    ctx.save();
    applyRotation(ctx, obj.bounds, obj.rotation);
    applyFlip(ctx, obj.bounds, obj.flipH, obj.flipV);
    renderBody();
  } catch (e) {
    console.warn(`[${label}] render error:`, e);
    renderErrorPlaceholder(ctx, obj.bounds, label);
  } finally {
    ctx.restore();
  }
}
