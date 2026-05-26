/**
 * Basic Shapes Drawing Module
 *
 * Drawing functions for basic geometric shapes:
 * - Rectangles (standard, rounded, snipped corner variants)
 * - Ovals
 * - Triangles
 * - Polygons (diamond, pentagon, hexagon, etc.)
 * - Curved shapes (teardrop, pie, donut, etc.)
 *
 * @module components/toolbar/shape-preview/shapes/basic-shapes
 */

import type { ShapeType } from '@mog-sdk/contracts/floating-objects';

import { drawRegularPolygon } from '../paths/path-utils';
import type { ShapeBounds } from '../types';

/**
 * Draw a basic shape path on canvas context.
 *
 * This function handles basic geometric shapes including:
 * - rect, roundRect, ellipse, triangle, rtTriangle, diamond
 * - pentagon, hexagon, octagon, heptagon, decagon, dodecagon
 * - parallelogram, trapezoid, nonIsoscelesTrapezoid
 * - teardrop, pie, pieWedge, blockArc, donut, noSmoking, plaque
 * - round1Rect, round2SameRect, round2DiagRect, snip1Rect, snip2SameRect, snip2DiagRect, snipRoundRect
 *
 * @param ctx - Canvas 2D context (beginPath already called by caller)
 * @param shapeType - Type of shape to draw
 * @param bounds - Bounding box for the shape
 * @returns true if shape was drawn, false if not handled by this module
 */
