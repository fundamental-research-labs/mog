/**
 * Icon Set Renderer
 *
 * Renders conditional formatting icons (arrows, flags, ratings, traffic lights,
 * stars, symbols, etc.) using canvas path drawing for crisp rendering at any size.
 * Supports all 21 Excel-compatible icon set types with 3, 4, or 5 icons each.
 *
 * Ported from grid-canvas/src/conditional-formats/icon-set-renderer.ts.
 *
 * @module grid-renderer/cells/icon-sets
 */

import type { IconData } from '@mog-sdk/contracts/rendering';

// =============================================================================
// Types
// =============================================================================

export interface IconRenderOptions {
  /** Cell bounds */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Icon size in pixels (default: based on cell height) */
  size?: number;
  /** Padding from left edge */
  padding?: number;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_PADDING = 3;
const ICON_SIZE_RATIO = 0.6; // Icon size relative to cell height

// =============================================================================
// Icon Colors
// =============================================================================

/**
 * Color palettes for different icon sets.
 * Each array contains colors from "best" to "worst" icon.
 */
const ICON_COLORS: Record<string, string[]> = {
  // 3-icon arrows: green up, yellow side, red down
  '3Arrows': ['#00B050', '#FFC000', '#FF0000'],
  '3ArrowsGray': ['#636363', '#A5A5A5', '#D9D9D9'],

  // 3-icon flags: green, yellow, red
  '3Flags': ['#00B050', '#FFC000', '#FF0000'],

  // 3-icon traffic lights
  '3TrafficLights1': ['#00B050', '#FFC000', '#FF0000'],
  '3TrafficLights2': ['#00B050', '#FFC000', '#FF0000'],

  // 3-icon signs
  '3Signs': ['#00B050', '#FFC000', '#FF0000'],

  // 3-icon symbols
  '3Symbols': ['#00B050', '#FFC000', '#FF0000'],
  '3Symbols2': ['#00B050', '#FFC000', '#FF0000'],

  // 3-icon stars
  '3Stars': ['#FFD700', '#FFD700', '#FFD700'],

  // 3-icon triangles
  '3Triangles': ['#00B050', '#FFC000', '#FF0000'],

  // 4-icon arrows
  '4Arrows': ['#00B050', '#90EE90', '#FFA500', '#FF0000'],
  '4ArrowsGray': ['#404040', '#707070', '#A0A0A0', '#D0D0D0'],

  // 4-icon ratings
  '4Rating': ['#000000', '#000000', '#000000', '#000000'],

  // 4-icon red to black
  '4RedToBlack': ['#000000', '#404040', '#800000', '#FF0000'],

  // 4-icon traffic lights
  '4TrafficLights': ['#00B050', '#90EE90', '#FFC000', '#FF0000'],

  // 5-icon arrows
  '5Arrows': ['#00B050', '#90EE90', '#FFC000', '#FFA500', '#FF0000'],
  '5ArrowsGray': ['#303030', '#505050', '#808080', '#A0A0A0', '#D0D0D0'],

  // 5-icon ratings
  '5Rating': ['#000000', '#000000', '#000000', '#000000', '#000000'],

  // 5-icon quarters
  '5Quarters': ['#000000', '#000000', '#000000', '#000000', '#000000'],

  // 5-icon boxes
  '5Boxes': ['#00B050', '#90EE90', '#FFC000', '#FFA500', '#FF0000'],
};

// =============================================================================
// Icon Drawing Functions
// =============================================================================

type IconDrawFn = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
) => void;

/** Draw an up arrow. */
const drawUpArrow: IconDrawFn = (ctx, x, y, size, color) => {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + size / 2, y);
  ctx.lineTo(x + size, y + size * 0.6);
  ctx.lineTo(x + size * 0.65, y + size * 0.6);
  ctx.lineTo(x + size * 0.65, y + size);
  ctx.lineTo(x + size * 0.35, y + size);
  ctx.lineTo(x + size * 0.35, y + size * 0.6);
  ctx.lineTo(x, y + size * 0.6);
  ctx.closePath();
  ctx.fill();
};

