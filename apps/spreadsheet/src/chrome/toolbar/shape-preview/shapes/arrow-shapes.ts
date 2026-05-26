/**
 * Arrow Shapes Drawing Module
 *
 * Drawing functions for arrow-type shapes in shape preview thumbnails.
 * Includes basic arrows, double-headed arrows, curved arrows, circular arrows,
 * bent arrows, and arrow callouts.
 *
 * @module components/toolbar/shape-preview/shapes/arrow-shapes
 */

import type { ShapeType } from '@mog-sdk/contracts/floating-objects';

import type { ShapeBounds } from '../types';

// =============================================================================
// Arrow Shape Drawing Function
// =============================================================================

/**
 * Draw arrow shape path on canvas context.
 *
 * Handles all arrow-type shapes including:
 * - Basic arrows: rightArrow, leftArrow, upArrow, downArrow
 * - Double-headed arrows: leftRightArrow, upDownArrow, quadArrow
 * - Special arrows: chevron, bentArrow, uturnArrow
 * - Circular arrows: circularArrow, leftCircularArrow, leftRightCircularArrow
 * - Curved arrows: curvedRightArrow, curvedLeftArrow, curvedUpArrow, curvedDownArrow, swooshArrow
 * - Arrow callouts: leftArrowCallout, rightArrowCallout, upArrowCallout, downArrowCallout,
 * leftRightArrowCallout, upDownArrowCallout, quadArrowCallout
 *
 * Note: Does NOT call ctx.beginPath() - that's handled by the caller.
 *
 * @param ctx - Canvas 2D context
 * @param shapeType - Type of arrow shape to draw
 * @param bounds - Bounding box for the shape
 * @returns true if shape was drawn, false if not handled
 */
