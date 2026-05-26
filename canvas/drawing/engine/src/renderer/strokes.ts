/**
 * Stroke rendering primitives.
 *
 * Renders DrawingStroke to Canvas2D contexts and generates SVG stroke attributes.
 * Supports dash patterns, line caps/joins, and compound stroke styles.
 */
import type { DashStyle, DrawingStroke } from '@mog-sdk/contracts/drawing';
import type { Path } from '@mog-sdk/contracts/geometry';
import { replayPathToCanvas } from './path';

// ─── Dash Patterns ──────────────────────────────────────────────────────────

/** Named dash pattern -> concrete dash array values (relative to stroke width). */
const DASH_PATTERNS: Record<DashStyle, number[]> = {
  solid: [],
  dash: [4, 3],
  dot: [1, 3],
  dashDot: [4, 3, 1, 3],
  dashDotDot: [4, 3, 1, 3, 1, 3],
  longDash: [8, 3],
  longDashDot: [8, 3, 1, 3],
  longDashDotDot: [8, 3, 1, 3, 1, 3],
};

// ─── Canvas Stroke Rendering ────────────────────────────────────────────────

/**
 * Render a compound stroke (double, thickThin, thinThick, triple).
 *
 * True compound line rendering requires offsetting paths, which is complex.
 * This is a simplified approximation that strokes at reduced widths.
 */
function renderCompoundStroke(stroke: DrawingStroke, ctx: CanvasRenderingContext2D): void {
  const totalWidth = stroke.width;

  switch (stroke.compound) {
    case 'double': {
      // Two thin lines with gap -- simplified to a single thinner stroke
      ctx.lineWidth = totalWidth * 0.3;
      ctx.stroke();
      break;
    }
    case 'thickThin': {
      ctx.lineWidth = totalWidth * 0.6;
      ctx.stroke();
      break;
    }
    case 'thinThick': {
      ctx.lineWidth = totalWidth * 0.6;
      ctx.stroke();
      break;
    }
    case 'triple': {
      ctx.lineWidth = totalWidth * 0.25;
      ctx.stroke();
      break;
    }
  }
}

/**
 * Apply a DrawingStroke to a Canvas2D context and stroke the given path.
 */
export function renderStrokeToCanvas(
  stroke: DrawingStroke,
  geometry: Path,
  ctx: CanvasRenderingContext2D,
): void {
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.width;

  if (stroke.opacity !== undefined) ctx.globalAlpha = stroke.opacity;

  // Map 'flat' cap to Canvas2D 'butt'
  if (stroke.cap) {
    ctx.lineCap = stroke.cap === 'flat' ? 'butt' : stroke.cap;
  }

  if (stroke.join) {
    ctx.lineJoin = stroke.join;
  }

  // Dash pattern (scaled by stroke width)
  if (stroke.dash && stroke.dash !== 'solid') {
    const pattern = DASH_PATTERNS[stroke.dash] || [];
    ctx.setLineDash(pattern.map((v) => v * stroke.width));
  } else {
    ctx.setLineDash([]);
  }

  ctx.beginPath();
  replayPathToCanvas(geometry, ctx);

  // Compound lines (double, triple, etc.)
  if (stroke.compound && stroke.compound !== 'single') {
    renderCompoundStroke(stroke, ctx);
  } else {
    ctx.stroke();
  }

  // Reset state
  if (stroke.opacity !== undefined) ctx.globalAlpha = 1;
  ctx.setLineDash([]);
}

// ─── SVG Stroke Attributes ──────────────────────────────────────────────────

/**
 * Generate SVG stroke attributes for a DrawingStroke.
 */
export function strokeToSVGAttributes(stroke: DrawingStroke): Record<string, string> {
  const attrs: Record<string, string> = {
    stroke: stroke.color,
    'stroke-width': String(stroke.width),
  };

  if (stroke.opacity !== undefined) {
    attrs['stroke-opacity'] = String(stroke.opacity);
  }

  // Map 'flat' cap to SVG 'butt'
  if (stroke.cap) {
    attrs['stroke-linecap'] = stroke.cap === 'flat' ? 'butt' : stroke.cap;
  }

  if (stroke.join) {
    attrs['stroke-linejoin'] = stroke.join;
  }

  if (stroke.dash && stroke.dash !== 'solid') {
    const pattern = DASH_PATTERNS[stroke.dash] || [];
    attrs['stroke-dasharray'] = pattern.map((v) => v * stroke.width).join(' ');
  }

  return attrs;
}