/** Draw a down arrow. */
const drawDownArrow: IconDrawFn = (ctx, x, y, size, color) => {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + size / 2, y + size);
  ctx.lineTo(x + size, y + size * 0.4);
  ctx.lineTo(x + size * 0.65, y + size * 0.4);
  ctx.lineTo(x + size * 0.65, y);
  ctx.lineTo(x + size * 0.35, y);
  ctx.lineTo(x + size * 0.35, y + size * 0.4);
  ctx.lineTo(x, y + size * 0.4);
  ctx.closePath();
  ctx.fill();
};

/** Draw a right arrow (horizontal). */
const drawRightArrow: IconDrawFn = (ctx, x, y, size, color) => {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + size, y + size / 2);
  ctx.lineTo(x + size * 0.4, y);
  ctx.lineTo(x + size * 0.4, y + size * 0.35);
  ctx.lineTo(x, y + size * 0.35);
  ctx.lineTo(x, y + size * 0.65);
  ctx.lineTo(x + size * 0.4, y + size * 0.65);
  ctx.lineTo(x + size * 0.4, y + size);
  ctx.closePath();
  ctx.fill();
};

/** Draw an up-right diagonal arrow. */
const drawUpRightArrow: IconDrawFn = (ctx, x, y, size, color) => {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + size, y);
  ctx.lineTo(x + size, y + size * 0.6);
  ctx.lineTo(x + size * 0.75, y + size * 0.45);
  ctx.lineTo(x + size * 0.35, y + size * 0.85);
  ctx.lineTo(x + size * 0.15, y + size * 0.65);
  ctx.lineTo(x + size * 0.55, y + size * 0.25);
  ctx.lineTo(x + size * 0.4, y);
  ctx.closePath();
  ctx.fill();
};

/** Draw a down-right diagonal arrow. */
const drawDownRightArrow: IconDrawFn = (ctx, x, y, size, color) => {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + size, y + size);
  ctx.lineTo(x + size * 0.4, y + size);
  ctx.lineTo(x + size * 0.55, y + size * 0.75);
  ctx.lineTo(x + size * 0.15, y + size * 0.35);
  ctx.lineTo(x + size * 0.35, y + size * 0.15);
  ctx.lineTo(x + size * 0.75, y + size * 0.55);
  ctx.lineTo(x + size, y + size * 0.4);
  ctx.closePath();
  ctx.fill();
};

/** Draw a circle (traffic light, etc). */
const drawCircle: IconDrawFn = (ctx, x, y, size, color) => {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
};

/** Draw a flag. */
const drawFlag: IconDrawFn = (ctx, x, y, size, color) => {
  // Pole
  ctx.fillStyle = '#808080';
  ctx.fillRect(x + size * 0.15, y, size * 0.08, size);

  // Flag
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + size * 0.23, y);
  ctx.lineTo(x + size, y + size * 0.15);
  ctx.lineTo(x + size * 0.23, y + size * 0.5);
  ctx.closePath();
  ctx.fill();
};

/** Draw an up triangle. */
const drawTriangleUp: IconDrawFn = (ctx, x, y, size, color) => {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + size / 2, y);
  ctx.lineTo(x + size, y + size);
  ctx.lineTo(x, y + size);
  ctx.closePath();
  ctx.fill();
};

/** Draw a down triangle. */
const drawTriangleDown: IconDrawFn = (ctx, x, y, size, color) => {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + size / 2, y + size);
  ctx.lineTo(x + size, y);
  ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fill();
};

/** Draw a diamond/rhombus. */
const drawDiamond: IconDrawFn = (ctx, x, y, size, color) => {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + size / 2, y);
  ctx.lineTo(x + size, y + size / 2);
  ctx.lineTo(x + size / 2, y + size);
  ctx.lineTo(x, y + size / 2);
  ctx.closePath();
  ctx.fill();
};

