/**
 * Flowchart Shape Drawing
 *
 * Drawing functions for all flowChart* shape types.
 * Used by ShapePreviewThumbnail for rendering flowchart shape previews.
 *
 * @module components/toolbar/shape-preview/shapes/flowchart-shapes
 */

import type { ShapeType } from '@mog-sdk/contracts/floating-objects';

import type { ShapeBounds } from '../types';

/**
 * Draw a flowchart shape path on the canvas context.
 *
 * NOTE: This function does NOT call ctx.beginPath() - that's handled by the caller.
 *
 * @param ctx - Canvas 2D rendering context
 * @param shapeType - The flowchart shape type to draw
 * @param bounds - Bounding box for the shape
 * @returns true if the shape was drawn, false if not handled
 */
export function drawFlowchartShape(
  ctx: CanvasRenderingContext2D,
  shapeType: ShapeType,
  bounds: ShapeBounds,
): boolean {
  const { x, y, width, height } = bounds;

  switch (shapeType) {
    case 'flowChartProcess':
      ctx.rect(x, y, width, height);
      return true;

    case 'flowChartDecision':
      ctx.moveTo(x + width / 2, y);
      ctx.lineTo(x + width, y + height / 2);
      ctx.lineTo(x + width / 2, y + height);
      ctx.lineTo(x, y + height / 2);
      ctx.closePath();
      return true;

    case 'flowChartTerminator': {
      const radius = height / 2;
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + width - radius, y);
      ctx.arc(x + width - radius, y + radius, radius, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(x + radius, y + height);
      ctx.arc(x + radius, y + radius, radius, Math.PI / 2, (Math.PI * 3) / 2);
      ctx.closePath();
      return true;
    }

    case 'flowChartInputOutput': {
      const slant = width * 0.15;
      ctx.moveTo(x + slant, y);
      ctx.lineTo(x + width, y);
      ctx.lineTo(x + width - slant, y + height);
      ctx.lineTo(x, y + height);
      ctx.closePath();
      return true;
    }

    case 'flowChartPredefinedProcess': {
      ctx.rect(x, y, width, height);
      ctx.moveTo(x + width * 0.15, y);
      ctx.lineTo(x + width * 0.15, y + height);
      ctx.moveTo(x + width * 0.85, y);
      ctx.lineTo(x + width * 0.85, y + height);
      return true;
    }

    case 'flowChartInternalStorage': {
      ctx.rect(x, y, width, height);
      ctx.moveTo(x, y + height * 0.2);
      ctx.lineTo(x + width, y + height * 0.2);
      ctx.moveTo(x + width * 0.2, y);
      ctx.lineTo(x + width * 0.2, y + height);
      return true;
    }

    case 'flowChartDocument': {
      ctx.moveTo(x, y);
      ctx.lineTo(x + width, y);
      ctx.lineTo(x + width, y + height * 0.85);
      ctx.quadraticCurveTo(x + width * 0.75, y + height, x + width * 0.5, y + height * 0.85);
      ctx.quadraticCurveTo(x + width * 0.25, y + height * 0.7, x, y + height * 0.85);
      ctx.closePath();
      return true;
    }

    case 'flowChartMultidocument': {
      // Stack of 3 documents
      const offset = Math.min(width, height) * 0.08;
      for (let i = 0; i < 3; i++) {
        const ox = x + offset * i;
        const oy = y + offset * (2 - i);
        const w = width - offset * 2;
        const h = height - offset * 2;
        ctx.moveTo(ox, oy);
        ctx.lineTo(ox + w, oy);
        ctx.lineTo(ox + w, oy + h * 0.85);
        ctx.quadraticCurveTo(ox + w * 0.75, oy + h, ox + w * 0.5, oy + h * 0.85);
        ctx.quadraticCurveTo(ox + w * 0.25, oy + h * 0.7, ox, oy + h * 0.85);
        ctx.closePath();
      }
      return true;
    }

    case 'flowChartPreparation': {
      const inset = width * 0.15;
      ctx.moveTo(x + inset, y);
      ctx.lineTo(x + width - inset, y);
      ctx.lineTo(x + width, y + height / 2);
      ctx.lineTo(x + width - inset, y + height);
      ctx.lineTo(x + inset, y + height);
      ctx.lineTo(x, y + height / 2);
      ctx.closePath();
      return true;
    }

    case 'flowChartManualInput': {
      const slant = height * 0.2;
      ctx.moveTo(x, y + slant);
      ctx.lineTo(x + width, y);
      ctx.lineTo(x + width, y + height);
      ctx.lineTo(x, y + height);
      ctx.closePath();
      return true;
    }

    case 'flowChartManualOperation': {
      const inset = width * 0.15;
      ctx.moveTo(x, y);
      ctx.lineTo(x + width, y);
      ctx.lineTo(x + width - inset, y + height);
      ctx.lineTo(x + inset, y + height);
      ctx.closePath();
      return true;
    }

    case 'flowChartConnector': {
      const cx = x + width / 2;
      const cy = y + height / 2;
      const radius = Math.min(width, height) / 2;
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      return true;
    }

    case 'flowChartPunchedCard': {
      const corner = Math.min(width, height) * 0.15;
      ctx.moveTo(x + corner, y);
      ctx.lineTo(x + width, y);
      ctx.lineTo(x + width, y + height);
      ctx.lineTo(x, y + height);
      ctx.lineTo(x, y + corner);
      ctx.closePath();
      return true;
    }

    case 'flowChartPunchedTape': {
      ctx.moveTo(x, y + height * 0.15);
      ctx.quadraticCurveTo(x + width * 0.25, y, x + width * 0.5, y + height * 0.15);
      ctx.quadraticCurveTo(x + width * 0.75, y + height * 0.3, x + width, y + height * 0.15);
      ctx.lineTo(x + width, y + height * 0.85);
      ctx.quadraticCurveTo(x + width * 0.75, y + height, x + width * 0.5, y + height * 0.85);
      ctx.quadraticCurveTo(x + width * 0.25, y + height * 0.7, x, y + height * 0.85);
      ctx.closePath();
      return true;
    }

    case 'flowChartSummingJunction': {
      const cx = x + width / 2;
      const cy = y + height / 2;
      const radius = Math.min(width, height) / 2;
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.moveTo(x, y);
      ctx.lineTo(x + width, y + height);
      ctx.moveTo(x + width, y);
      ctx.lineTo(x, y + height);
      return true;
    }

    case 'flowChartOr': {
      const cx = x + width / 2;
      const cy = y + height / 2;
      const radius = Math.min(width, height) / 2;
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.moveTo(cx, y);
      ctx.lineTo(cx, y + height);
      ctx.moveTo(x, cy);
      ctx.lineTo(x + width, cy);
      return true;
    }

    case 'flowChartCollate': {
      ctx.moveTo(x, y);
      ctx.lineTo(x + width, y + height);
      ctx.lineTo(x, y + height);
      ctx.lineTo(x + width, y);
      ctx.closePath();
      return true;
    }

    case 'flowChartSort': {
      ctx.moveTo(x + width / 2, y);
      ctx.lineTo(x + width, y + height / 2);
      ctx.lineTo(x + width / 2, y + height);
      ctx.lineTo(x, y + height / 2);
      ctx.closePath();
      ctx.moveTo(x, y + height / 2);
      ctx.lineTo(x + width, y + height / 2);
      return true;
    }

    case 'flowChartExtract': {
      ctx.moveTo(x + width / 2, y);
      ctx.lineTo(x + width, y + height);
      ctx.lineTo(x, y + height);
      ctx.closePath();
      return true;
    }

    case 'flowChartMerge': {
      ctx.moveTo(x, y);
      ctx.lineTo(x + width, y);
      ctx.lineTo(x + width / 2, y + height);
      ctx.closePath();
      return true;
    }

    case 'flowChartOfflineStorage': {
      const slant = width * 0.2;
      ctx.moveTo(x + slant, y);
      ctx.lineTo(x + width, y);
      ctx.lineTo(x + width - slant, y + height);
      ctx.lineTo(x, y + height);
      ctx.closePath();
      ctx.moveTo(x, y + height);
      ctx.lineTo(x + slant, y);
      return true;
    }

    case 'flowChartOnlineStorage':
    case 'flowChartMagneticDisk': {
      const ellipseHeight = height * 0.2;
      ctx.ellipse(
        x + width / 2,
        y + ellipseHeight / 2,
        width / 2,
        ellipseHeight / 2,
        0,
        0,
        Math.PI * 2,
      );
      ctx.moveTo(x, y + ellipseHeight / 2);
      ctx.lineTo(x, y + height - ellipseHeight / 2);
      ctx.ellipse(
        x + width / 2,
        y + height - ellipseHeight / 2,
        width / 2,
        ellipseHeight / 2,
        0,
        0,
        Math.PI,
      );
      ctx.moveTo(x + width, y + height - ellipseHeight / 2);
      ctx.lineTo(x + width, y + ellipseHeight / 2);
      return true;
    }

    case 'flowChartMagneticTape': {
      const cx = x + width / 2;
      const cy = y + height / 2;
      const radius = Math.min(width, height) * 0.35;
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.moveTo(cx + radius, cy);
      ctx.lineTo(x + width, cy);
      return true;
    }

    case 'flowChartMagneticDrum': {
      const ellipseWidth = width * 0.15;
      ctx.ellipse(
        x + ellipseWidth / 2,
        y + height / 2,
        ellipseWidth / 2,
        height / 2,
        0,
        0,
        Math.PI * 2,
      );
      ctx.moveTo(x + ellipseWidth / 2, y);
      ctx.lineTo(x + width, y);
      ctx.lineTo(x + width, y + height);
      ctx.lineTo(x + ellipseWidth / 2, y + height);
      return true;
    }

    case 'flowChartDisplay': {
      const curve = width * 0.15;
      ctx.moveTo(x + curve, y);
      ctx.lineTo(x + width - curve, y);
      ctx.quadraticCurveTo(x + width, y + height / 2, x + width - curve, y + height);
      ctx.lineTo(x + curve, y + height);
      ctx.quadraticCurveTo(x, y + height / 2, x + curve, y);
      ctx.closePath();
      return true;
    }

    case 'flowChartDelay': {
      ctx.moveTo(x, y);
      ctx.lineTo(x + width / 2, y);
      ctx.arc(x + width / 2, y + height / 2, height / 2, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(x, y + height);
      ctx.closePath();
      return true;
    }

    case 'flowChartAlternateProcess': {
      const radius = Math.min(width, height) * 0.1;
      ctx.roundRect(x, y, width, height, radius);
      return true;
    }

    case 'flowChartOffpageConnector': {
      const pointHeight = height * 0.2;
      ctx.moveTo(x, y);
      ctx.lineTo(x + width, y);
      ctx.lineTo(x + width, y + height - pointHeight);
      ctx.lineTo(x + width / 2, y + height);
      ctx.lineTo(x, y + height - pointHeight);
      ctx.closePath();
      return true;
    }

    default:
      return false;
  }
}
