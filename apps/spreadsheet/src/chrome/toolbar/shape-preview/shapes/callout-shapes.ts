/**
 * Callout Shape Paths
 *
 * Drawing functions for callout shapes including speech bubbles,
 * cloud callouts, and various callout variations with connector lines.
 */

import type { ShapeType } from '@mog-sdk/contracts/floating-objects';

import type { ShapeBounds } from '../types';

/**
 * Draw a callout shape path.
 *
 * Handles these shape types:
 * - wedgeRectCallout, wedgeRoundRectCallout, wedgeEllipseCallout, cloud
 * - callout1, callout2, callout3
 * - borderCallout1, borderCallout2, borderCallout3
 * - accentCallout1, accentCallout2, accentCallout3
 * - accentBorderCallout1, accentBorderCallout2, accentBorderCallout3
 *
 * @param ctx - Canvas 2D context (beginPath already called by caller)
 * @param shapeType - Type of callout shape to draw
 * @param bounds - Bounding box for the shape
 * @returns true if shape was drawn, false if not handled
 */
export function drawCalloutShape(
  ctx: CanvasRenderingContext2D,
  shapeType: ShapeType,
  bounds: ShapeBounds,
): boolean {
  const { x, y, width, height } = bounds;

  switch (shapeType) {
    // Basic callout with tail (speech bubble) - wedgeRectCallout
    case 'wedgeRectCallout': {
      const tailX = x + width * 0.2;
      const tailY = y + height;
      const tailHeight = height * 0.2;
      ctx.moveTo(x, y);
      ctx.lineTo(x + width, y);
      ctx.lineTo(x + width, y + height - tailHeight);
      ctx.lineTo(x + tailX + width * 0.1, y + height - tailHeight);
      ctx.lineTo(x + tailX, tailY);
      ctx.lineTo(x + tailX - width * 0.05, y + height - tailHeight);
      ctx.lineTo(x, y + height - tailHeight);
      ctx.closePath();
      return true;
    }

    // Rounded callout with tail - wedgeRoundRectCallout
    case 'wedgeRoundRectCallout': {
      const radius = Math.min(width, height) * 0.1;
      const tailX = x + width * 0.2;
      const tailY = y + height;
      const tailHeight = height * 0.2;
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + width - radius, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
      ctx.lineTo(x + width, y + height - tailHeight - radius);
      ctx.quadraticCurveTo(
        x + width,
        y + height - tailHeight,
        x + width - radius,
        y + height - tailHeight,
      );
      ctx.lineTo(x + tailX + width * 0.1, y + height - tailHeight);
      ctx.lineTo(x + tailX, tailY);
      ctx.lineTo(x + tailX - width * 0.05, y + height - tailHeight);
      ctx.lineTo(x + radius, y + height - tailHeight);
      ctx.quadraticCurveTo(x, y + height - tailHeight, x, y + height - tailHeight - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
      return true;
    }

    // Cloud/oval callout using multiple arcs - wedgeEllipseCallout
    case 'wedgeEllipseCallout':
    case 'cloud': {
      const r1 = width * 0.2;
      const r2 = width * 0.25;
      const r3 = height * 0.2;
      ctx.arc(x + width * 0.25, y + height * 0.6, r1, Math.PI, 0, false);
      ctx.arc(x + width * 0.5, y + height * 0.35, r2, Math.PI, 0, false);
      ctx.arc(x + width * 0.75, y + height * 0.6, r1, Math.PI, 0, false);
      ctx.arc(x + width * 0.85, y + height * 0.7, r3, 0, Math.PI, false);
      ctx.arc(x + width * 0.15, y + height * 0.7, r3, 0, Math.PI, false);
      ctx.closePath();
      return true;
    }

    // Callout with single line connector
    case 'callout1':
    case 'borderCallout1':
    case 'accentCallout1':
    case 'accentBorderCallout1': {
      // Rectangle with single line pointing down
      ctx.rect(x, y, width, height * 0.7);
      ctx.moveTo(x + width * 0.5, y + height * 0.7);
      ctx.lineTo(x + width * 0.4, y + height);
      return true;
    }

    // Callout with bent line connector
    case 'callout2':
    case 'borderCallout2':
    case 'accentCallout2':
    case 'accentBorderCallout2': {
      // Rectangle with bent line pointing down
      ctx.rect(x, y, width, height * 0.6);
      ctx.moveTo(x + width * 0.5, y + height * 0.6);
      ctx.lineTo(x + width * 0.5, y + height * 0.8);
      ctx.lineTo(x + width * 0.3, y + height);
      return true;
    }

    // Callout with double-bent line connector
    case 'callout3':
    case 'borderCallout3':
    case 'accentCallout3':
    case 'accentBorderCallout3': {
      // Rectangle with double-bent line
      ctx.rect(x, y, width, height * 0.55);
      ctx.moveTo(x + width * 0.5, y + height * 0.55);
      ctx.lineTo(x + width * 0.5, y + height * 0.7);
      ctx.lineTo(x + width * 0.7, y + height * 0.85);
      ctx.lineTo(x + width * 0.2, y + height);
      return true;
    }

    default:
      return false;
  }
}
