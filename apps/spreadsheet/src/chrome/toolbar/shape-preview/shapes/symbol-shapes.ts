/**
 * Symbol Shape Drawings
 *
 * Drawing functions for symbol shapes including icons, special shapes,
 * ribbons, banners, and decorative elements.
 *
 * @module components/toolbar/shape-preview/shapes/symbol-shapes
 */

import type { ShapeType } from '@mog-sdk/contracts/floating-objects';

import type { ShapeBounds } from '../types';

/**
 * Draw a symbol shape path on canvas context.
 * Handles various symbol and decorative shapes.
 *
 * Note: This function does NOT call ctx.beginPath() - the caller handles that.
 *
 * @param ctx - Canvas 2D context
 * @param shapeType - Type of shape to draw
 * @param bounds - Bounding box for the shape
 * @returns true if shape was drawn, false if not handled
 */
export function drawSymbolShape(
  ctx: CanvasRenderingContext2D,
  shapeType: ShapeType,
  bounds: ShapeBounds,
): boolean {
  const { x, y, width, height } = bounds;

  switch (shapeType) {
    // Symbols
    case 'lightningBolt': {
      ctx.moveTo(x + width * 0.6, y);
      ctx.lineTo(x + width * 0.35, y + height * 0.45);
      ctx.lineTo(x + width * 0.55, y + height * 0.45);
      ctx.lineTo(x + width * 0.2, y + height);
      ctx.lineTo(x + width * 0.5, y + height * 0.55);
      ctx.lineTo(x + width * 0.35, y + height * 0.55);
      ctx.lineTo(x + width * 0.75, y);
      ctx.closePath();
      return true;
    }

    case 'sun': {
      const cx = x + width / 2;
      const cy = y + height / 2;
      const innerRadius = Math.min(width, height) * 0.25;
      const outerRadius = Math.min(width, height) * 0.45;
      const rays = 12;
      ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2);
      for (let i = 0; i < rays; i++) {
        const angle = (i / rays) * Math.PI * 2;
        ctx.moveTo(cx + innerRadius * Math.cos(angle), cy + innerRadius * Math.sin(angle));
        ctx.lineTo(cx + outerRadius * Math.cos(angle), cy + outerRadius * Math.sin(angle));
      }
      return true;
    }

    case 'moon': {
      const cx = x + width / 2;
      const cy = y + height / 2;
      const radius = Math.min(width, height) / 2;
      const offset = radius * 0.3;
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.arc(cx + offset, cy - offset, radius * 0.9, 0, Math.PI * 2);
      return true;
    }

    case 'smileyFace': {
      const cx = x + width / 2;
      const cy = y + height / 2;
      const radius = Math.min(width, height) / 2;
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      // Eyes
      ctx.moveTo(cx - radius * 0.3, cy - radius * 0.2);
      ctx.arc(cx - radius * 0.3, cy - radius * 0.2, radius * 0.1, 0, Math.PI * 2);
      ctx.moveTo(cx + radius * 0.3, cy - radius * 0.2);
      ctx.arc(cx + radius * 0.3, cy - radius * 0.2, radius * 0.1, 0, Math.PI * 2);
      // Smile
      ctx.moveTo(cx - radius * 0.4, cy + radius * 0.1);
      ctx.quadraticCurveTo(cx, cy + radius * 0.5, cx + radius * 0.4, cy + radius * 0.1);
      return true;
    }

    case 'foldedCorner': {
      const fold = Math.min(width, height) * 0.25;
      ctx.moveTo(x, y);
      ctx.lineTo(x + width - fold, y);
      ctx.lineTo(x + width, y + fold);
      ctx.lineTo(x + width, y + height);
      ctx.lineTo(x, y + height);
      ctx.closePath();
      ctx.moveTo(x + width - fold, y);
      ctx.lineTo(x + width - fold, y + fold);
      ctx.lineTo(x + width, y + fold);
      return true;
    }

    case 'bevel': {
      const bevel = Math.min(width, height) * 0.1;
      ctx.moveTo(x + bevel, y);
      ctx.lineTo(x + width - bevel, y);
      ctx.lineTo(x + width, y + bevel);
      ctx.lineTo(x + width, y + height - bevel);
      ctx.lineTo(x + width - bevel, y + height);
      ctx.lineTo(x + bevel, y + height);
      ctx.lineTo(x, y + height - bevel);
      ctx.lineTo(x, y + bevel);
      ctx.closePath();
      return true;
    }

    case 'frame': {
      const frameWidth = Math.min(width, height) * 0.15;
      ctx.rect(x, y, width, height);
      ctx.rect(x + frameWidth, y + frameWidth, width - frameWidth * 2, height - frameWidth * 2);
      return true;
    }

    case 'halfFrame': {
      const frameWidth = Math.min(width, height) * 0.15;
      ctx.moveTo(x, y);
      ctx.lineTo(x + width, y);
      ctx.lineTo(x + width, y + height);
      ctx.lineTo(x + frameWidth, y + height);
      ctx.lineTo(x + frameWidth, y + frameWidth);
      ctx.lineTo(x, y + frameWidth);
      ctx.closePath();
      return true;
    }

    case 'corner': {
      const cornerWidth = Math.min(width, height) * 0.3;
      ctx.moveTo(x, y);
      ctx.lineTo(x + width, y);
      ctx.lineTo(x + width, y + cornerWidth);
      ctx.lineTo(x + cornerWidth, y + cornerWidth);
      ctx.lineTo(x + cornerWidth, y + height);
      ctx.lineTo(x, y + height);
      ctx.closePath();
      return true;
    }

    case 'diagStripe': {
      const stripeWidth = Math.min(width, height) * 0.25;
      ctx.moveTo(x, y + stripeWidth);
      ctx.lineTo(x + width - stripeWidth, y);
      ctx.lineTo(x + width, y);
      ctx.lineTo(x + width, y + stripeWidth);
      ctx.lineTo(x + stripeWidth, y + height);
      ctx.lineTo(x, y + height);
      ctx.closePath();
      return true;
    }

    case 'chord': {
      const cx = x + width / 2;
      const cy = y + height / 2;
      const radius = Math.min(width, height) / 2;
      ctx.arc(cx, cy, radius, -Math.PI / 4, (Math.PI * 5) / 4);
      ctx.closePath();
      return true;
    }

    case 'can': {
      const ellipseHeight = height * 0.15;
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

    case 'cube': {
      const depth = Math.min(width, height) * 0.3;
      // Front face
      ctx.moveTo(x, y + depth);
      ctx.lineTo(x, y + height);
      ctx.lineTo(x + width - depth, y + height);
      ctx.lineTo(x + width - depth, y + depth * 2);
      ctx.closePath();
      // Top face
      ctx.moveTo(x, y + depth);
      ctx.lineTo(x + depth, y);
      ctx.lineTo(x + width, y);
      ctx.lineTo(x + width - depth, y + depth);
      ctx.closePath();
      // Right face
      ctx.moveTo(x + width - depth, y + depth);
      ctx.lineTo(x + width, y);
      ctx.lineTo(x + width, y + height - depth);
      ctx.lineTo(x + width - depth, y + height);
      ctx.closePath();
      return true;
    }

    case 'cross': {
      const armWidth = Math.min(width, height) * 0.3;
      const cx = x + width / 2;
      const cy = y + height / 2;
      ctx.moveTo(cx - armWidth / 2, y);
      ctx.lineTo(cx + armWidth / 2, y);
      ctx.lineTo(cx + armWidth / 2, cy - armWidth / 2);
      ctx.lineTo(x + width, cy - armWidth / 2);
      ctx.lineTo(x + width, cy + armWidth / 2);
      ctx.lineTo(cx + armWidth / 2, cy + armWidth / 2);
      ctx.lineTo(cx + armWidth / 2, y + height);
      ctx.lineTo(cx - armWidth / 2, y + height);
      ctx.lineTo(cx - armWidth / 2, cy + armWidth / 2);
      ctx.lineTo(x, cy + armWidth / 2);
      ctx.lineTo(x, cy - armWidth / 2);
      ctx.lineTo(cx - armWidth / 2, cy - armWidth / 2);
      ctx.closePath();
      return true;
    }

    case 'irregularSeal1': {
      const cx = x + width / 2;
      const cy = y + height / 2;
      const points = 12;
      for (let i = 0; i < points; i++) {
        const angle = (i / points) * Math.PI * 2;
        const radius = (Math.min(width, height) / 2) * (0.7 + Math.random() * 0.3);
        const px = cx + radius * Math.cos(angle);
        const py = cy + radius * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      return true;
    }

    case 'irregularSeal2': {
      const cx = x + width / 2;
      const cy = y + height / 2;
      const points = 16;
      for (let i = 0; i < points; i++) {
        const angle = (i / points) * Math.PI * 2;
        const radius = (Math.min(width, height) / 2) * (0.6 + (i % 2) * 0.4);
        const px = cx + radius * Math.cos(angle);
        const py = cy + radius * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      return true;
    }

    case 'homePlate': {
      const pointHeight = height * 0.3;
      ctx.moveTo(x, y);
      ctx.lineTo(x + width, y);
      ctx.lineTo(x + width, y + height - pointHeight);
      ctx.lineTo(x + width / 2, y + height);
      ctx.lineTo(x, y + height - pointHeight);
      ctx.closePath();
      return true;
    }

    case 'funnel': {
      const topWidth = width * 0.9;
      const bottomWidth = width * 0.3;
      const neckHeight = height * 0.6;
      ctx.moveTo(x + (width - topWidth) / 2, y);
      ctx.lineTo(x + (width + topWidth) / 2, y);
      ctx.lineTo(x + (width + bottomWidth) / 2, y + neckHeight);
      ctx.lineTo(x + (width + bottomWidth) / 2, y + height);
      ctx.lineTo(x + (width - bottomWidth) / 2, y + height);
      ctx.lineTo(x + (width - bottomWidth) / 2, y + neckHeight);
      ctx.closePath();
      return true;
    }

    // Ribbons/Banners
    case 'ribbon':
    case 'ribbon2': {
      const fold = height * 0.2;
      ctx.moveTo(x, y + fold);
      ctx.lineTo(x + width * 0.15, y);
      ctx.lineTo(x + width * 0.85, y);
      ctx.lineTo(x + width, y + fold);
      ctx.lineTo(x + width, y + height - fold);
      ctx.lineTo(x + width * 0.85, y + height);
      ctx.lineTo(x + width * 0.85, y + height - fold * 1.5);
      ctx.lineTo(x + width * 0.5, y + height - fold);
      ctx.lineTo(x + width * 0.15, y + height - fold * 1.5);
      ctx.lineTo(x + width * 0.15, y + height);
      ctx.lineTo(x, y + height - fold);
      ctx.closePath();
      return true;
    }

    case 'banner': {
      const curve = width * 0.1;
      ctx.moveTo(x, y);
      ctx.lineTo(x + width, y);
      ctx.lineTo(x + width - curve, y + height / 2);
      ctx.lineTo(x + width, y + height);
      ctx.lineTo(x, y + height);
      ctx.lineTo(x + curve, y + height / 2);
      ctx.closePath();
      return true;
    }

    case 'ellipseRibbon':
    case 'ellipseRibbon2': {
      const cx = x + width / 2;
      const cy = y + height * 0.3;
      const ribbonHeight = height * 0.4;
      ctx.ellipse(cx, cy, width / 2, height * 0.25, 0, 0, Math.PI * 2);
      ctx.moveTo(x, cy);
      ctx.lineTo(x, cy + ribbonHeight);
      ctx.lineTo(x + width * 0.2, cy + ribbonHeight + height * 0.15);
      ctx.moveTo(x + width, cy);
      ctx.lineTo(x + width, cy + ribbonHeight);
      ctx.lineTo(x + width * 0.8, cy + ribbonHeight + height * 0.15);
      return true;
    }

    case 'leftRightRibbon': {
      const ribbonHeight = height * 0.25;
      ctx.moveTo(x, y + height / 2);
      ctx.lineTo(x + width * 0.15, y + height / 2 - ribbonHeight);
      ctx.lineTo(x + width * 0.85, y + height / 2 - ribbonHeight);
      ctx.lineTo(x + width, y + height / 2);
      ctx.lineTo(x + width * 0.85, y + height / 2 + ribbonHeight);
      ctx.lineTo(x + width * 0.15, y + height / 2 + ribbonHeight);
      ctx.closePath();
      ctx.moveTo(x + width * 0.15, y + height / 2 - ribbonHeight);
      ctx.lineTo(x + width * 0.1, y + height / 2 - ribbonHeight * 0.5);
      ctx.lineTo(x + width * 0.15, y + height / 2);
      ctx.moveTo(x + width * 0.85, y + height / 2 + ribbonHeight);
      ctx.lineTo(x + width * 0.9, y + height / 2 + ribbonHeight * 0.5);
      ctx.lineTo(x + width * 0.85, y + height / 2);
      return true;
    }

    case 'verticalScroll': {
      const curve = width * 0.15;
      ctx.moveTo(x + curve, y);
      ctx.lineTo(x + width - curve, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + curve);
      ctx.lineTo(x + width, y + height - curve);
      ctx.quadraticCurveTo(x + width, y + height, x + width - curve, y + height);
      ctx.lineTo(x + curve, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - curve);
      ctx.lineTo(x, y + curve);
      ctx.quadraticCurveTo(x, y, x + curve, y);
      ctx.ellipse(x + curve, y + curve, curve, curve / 2, 0, Math.PI, 0);
      ctx.ellipse(x + width - curve, y + height - curve, curve, curve / 2, 0, 0, Math.PI);
      return true;
    }

    case 'horizontalScroll': {
      const curve = height * 0.15;
      ctx.moveTo(x, y + curve);
      ctx.lineTo(x, y + height - curve);
      ctx.quadraticCurveTo(x, y + height, x + curve, y + height);
      ctx.lineTo(x + width - curve, y + height);
      ctx.quadraticCurveTo(x + width, y + height, x + width, y + height - curve);
      ctx.lineTo(x + width, y + curve);
      ctx.quadraticCurveTo(x + width, y, x + width - curve, y);
      ctx.lineTo(x + curve, y);
      ctx.quadraticCurveTo(x, y, x, y + curve);
      ctx.ellipse(x + curve, y + curve, curve / 2, curve, 0, Math.PI / 2, -Math.PI / 2);
      ctx.ellipse(
        x + width - curve,
        y + height - curve,
        curve / 2,
        curve,
        0,
        -Math.PI / 2,
        Math.PI / 2,
      );
      return true;
    }

    case 'heart': {
      const cx = x + width / 2;
      const top = y + height * 0.3;
      ctx.moveTo(cx, top);
      ctx.bezierCurveTo(
        cx - width / 2,
        top - height * 0.3,
        x - width * 0.1,
        top + height * 0.2,
        cx,
        y + height,
      );
      ctx.bezierCurveTo(
        x + width * 1.1,
        top + height * 0.2,
        cx + width / 2,
        top - height * 0.3,
        cx,
        top,
      );
      ctx.closePath();
      return true;
    }

    case 'plus': {
      const crossWidth = width * 0.35;
      const cx = x + width / 2;
      const cy = y + height / 2;
      // Vertical bar
      ctx.moveTo(cx - crossWidth / 2, y);
      ctx.lineTo(cx + crossWidth / 2, y);
      ctx.lineTo(cx + crossWidth / 2, cy - crossWidth / 2);
      ctx.lineTo(x + width, cy - crossWidth / 2);
      ctx.lineTo(x + width, cy + crossWidth / 2);
      ctx.lineTo(cx + crossWidth / 2, cy + crossWidth / 2);
      ctx.lineTo(cx + crossWidth / 2, y + height);
      ctx.lineTo(cx - crossWidth / 2, y + height);
      ctx.lineTo(cx - crossWidth / 2, cy + crossWidth / 2);
      ctx.lineTo(x, cy + crossWidth / 2);
      ctx.lineTo(x, cy - crossWidth / 2);
      ctx.lineTo(cx - crossWidth / 2, cy - crossWidth / 2);
      ctx.closePath();
      return true;
    }

    default:
      return false;
  }
}
