/**
 * Fill rendering primitives.
 *
 * Renders DrawingFill to Canvas2D contexts and generates SVG fill attributes.
 * Supports solid, linear-gradient, radial-gradient, pattern (simplified),
 * and image fills.
 */
import { computeLinearGradientEndpoints, parseHex } from '@mog/canvas-engine';
import type { DrawingFill, GradientStop } from '@mog-sdk/contracts/drawing';
import type { Path } from '@mog-sdk/contracts/geometry';
import { computePathBounds, replayPathToCanvas } from './path';

// ─── Canvas Fill Rendering ──────────────────────────────────────────────────

/**
 * Apply per-stop opacity by blending the alpha channel into the color string.
 * For stops with opacity < 1, parses the hex color and returns an rgba() string.
 * For named colors or non-hex formats, wraps in rgba() if possible.
 */
export function applyStopOpacity(stop: GradientStop): string {
  if (stop.opacity === undefined || stop.opacity === 1) return stop.color;

  const parsed = parseHex(stop.color);
  if (parsed) {
    return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${stop.opacity})`;
  }

  // For non-hex colors (named colors, rgb(), etc.), return as-is.
  // A full implementation would parse all CSS color formats.
  return stop.color;
}

/**
 * Apply a DrawingFill to a Canvas2D context and fill the given path.
 * Calls beginPath + replayPathToCanvas + fill (or clip for images).
 */
export function renderFillToCanvas(
  fill: DrawingFill,
  geometry: Path,
  ctx: CanvasRenderingContext2D,
): void {
  if (fill.type === 'none') return;

  ctx.beginPath();
  replayPathToCanvas(geometry, ctx);

  switch (fill.type) {
    case 'solid': {
      ctx.fillStyle = fill.color;
      if (fill.opacity !== undefined) ctx.globalAlpha = fill.opacity;
      ctx.fill();
      if (fill.opacity !== undefined) ctx.globalAlpha = 1;
      break;
    }
    case 'linear-gradient': {
      const bounds = computePathBounds(geometry);
      // Compute start/end points from angle + bounds center
      // angle=0 -> left-to-right, angle=90 -> top-to-bottom
      const rad = (fill.angle * Math.PI) / 180;
      const cx = bounds.x + bounds.width / 2;
      const cy = bounds.y + bounds.height / 2;
      const { x1, y1, x2, y2 } = computeLinearGradientEndpoints(
        cx,
        cy,
        bounds.width,
        bounds.height,
        rad,
      );
      const grad = ctx.createLinearGradient(x1, y1, x2, y2);
      for (const stop of fill.stops) {
        grad.addColorStop(stop.offset, applyStopOpacity(stop));
      }
      ctx.fillStyle = grad;
      ctx.fill();
      break;
    }
    case 'radial-gradient': {
      // Canvas createRadialGradient only supports circular gradients.
      // To render an elliptical gradient, we scale one axis via a transform.
      const scaleX = fill.radiusX / fill.radiusY;
      ctx.save();
      // Scale the x-axis so the circular gradient becomes elliptical
      ctx.translate(fill.centerX, 0);
      ctx.scale(scaleX, 1);
      ctx.translate(-fill.centerX, 0);
      // Create a circular gradient using radiusY as the radius
      const grad = ctx.createRadialGradient(
        fill.centerX,
        fill.centerY,
        0,
        fill.centerX,
        fill.centerY,
        fill.radiusY,
      );
      for (const stop of fill.stops) {
        grad.addColorStop(stop.offset, applyStopOpacity(stop));
      }
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.restore();
      break;
    }
    case 'pattern': {
      // Pattern fills are complex (need to create CanvasPattern from rendered
      // pattern tile). For now, use foreground color as solid fill.
      ctx.fillStyle = fill.foreground;
      ctx.fill();
      break;
    }
    case 'image': {
      // Image fills require pre-loaded HTMLImageElement.
      // Skip for now -- caller handles image loading.
      break;
    }
    default: {
      // Exhaustive check: ensures all DrawingFill types are handled above.
      // If a new fill type is added to DrawingFill, TypeScript will error here.
      const _exhaustive: never = fill;
      void _exhaustive;
      break;
    }
  }
}

// ─── SVG Fill Attributes ────────────────────────────────────────────────────

/**
 * Generate SVG fill attributes for a DrawingFill.
 * Returns attrs to set on the SVG element and optional defs for gradients.
 *
 * @param fill - The fill definition.
 * @param defId - Unique ID for gradient/pattern defs elements.
 */
export function fillToSVGAttributes(
  fill: DrawingFill,
  defId: string,
): { attrs: Record<string, string>; defs?: string } {
  switch (fill.type) {
    case 'none':
      return { attrs: { fill: 'none' } };

    case 'solid': {
      const attrs: Record<string, string> = { fill: fill.color };
      if (fill.opacity !== undefined) attrs['fill-opacity'] = String(fill.opacity);
      return { attrs };
    }

    case 'linear-gradient': {
      const stops = fill.stops
        .map((s) => {
          const opAttr = s.opacity !== undefined ? ` stop-opacity="${s.opacity}"` : '';
          return `<stop offset="${s.offset}" stop-color="${s.color}"${opAttr}/>`;
        })
        .join('');
      // Compute proper x1/y1/x2/y2 endpoints matching the Canvas computation.
      // Uses default gradientUnits="objectBoundingBox" with 0-1 normalized coordinates.
      // angle=0 -> left-to-right, angle=90 -> top-to-bottom
      const rad = (fill.angle * Math.PI) / 180;
      const cosA = Math.cos(rad);
      const sinA = Math.sin(rad);
      // Project the gradient onto a 0-1 bounding box, then compute endpoints
      const x1 = (0.5 - cosA * 0.5).toFixed(4);
      const y1 = (0.5 - sinA * 0.5).toFixed(4);
      const x2 = (0.5 + cosA * 0.5).toFixed(4);
      const y2 = (0.5 + sinA * 0.5).toFixed(4);
      const defs = `<linearGradient id="${defId}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops}</linearGradient>`;
      return { attrs: { fill: `url(#${defId})` }, defs };
    }

    case 'radial-gradient': {
      const stops = fill.stops
        .map((s) => {
          const opAttr = s.opacity !== undefined ? ` stop-opacity="${s.opacity}"` : '';
          return `<stop offset="${s.offset}" stop-color="${s.color}"${opAttr}/>`;
        })
        .join('');
      // SVG <radialGradient> has `r` (not `rx`/`ry`). For elliptical gradients,
      // use gradientTransform with a scale to stretch one axis.
      const r = fill.radiusY;
      const scaleX = fill.radiusX / fill.radiusY;
      // The gradientTransform scales the x-axis around the center to create an ellipse.
      const transform = `translate(${fill.centerX}, ${fill.centerY}) scale(${scaleX}, 1) translate(${-fill.centerX}, ${-fill.centerY})`;
      const defs = `<radialGradient id="${defId}" cx="${fill.centerX}" cy="${fill.centerY}" r="${r}" gradientTransform="${transform}">${stops}</radialGradient>`;
      return { attrs: { fill: `url(#${defId})` }, defs };
    }

    case 'pattern':
      // Simplified: use foreground color as fill
      return { attrs: { fill: fill.foreground } };

    case 'image':
      // Image fills handled separately in SVG
      return { attrs: { fill: 'none' } };

    default:
      return { attrs: { fill: 'none' } };
  }
}