export function drawArrowShape(
  ctx: CanvasRenderingContext2D,
  shapeType: ShapeType,
  bounds: ShapeBounds,
): boolean {
  const { x, y, width, height } = bounds;

  switch (shapeType) {
    // =========================================================================
    // Basic Horizontal Arrows
    // =========================================================================
    case 'rightArrow':
    case 'leftArrow': {
      const headWidth = width * 0.3;
      const shaftHeight = height * 0.5;
      const isLeft = shapeType === 'leftArrow';

      if (isLeft) {
        ctx.moveTo(x, y + height / 2);
        ctx.lineTo(x + headWidth, y);
        ctx.lineTo(x + headWidth, y + (height - shaftHeight) / 2);
        ctx.lineTo(x + width, y + (height - shaftHeight) / 2);
        ctx.lineTo(x + width, y + (height + shaftHeight) / 2);
        ctx.lineTo(x + headWidth, y + (height + shaftHeight) / 2);
        ctx.lineTo(x + headWidth, y + height);
      } else {
        ctx.moveTo(x, y + (height - shaftHeight) / 2);
        ctx.lineTo(x + width - headWidth, y + (height - shaftHeight) / 2);
        ctx.lineTo(x + width - headWidth, y);
        ctx.lineTo(x + width, y + height / 2);
        ctx.lineTo(x + width - headWidth, y + height);
        ctx.lineTo(x + width - headWidth, y + (height + shaftHeight) / 2);
        ctx.lineTo(x, y + (height + shaftHeight) / 2);
      }
      ctx.closePath();
      return true;
    }

    // =========================================================================
    // Basic Vertical Arrows
    // =========================================================================
    case 'upArrow': {
      const headHeight = height * 0.4;
      const shaftWidth = width * 0.4;
      ctx.moveTo(x + width / 2, y);
      ctx.lineTo(x + width, y + headHeight);
      ctx.lineTo(x + (width + shaftWidth) / 2, y + headHeight);
      ctx.lineTo(x + (width + shaftWidth) / 2, y + height);
      ctx.lineTo(x + (width - shaftWidth) / 2, y + height);
      ctx.lineTo(x + (width - shaftWidth) / 2, y + headHeight);
      ctx.lineTo(x, y + headHeight);
      ctx.closePath();
      return true;
    }

    case 'downArrow': {
      const headHeight = height * 0.4;
      const shaftWidth = width * 0.4;
      ctx.moveTo(x + (width - shaftWidth) / 2, y);
      ctx.lineTo(x + (width + shaftWidth) / 2, y);
      ctx.lineTo(x + (width + shaftWidth) / 2, y + height - headHeight);
      ctx.lineTo(x + width, y + height - headHeight);
      ctx.lineTo(x + width / 2, y + height);
      ctx.lineTo(x, y + height - headHeight);
      ctx.lineTo(x + (width - shaftWidth) / 2, y + height - headHeight);
      ctx.closePath();
      return true;
    }

    // =========================================================================
    // Double-headed Arrows
    // =========================================================================
    case 'leftRightArrow': {
      const headWidth = width * 0.25;
      const shaftHeight = height * 0.4;
      const midY = y + height / 2;
      ctx.moveTo(x, midY);
      ctx.lineTo(x + headWidth, y);
      ctx.lineTo(x + headWidth, midY - shaftHeight / 2);
      ctx.lineTo(x + width - headWidth, midY - shaftHeight / 2);
      ctx.lineTo(x + width - headWidth, y);
      ctx.lineTo(x + width, midY);
      ctx.lineTo(x + width - headWidth, y + height);
      ctx.lineTo(x + width - headWidth, midY + shaftHeight / 2);
      ctx.lineTo(x + headWidth, midY + shaftHeight / 2);
      ctx.lineTo(x + headWidth, y + height);
      ctx.closePath();
      return true;
    }

    case 'upDownArrow': {
      const headHeight = height * 0.25;
      const shaftWidth = width * 0.4;
      const midX = x + width / 2;
      ctx.moveTo(midX, y);
      ctx.lineTo(x + width, y + headHeight);
      ctx.lineTo(midX + shaftWidth / 2, y + headHeight);
      ctx.lineTo(midX + shaftWidth / 2, y + height - headHeight);
      ctx.lineTo(x + width, y + height - headHeight);
      ctx.lineTo(midX, y + height);
      ctx.lineTo(x, y + height - headHeight);
      ctx.lineTo(midX - shaftWidth / 2, y + height - headHeight);
      ctx.lineTo(midX - shaftWidth / 2, y + headHeight);
      ctx.lineTo(x, y + headHeight);
      ctx.closePath();
      return true;
    }

    // =========================================================================
    // Four-way Arrow
    // =========================================================================
    case 'quadArrow': {
      const headSize = Math.min(width, height) * 0.25;
      const shaftThickness = Math.min(width, height) * 0.25;
      const cx = x + width / 2;
      const cy = y + height / 2;
      // Up arrow
      ctx.moveTo(cx, y);
      ctx.lineTo(cx + headSize, y + headSize);
      ctx.lineTo(cx + shaftThickness / 2, y + headSize);
      ctx.lineTo(cx + shaftThickness / 2, cy - shaftThickness / 2);
      // Right arrow
      ctx.lineTo(cx + headSize, cy - shaftThickness / 2);
      ctx.lineTo(cx + headSize, cy - headSize);
      ctx.lineTo(x + width, cy);
      ctx.lineTo(cx + headSize, cy + headSize);
      ctx.lineTo(cx + headSize, cy + shaftThickness / 2);
      // Down arrow
      ctx.lineTo(cx + shaftThickness / 2, cy + shaftThickness / 2);
      ctx.lineTo(cx + shaftThickness / 2, cy + headSize);
      ctx.lineTo(cx + headSize, y + height - headSize);
      ctx.lineTo(cx, y + height);
      ctx.lineTo(cx - headSize, y + height - headSize);
      ctx.lineTo(cx - shaftThickness / 2, cy + headSize);
      // Left arrow
      ctx.lineTo(cx - shaftThickness / 2, cy + shaftThickness / 2);
      ctx.lineTo(cx - headSize, cy + shaftThickness / 2);
      ctx.lineTo(cx - headSize, cy + headSize);
      ctx.lineTo(x, cy);
      ctx.lineTo(cx - headSize, cy - headSize);
      ctx.lineTo(cx - headSize, cy - shaftThickness / 2);
      ctx.lineTo(cx - shaftThickness / 2, cy - shaftThickness / 2);
      ctx.lineTo(cx - shaftThickness / 2, y + headSize);
      ctx.lineTo(cx - headSize, y + headSize);
      ctx.closePath();
      return true;
    }

    // =========================================================================
    // Chevron
    // =========================================================================
    case 'chevron': {
      const notch = width * 0.3;
      ctx.moveTo(x, y);
      ctx.lineTo(x + width - notch, y);
      ctx.lineTo(x + width, y + height / 2);
      ctx.lineTo(x + width - notch, y + height);
      ctx.lineTo(x, y + height);
      ctx.lineTo(x + notch, y + height / 2);
      ctx.closePath();
      return true;
    }

    // =========================================================================
    // Bent Arrow
    // =========================================================================
    case 'bentArrow': {
      const shaftWidth = height * 0.3;
      const headSize = width * 0.35;
      ctx.moveTo(x, y);
      ctx.lineTo(x + shaftWidth, y);
      ctx.lineTo(x + shaftWidth, y + height - headSize - shaftWidth);
      ctx.lineTo(x + width - headSize, y + height - headSize - shaftWidth);
      ctx.lineTo(x + width - headSize, y + height - headSize - shaftWidth * 1.5);
      ctx.lineTo(x + width, y + height - headSize / 2);
      ctx.lineTo(x + width - headSize, y + height);
      ctx.lineTo(x + width - headSize, y + height - shaftWidth);
      ctx.lineTo(x + shaftWidth * 1.5, y + height - shaftWidth);
      ctx.lineTo(x + shaftWidth * 1.5, y + shaftWidth);
      ctx.lineTo(x, y + shaftWidth);
      ctx.closePath();
      return true;
    }

    // =========================================================================
    // U-Turn Arrow
    // =========================================================================
    case 'uturnArrow': {
      const shaftWidth = width * 0.25;
      const arcRadius = width * 0.3;
      const headHeight = height * 0.3;
      // Down shaft
      ctx.moveTo(x + width - shaftWidth, y);
      ctx.lineTo(x + width, y);
      ctx.lineTo(x + width, y + height - arcRadius);
      // Arc at bottom
      ctx.arc(x + width - arcRadius, y + height - arcRadius, arcRadius, 0, Math.PI / 2);
      // Up shaft with arrow head
      ctx.lineTo(x + width - arcRadius - shaftWidth, y + height);
      ctx.lineTo(x + width - arcRadius - shaftWidth, y + headHeight + shaftWidth);
      ctx.lineTo(x + width - arcRadius * 2, y + headHeight + shaftWidth);
      ctx.lineTo(x + width - arcRadius - shaftWidth / 2, y);
      ctx.lineTo(x + width - arcRadius - shaftWidth, y + headHeight);
      ctx.lineTo(x + width - shaftWidth, y + headHeight);
      ctx.closePath();
      return true;
    }

    // =========================================================================
    // Circular Arrows
    // =========================================================================
    case 'circularArrow': {
      const cx = x + width / 2;
      const cy = y + height / 2;
      const radius = Math.min(width, height) * 0.38;
      const thickness = radius * 0.35;
      ctx.arc(cx, cy, radius, -Math.PI * 0.75, Math.PI * 0.75, false);
      // Arrow head at end
      const endAngle = Math.PI * 0.75;
      const ex = cx + radius * Math.cos(endAngle);
      const ey = cy + radius * Math.sin(endAngle);
      ctx.lineTo(ex - 4, ey + 5);
      ctx.lineTo(ex + 4, ey + 5);
      ctx.lineTo(ex, ey);
      ctx.arc(cx, cy, radius - thickness, Math.PI * 0.75, -Math.PI * 0.75, true);
      ctx.closePath();
      return true;
    }

    case 'leftCircularArrow': {
      const cx = x + width / 2;
      const cy = y + height / 2;
      const radius = Math.min(width, height) * 0.38;
      const thickness = radius * 0.35;
      ctx.arc(cx, cy, radius, Math.PI * 0.75, -Math.PI * 0.75, true);
      // Arrow head at end
      const endAngle = -Math.PI * 0.75;
      const ex = cx + radius * Math.cos(endAngle);
      const ey = cy + radius * Math.sin(endAngle);
      ctx.lineTo(ex - 4, ey - 5);
      ctx.lineTo(ex + 4, ey - 5);
      ctx.lineTo(ex, ey);
      ctx.arc(cx, cy, radius - thickness, -Math.PI * 0.75, Math.PI * 0.75, false);
      ctx.closePath();
      return true;
    }

    case 'leftRightCircularArrow': {
      const cx = x + width / 2;
      const cy = y + height / 2;
      const radius = Math.min(width, height) * 0.38;
      const thickness = radius * 0.3;
      // Right arrow (clockwise)
      ctx.arc(cx, cy, radius, -Math.PI * 0.6, Math.PI * 0.6, false);
      const ex1 = cx + radius * Math.cos(Math.PI * 0.6);
      const ey1 = cy + radius * Math.sin(Math.PI * 0.6);
      ctx.lineTo(ex1 - 3, ey1 + 4);
      ctx.lineTo(ex1 + 3, ey1 + 4);
      ctx.lineTo(ex1, ey1);
      // Inner arc
      ctx.arc(cx, cy, radius - thickness, Math.PI * 0.6, -Math.PI * 0.6, true);
      // Left arrow (counter-clockwise) - inner part
      const ex2 = cx + (radius - thickness) * Math.cos(-Math.PI * 0.6);
      const ey2 = cy + (radius - thickness) * Math.sin(-Math.PI * 0.6);
      ctx.lineTo(ex2 - 3, ey2 - 4);
      ctx.lineTo(ex2 + 3, ey2 - 4);
      ctx.closePath();
      return true;
    }

    // =========================================================================
    // Curved Arrows
    // =========================================================================
    case 'curvedRightArrow': {
      const headWidth = width * 0.35;
      const shaftHeight = height * 0.4;
      ctx.moveTo(x, y + height * 0.7);
      ctx.quadraticCurveTo(x + width * 0.3, y, x + width - headWidth, y + height * 0.3);
      ctx.lineTo(x + width - headWidth, y);
      ctx.lineTo(x + width, y + height / 2);
      ctx.lineTo(x + width - headWidth, y + height);
      ctx.lineTo(x + width - headWidth, y + height * 0.7);
      ctx.quadraticCurveTo(x + width * 0.3, y + height - shaftHeight, x, y + height);
      ctx.closePath();
      return true;
    }

    case 'curvedLeftArrow': {
      const headWidth = width * 0.35;
      const shaftHeight = height * 0.4;
      ctx.moveTo(x + width, y + height * 0.7);
      ctx.quadraticCurveTo(x + width * 0.7, y, x + headWidth, y + height * 0.3);
      ctx.lineTo(x + headWidth, y);
      ctx.lineTo(x, y + height / 2);
      ctx.lineTo(x + headWidth, y + height);
      ctx.lineTo(x + headWidth, y + height * 0.7);
      ctx.quadraticCurveTo(x + width * 0.7, y + height - shaftHeight, x + width, y + height);
      ctx.closePath();
      return true;
    }

    case 'curvedUpArrow': {
      const headHeight = height * 0.35;
      const shaftWidth = width * 0.4;
      ctx.moveTo(x + width * 0.3, y + height);
      ctx.quadraticCurveTo(x + width, y + height * 0.7, x + width * 0.7, y + headHeight);
      ctx.lineTo(x + width, y + headHeight);
      ctx.lineTo(x + width / 2, y);
      ctx.lineTo(x, y + headHeight);
      ctx.lineTo(x + width * 0.3, y + headHeight);
      ctx.quadraticCurveTo(x + shaftWidth, y + height * 0.7, x, y + height);
      ctx.closePath();
      return true;
    }

    case 'curvedDownArrow': {
      const headHeight = height * 0.35;
      const shaftWidth = width * 0.4;
      ctx.moveTo(x + width * 0.3, y);
      ctx.quadraticCurveTo(x + width, y + height * 0.3, x + width * 0.7, y + height - headHeight);
      ctx.lineTo(x + width, y + height - headHeight);
      ctx.lineTo(x + width / 2, y + height);
      ctx.lineTo(x, y + height - headHeight);
      ctx.lineTo(x + width * 0.3, y + height - headHeight);
      ctx.quadraticCurveTo(x + shaftWidth, y + height * 0.3, x, y);
      ctx.closePath();
      return true;
    }

    case 'swooshArrow': {
      const headWidth = width * 0.3;
      ctx.moveTo(x, y + height * 0.8);
      ctx.quadraticCurveTo(x + width * 0.5, y, x + width - headWidth, y + height * 0.4);
      ctx.lineTo(x + width - headWidth, y);
      ctx.lineTo(x + width, y + height / 2);
      ctx.lineTo(x + width - headWidth, y + height);
      ctx.lineTo(x + width - headWidth, y + height * 0.6);
      ctx.quadraticCurveTo(x + width * 0.4, y + height * 0.4, x, y + height);
      ctx.closePath();
      return true;
    }

    // =========================================================================
    // Arrow Callouts
    // =========================================================================
    case 'leftArrowCallout': {
      const headWidth = width * 0.25;
      const shaftHeight = height * 0.3;
      ctx.moveTo(x, y + height / 2);
      ctx.lineTo(x + headWidth, y + (height - shaftHeight) / 2);
      ctx.lineTo(x + headWidth, y + height * 0.2);
      ctx.lineTo(x + width, y + height * 0.2);
      ctx.lineTo(x + width, y + height * 0.8);
      ctx.lineTo(x + headWidth, y + height * 0.8);
      ctx.lineTo(x + headWidth, y + (height + shaftHeight) / 2);
      ctx.closePath();
      return true;
    }

    case 'rightArrowCallout': {
      const headWidth = width * 0.25;
      const shaftHeight = height * 0.3;
      ctx.moveTo(x, y + height * 0.2);
      ctx.lineTo(x + width - headWidth, y + height * 0.2);
      ctx.lineTo(x + width - headWidth, y + (height - shaftHeight) / 2);
      ctx.lineTo(x + width, y + height / 2);
      ctx.lineTo(x + width - headWidth, y + (height + shaftHeight) / 2);
      ctx.lineTo(x + width - headWidth, y + height * 0.8);
      ctx.lineTo(x, y + height * 0.8);
      ctx.closePath();
      return true;
    }

    case 'upArrowCallout': {
      const headHeight = height * 0.25;
      const shaftWidth = width * 0.3;
      ctx.moveTo(x + width / 2, y);
      ctx.lineTo(x + (width + shaftWidth) / 2, y + headHeight);
      ctx.lineTo(x + width * 0.8, y + headHeight);
      ctx.lineTo(x + width * 0.8, y + height);
      ctx.lineTo(x + width * 0.2, y + height);
      ctx.lineTo(x + width * 0.2, y + headHeight);
      ctx.lineTo(x + (width - shaftWidth) / 2, y + headHeight);
      ctx.closePath();
      return true;
    }

    case 'downArrowCallout': {
      const headHeight = height * 0.25;
      const shaftWidth = width * 0.3;
      ctx.moveTo(x + width * 0.2, y);
      ctx.lineTo(x + width * 0.8, y);
      ctx.lineTo(x + width * 0.8, y + height - headHeight);
      ctx.lineTo(x + (width + shaftWidth) / 2, y + height - headHeight);
      ctx.lineTo(x + width / 2, y + height);
      ctx.lineTo(x + (width - shaftWidth) / 2, y + height - headHeight);
      ctx.lineTo(x + width * 0.2, y + height - headHeight);
      ctx.closePath();
      return true;
    }

    case 'leftRightArrowCallout': {
      const headWidth = width * 0.2;
      const shaftHeight = height * 0.3;
      ctx.moveTo(x, y + height / 2);
      ctx.lineTo(x + headWidth, y + (height - shaftHeight) / 2);
      ctx.lineTo(x + headWidth, y + height * 0.2);
      ctx.lineTo(x + width - headWidth, y + height * 0.2);
      ctx.lineTo(x + width - headWidth, y + (height - shaftHeight) / 2);
      ctx.lineTo(x + width, y + height / 2);
      ctx.lineTo(x + width - headWidth, y + (height + shaftHeight) / 2);
      ctx.lineTo(x + width - headWidth, y + height * 0.8);
      ctx.lineTo(x + headWidth, y + height * 0.8);
      ctx.lineTo(x + headWidth, y + (height + shaftHeight) / 2);
      ctx.closePath();
      return true;
    }

    case 'upDownArrowCallout': {
      const headHeight = height * 0.2;
      const shaftWidth = width * 0.3;
      ctx.moveTo(x + width / 2, y);
      ctx.lineTo(x + (width + shaftWidth) / 2, y + headHeight);
      ctx.lineTo(x + width * 0.8, y + headHeight);
      ctx.lineTo(x + width * 0.8, y + height - headHeight);
      ctx.lineTo(x + (width + shaftWidth) / 2, y + height - headHeight);
      ctx.lineTo(x + width / 2, y + height);
      ctx.lineTo(x + (width - shaftWidth) / 2, y + height - headHeight);
      ctx.lineTo(x + width * 0.2, y + height - headHeight);
      ctx.lineTo(x + width * 0.2, y + headHeight);
      ctx.lineTo(x + (width - shaftWidth) / 2, y + headHeight);
      ctx.closePath();
      return true;
    }

    case 'quadArrowCallout': {
      const headSize = Math.min(width, height) * 0.2;
      const cx = x + width / 2;
      const cy = y + height / 2;
      const bodyInset = Math.min(width, height) * 0.25;
      // Up arrow
      ctx.moveTo(cx, y);
      ctx.lineTo(cx + headSize, y + headSize);
      ctx.lineTo(cx + bodyInset, y + headSize);
      ctx.lineTo(cx + bodyInset, cy - bodyInset);
      // Right arrow
      ctx.lineTo(x + width - headSize, cy - bodyInset);
      ctx.lineTo(x + width - headSize, cy - headSize);
      ctx.lineTo(x + width, cy);
      ctx.lineTo(x + width - headSize, cy + headSize);
      ctx.lineTo(x + width - headSize, cy + bodyInset);
      // Down arrow
      ctx.lineTo(cx + bodyInset, cy + bodyInset);
      ctx.lineTo(cx + bodyInset, y + height - headSize);
      ctx.lineTo(cx + headSize, y + height - headSize);
      ctx.lineTo(cx, y + height);
      ctx.lineTo(cx - headSize, y + height - headSize);
      ctx.lineTo(cx - bodyInset, y + height - headSize);
      // Left arrow
      ctx.lineTo(cx - bodyInset, cy + bodyInset);
      ctx.lineTo(x + headSize, cy + bodyInset);
      ctx.lineTo(x + headSize, cy + headSize);
      ctx.lineTo(x, cy);
      ctx.lineTo(x + headSize, cy - headSize);
      ctx.lineTo(x + headSize, cy - bodyInset);
      ctx.lineTo(cx - bodyInset, cy - bodyInset);
      ctx.lineTo(cx - bodyInset, y + headSize);
      ctx.lineTo(cx - headSize, y + headSize);
      ctx.closePath();
      return true;
    }

    default:
      return false;
  }
}