/** Draw a checkmark. */
const drawCheck: IconDrawFn = (ctx, x, y, size, color) => {
  ctx.strokeStyle = color;
  ctx.lineWidth = size * 0.15;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x + size * 0.15, y + size * 0.5);
  ctx.lineTo(x + size * 0.4, y + size * 0.75);
  ctx.lineTo(x + size * 0.85, y + size * 0.25);
  ctx.stroke();
};

/** Draw an X mark. */
const drawX: IconDrawFn = (ctx, x, y, size, color) => {
  ctx.strokeStyle = color;
  ctx.lineWidth = size * 0.15;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x + size * 0.2, y + size * 0.2);
  ctx.lineTo(x + size * 0.8, y + size * 0.8);
  ctx.moveTo(x + size * 0.8, y + size * 0.2);
  ctx.lineTo(x + size * 0.2, y + size * 0.8);
  ctx.stroke();
};

/** Draw an exclamation mark. */
const drawExclamation: IconDrawFn = (ctx, x, y, size, color) => {
  ctx.fillStyle = color;
  // Vertical bar
  ctx.fillRect(x + size * 0.4, y + size * 0.1, size * 0.2, size * 0.5);
  // Dot
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size * 0.8, size * 0.1, 0, Math.PI * 2);
  ctx.fill();
};

/** Draw a star (filled based on rating). */
const drawStar: IconDrawFn = (ctx, x, y, size, color) => {
  ctx.fillStyle = color;
  ctx.beginPath();
  const cx = x + size / 2;
  const cy = y + size / 2;
  const outerRadius = size / 2;
  const innerRadius = size / 4;
  const spikes = 5;

  for (let i = 0; i < spikes * 2; i++) {
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = Math.PI / 2 + (i * Math.PI) / spikes;
    const px = cx + Math.cos(angle) * radius;
    const py = cy - Math.sin(angle) * radius;
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
  ctx.fill();
};

/** Draw a quarter pie. */
const drawQuarterPie = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  quarters: number,
): void => {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const radius = size / 2 - 1;

  // Draw circle outline
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  // Fill quarters
  if (quarters > 0) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + (quarters / 4) * Math.PI * 2);
    ctx.closePath();
    ctx.fill();
  }
};

/** Draw a rating bar (filled bars). */
const drawRatingBar = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  filled: number,
  total: number,
): void => {
  const barWidth = size / total - 2;
  const barHeight = size * 0.8;
  const barY = y + (size - barHeight) / 2;

  for (let i = 0; i < total; i++) {
    const barX = x + i * (barWidth + 2);
    if (i < filled) {
      ctx.fillStyle = color;
      ctx.fillRect(barX, barY, barWidth, barHeight);
    } else {
      ctx.strokeStyle = '#D0D0D0';
      ctx.lineWidth = 1;
      ctx.strokeRect(barX + 0.5, barY + 0.5, barWidth - 1, barHeight - 1);
    }
  }
};

// =============================================================================
// Icon Set Mapping
// =============================================================================

/**
 * Get the draw functions for each icon in a set.
 */