export function drawBasicShape(
  ctx: CanvasRenderingContext2D,
  shapeType: ShapeType,
  bounds: ShapeBounds,
): boolean {
  const { x, y, width, height } = bounds;

  switch (shapeType) {
    // Basic shapes
    case 'rect':
      ctx.rect(x, y, width, height);
      return true;

    case 'roundRect': {
      const radius = Math.min(width, height) * 0.15;
      ctx.roundRect(x, y, width, height, radius);
      return true;
    }

    case 'ellipse':
      ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
      return true;

    case 'triangle':
      ctx.moveTo(x + width / 2, y);
      ctx.lineTo(x + width, y + height);
      ctx.lineTo(x, y + height);
      ctx.closePath();
      return true;

    case 'rtTriangle':
      ctx.moveTo(x, y);
      ctx.lineTo(x + width, y + height);
      ctx.lineTo(x, y + height);
      ctx.closePath();
      return true;

    case 'diamond':
      ctx.moveTo(x + width / 2, y);
      ctx.lineTo(x + width, y + height / 2);
      ctx.lineTo(x + width / 2, y + height);
      ctx.lineTo(x, y + height / 2);
      ctx.closePath();
      return true;

    // Regular polygons
    case 'pentagon':
      drawRegularPolygon(ctx, x, y, width, height, 5);
      return true;

    case 'hexagon':
      drawRegularPolygon(ctx, x, y, width, height, 6);
      return true;

    case 'octagon':
      drawRegularPolygon(ctx, x, y, width, height, 8);
      return true;

    case 'heptagon':
      drawRegularPolygon(ctx, x, y, width, height, 7);
      return true;

    case 'decagon':
      drawRegularPolygon(ctx, x, y, width, height, 10);
      return true;

    case 'dodecagon':
      drawRegularPolygon(ctx, x, y, width, height, 12);
      return true;

    // Parallelograms and trapezoids
    case 'parallelogram': {
      const slant = width * 0.2;
      ctx.moveTo(x + slant, y);
      ctx.lineTo(x + width, y);
      ctx.lineTo(x + width - slant, y + height);
      ctx.lineTo(x, y + height);
      ctx.closePath();
      return true;
    }

    case 'trapezoid': {
      const inset = width * 0.2;
      ctx.moveTo(x + inset, y);
      ctx.lineTo(x + width - inset, y);
      ctx.lineTo(x + width, y + height);
      ctx.lineTo(x, y + height);
      ctx.closePath();
      return true;
    }

    case 'nonIsoscelesTrapezoid': {
      const leftInset = width * 0.15;
      const rightInset = width * 0.25;
      ctx.moveTo(x + leftInset, y);
      ctx.lineTo(x + width - rightInset, y);
      ctx.lineTo(x + width, y + height);
      ctx.lineTo(x, y + height);
      ctx.closePath();
      return true;
    }

    // Curved basic shapes
    case 'teardrop': {
      const cx = x + width / 2;
      const cy = y + height * 0.6;
      const radius = Math.min(width, height) * 0.35;
      // Circle part
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.closePath();
      ctx.moveTo(cx, cy - radius);
      // Teardrop tip
      ctx.quadraticCurveTo(cx - radius * 0.3, y, cx, y);
      ctx.quadraticCurveTo(cx + radius * 0.3, y, cx, cy - radius);
      return true;
    }

    case 'pie':
    case 'pieWedge': {
      const cx = x + width / 2;
      const cy = y + height / 2;
      const radius = Math.min(width, height) / 2;
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, -Math.PI / 4, Math.PI / 2);
      ctx.closePath();
      return true;
    }

    case 'blockArc': {
      const cx = x + width / 2;
      const cy = y + height / 2;
      const outerR = Math.min(width, height) / 2;
      const innerR = outerR * 0.5;
      ctx.arc(cx, cy, outerR, Math.PI, 0, false);
      ctx.arc(cx, cy, innerR, 0, Math.PI, true);
      ctx.closePath();
      return true;
    }

    case 'donut': {
      const cx = x + width / 2;
      const cy = y + height / 2;
      const outerR = Math.min(width, height) / 2;
      const innerR = outerR * 0.5;
      ctx.arc(cx, cy, outerR, 0, Math.PI * 2, false);
      ctx.moveTo(cx + innerR, cy);
      ctx.arc(cx, cy, innerR, 0, Math.PI * 2, true);
      return true;
    }

    case 'noSmoking': {
      const cx = x + width / 2;
      const cy = y + height / 2;
      const radius = Math.min(width, height) / 2;
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.moveTo(cx - radius * 0.7, cy - radius * 0.7);
      ctx.lineTo(cx + radius * 0.7, cy + radius * 0.7);
      return true;
    }

    case 'plaque': {
      const inset = Math.min(width, height) * 0.15;
      ctx.moveTo(x + inset, y);
      ctx.lineTo(x + width - inset, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + inset);
      ctx.lineTo(x + width, y + height - inset);
      ctx.quadraticCurveTo(x + width, y + height, x + width - inset, y + height);
      ctx.lineTo(x + inset, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - inset);
      ctx.lineTo(x, y + inset);
      ctx.quadraticCurveTo(x, y, x + inset, y);
      ctx.closePath();
      return true;
    }

    // Rectangle variants with rounded corners
    case 'round1Rect': {
      const radius = Math.min(width, height) * 0.2;
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + width, y);
      ctx.lineTo(x + width, y + height);
      ctx.lineTo(x, y + height);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
      return true;
    }

    case 'round2SameRect': {
      const radius = Math.min(width, height) * 0.2;
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + width, y);
      ctx.lineTo(x + width, y + height - radius);
      ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
      ctx.lineTo(x, y + height);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
      return true;
    }

    case 'round2DiagRect': {
      const radius = Math.min(width, height) * 0.2;
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + width, y);
      ctx.lineTo(x + width, y + height);
      ctx.lineTo(x + width - radius, y + height);
      ctx.quadraticCurveTo(
        x + width - radius * 2,
        y + height,
        x + width - radius * 2,
        y + height - radius,
      );
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
      return true;
    }

    // Rectangle variants with snipped corners
    case 'snip1Rect': {
      const snip = Math.min(width, height) * 0.2;
      ctx.moveTo(x + snip, y);
      ctx.lineTo(x + width, y);
      ctx.lineTo(x + width, y + height);
      ctx.lineTo(x, y + height);
      ctx.lineTo(x, y + snip);
      ctx.closePath();
      return true;
    }

    case 'snip2SameRect': {
      const snip = Math.min(width, height) * 0.2;
      ctx.moveTo(x + snip, y);
      ctx.lineTo(x + width, y);
      ctx.lineTo(x + width, y + height - snip);
      ctx.lineTo(x + width - snip, y + height);
      ctx.lineTo(x, y + height);
      ctx.lineTo(x, y + snip);
      ctx.closePath();
      return true;
    }

    case 'snip2DiagRect': {
      const snip = Math.min(width, height) * 0.2;
      ctx.moveTo(x + snip, y);
      ctx.lineTo(x + width, y);
      ctx.lineTo(x + width, y + height);
      ctx.lineTo(x + width - snip, y + height);
      ctx.lineTo(x, y + snip);
      ctx.closePath();
      return true;
    }

    case 'snipRoundRect': {
      const snip = Math.min(width, height) * 0.2;
      const radius = Math.min(width, height) * 0.15;
      ctx.moveTo(x + snip, y);
      ctx.lineTo(x + width - radius, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
      ctx.lineTo(x + width, y + height - snip);
      ctx.lineTo(x + width - snip, y + height);
      ctx.lineTo(x + radius, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
      ctx.lineTo(x, y + snip);
      ctx.closePath();
      return true;
    }

    default:
      return false;
  }
}
