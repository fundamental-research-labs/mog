/**
 * Connection Point Indicator Rendering
 *
 * Renders blue dot indicators at available connection points on a shape
 * when the user is dragging a connector endpoint near that shape.
 * The snap target (nearest point within snap radius) is rendered as a
 * larger filled dot; other points are rendered as smaller outlined dots.
 *
 * @module @mog/canvas-overlay/connection-points
 */

import type { OverlayConfig } from './types';

// =============================================================================
// Constants
// =============================================================================

/** Radius of a normal (non-snapped) connection point indicator in CSS pixels. */
const INDICATOR_RADIUS = 4;

/** Radius of the snapped connection point indicator in CSS pixels. */
const SNAP_INDICATOR_RADIUS = 6;

/** Stroke width for connection point indicators. */
const INDICATOR_STROKE_WIDTH = 1.5;

// =============================================================================
// Types
// =============================================================================

/**
 * Connection point indicator data, sourced from OverlayDataSource.
 */
export interface ConnectionPointIndicators {
  /** All connection points on the target shape (screen-space positions). */
  readonly points: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  /** The connection point closest to the cursor within snap radius, or null. */
  readonly snapTarget: { readonly x: number; readonly y: number } | null;
}

// =============================================================================
// Renderer
// =============================================================================

/**
 * Render connection point indicators on the overlay canvas.
 *
 * Draws small blue circles at each connection point position. The snap
 * target (if any) is drawn larger and filled; other points are drawn
 * as outlines only.
 *
 * @param ctx - Canvas 2D rendering context (screen-space, CSS pixels).
 * @param indicators - Connection point positions and snap target.
 * @param config - Overlay configuration for theming (uses selectionColor).
 */
export function renderConnectionPointIndicators(
  ctx: CanvasRenderingContext2D,
  indicators: ConnectionPointIndicators,
  config: Pick<OverlayConfig, 'selectionColor'>,
): void {
  const color = config.selectionColor;

  ctx.save();
  ctx.setLineDash([]);

  // Draw non-snapped points as outlined circles
  for (const pt of indicators.points) {
    // Skip the snap target -- it is drawn separately below
    if (
      indicators.snapTarget &&
      pt.x === indicators.snapTarget.x &&
      pt.y === indicators.snapTarget.y
    ) {
      continue;
    }

    ctx.beginPath();
    ctx.arc(pt.x, pt.y, INDICATOR_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = INDICATOR_STROKE_WIDTH;
    ctx.stroke();
  }

  // Draw snap target as a larger filled circle
  if (indicators.snapTarget) {
    ctx.beginPath();
    ctx.arc(
      indicators.snapTarget.x,
      indicators.snapTarget.y,
      SNAP_INDICATOR_RADIUS,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = INDICATOR_STROKE_WIDTH;
    ctx.stroke();
  }

  ctx.restore();
}