function getIconDrawFunctions(setName: string): IconDrawFn[] {
  switch (setName) {
    case '3Arrows':
    case '3ArrowsGray':
      return [drawUpArrow, drawRightArrow, drawDownArrow];

    case '4Arrows':
    case '4ArrowsGray':
      return [drawUpArrow, drawUpRightArrow, drawDownRightArrow, drawDownArrow];

    case '5Arrows':
    case '5ArrowsGray':
      return [drawUpArrow, drawUpRightArrow, drawRightArrow, drawDownRightArrow, drawDownArrow];

    case '3Flags':
      return [drawFlag, drawFlag, drawFlag];

    case '3TrafficLights1':
    case '3TrafficLights2':
    case '4TrafficLights':
      return Array(setName.includes('3') ? 3 : 4).fill(drawCircle) as IconDrawFn[];

    case '3Signs':
      return [drawDiamond, drawTriangleUp, drawTriangleDown];

    case '3Symbols':
      return [drawCheck, drawExclamation, drawX];

    case '3Symbols2':
      return [drawCheck, drawExclamation, drawX];

    case '3Stars':
      return [drawStar, drawStar, drawStar];

    case '3Triangles':
      return [drawTriangleUp, drawDiamond, drawTriangleDown];

    case '4Rating':
      // Special case: rating bars
      return [
        (ctx, x, y, size, color) => drawRatingBar(ctx, x, y, size, color, 4, 4),
        (ctx, x, y, size, color) => drawRatingBar(ctx, x, y, size, color, 3, 4),
        (ctx, x, y, size, color) => drawRatingBar(ctx, x, y, size, color, 2, 4),
        (ctx, x, y, size, color) => drawRatingBar(ctx, x, y, size, color, 1, 4),
      ];

    case '4RedToBlack':
      return [drawCircle, drawCircle, drawCircle, drawCircle];

    case '5Rating':
      return [
        (ctx, x, y, size, color) => drawRatingBar(ctx, x, y, size, color, 4, 4),
        (ctx, x, y, size, color) => drawRatingBar(ctx, x, y, size, color, 3, 4),
        (ctx, x, y, size, color) => drawRatingBar(ctx, x, y, size, color, 2, 4),
        (ctx, x, y, size, color) => drawRatingBar(ctx, x, y, size, color, 1, 4),
        (ctx, x, y, size, color) => drawRatingBar(ctx, x, y, size, color, 0, 4),
      ];

    case '5Quarters':
      return [
        (ctx, x, y, size, color) => drawQuarterPie(ctx, x, y, size, color, 4),
        (ctx, x, y, size, color) => drawQuarterPie(ctx, x, y, size, color, 3),
        (ctx, x, y, size, color) => drawQuarterPie(ctx, x, y, size, color, 2),
        (ctx, x, y, size, color) => drawQuarterPie(ctx, x, y, size, color, 1),
        (ctx, x, y, size, color) => drawQuarterPie(ctx, x, y, size, color, 0),
      ];

    case '5Boxes':
      return [drawCircle, drawCircle, drawCircle, drawCircle, drawCircle];

    default:
      return [drawCircle, drawCircle, drawCircle];
  }
}

// =============================================================================
// Main Render Function
// =============================================================================

/**
 * Render an icon from a conditional formatting icon set.
 *
 * @param ctx - Canvas 2D rendering context
 * @param icon - Icon result from CF evaluation
 * @param options - Rendering options
 * @returns The width of the rendered icon area (for text offset)
 */
export function renderIcon(
  ctx: CanvasRenderingContext2D,
  icon: IconData,
  options: IconRenderOptions,
): number {
  const { x, y, height } = options;
  const padding = options.padding ?? DEFAULT_PADDING;

  // Calculate icon size
  const size = options.size ?? Math.min(height * ICON_SIZE_RATIO, 16);

  // Position icon vertically centered, left-aligned with padding
  const iconX = x + padding;
  const iconY = y + (height - size) / 2;

  // Get icon color
  const colors = ICON_COLORS[icon.setName] ?? ['#808080'];
  const color = colors[Math.min(icon.iconIndex, colors.length - 1)];

  // Get draw functions
  const drawFunctions = getIconDrawFunctions(icon.setName);
  const drawFn = drawFunctions[Math.min(icon.iconIndex, drawFunctions.length - 1)];

  // Draw the icon
  ctx.save();
  drawFn(ctx, iconX, iconY, size, color);
  ctx.restore();

  // Return total width used (for text offset)
  return padding + size + padding;
}

/**
 * Get the width that an icon will take up.
 * Useful for calculating text offset.
 */
export function getIconWidth(height: number, padding?: number): number {
  const p = padding ?? DEFAULT_PADDING;
  const size = Math.min(height * ICON_SIZE_RATIO, 16);
  return p + size + p;
}
