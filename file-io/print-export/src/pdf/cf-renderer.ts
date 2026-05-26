/**
 * Conditional Formatting Renderer -- renders data bars, icon sets, and color scales.
 *
 * Handles the visual output of conditional formatting rules in PDF export:
 * - Data bars: solid/gradient fill bars with optional axis and negative bars
 * - Icon sets: vector icons (arrows, traffic lights, symbols, ratings)
 * - Color scales: background color interpolation
 * - Style overrides: font/fill/border changes from CF rules
 *
 * The CF evaluation (which rules apply, what values to use) happens
 * upstream. This renderer only handles the drawing.
 */

import type { RenderBackend } from '@mog/pdf-graphics';
import type { CellBounds, CellFormat } from './cell-renderer';
import type { FontResolver } from './font-resolver';

// ============================================================================
// Types
// ============================================================================

/** Result of conditional formatting evaluation */
export interface CFResult {
  /** Style overrides from CF rules */
  styleOverrides?: Partial<CellFormat>;
  /** Data bar rendering data */
  dataBar?: DataBarRenderData;
  /** Icon set rendering data */
  iconSet?: IconSetRenderData;
  /** Color scale computed color (0-255 RGB) */
  colorScale?: [number, number, number];
}

export interface DataBarRenderData {
  /** Fill percentage (0-1) of cell width */
  fillPercent: number;
  /** Bar color (0-255 RGB) */
  color: [number, number, number];
  /** Negative bar color (0-255 RGB) */
  negativeColor?: [number, number, number];
  /** Whether to show the cell value text */
  showValue: boolean;
  /** Whether this is a negative value (bar extends left from axis) */
  isNegative: boolean;
  /** Axis position as percentage from left (0-1), undefined = no axis */
  axisPosition?: number;
  /** Fill type */
  fillType: 'solid' | 'gradient';
}

export interface IconSetRenderData {
  /** Icon identifier (e.g., "3arrows-up", "3trafficlights-green") */
  iconId: string;
  /** Whether to hide cell value and show only icon */
  iconOnly: boolean;
}

// ============================================================================
// Icon Definitions
// ============================================================================

/**
 * Vector icon definitions for common icon sets.
 * Each icon is a function that draws into the given bounds using the backend.
 */
type IconDrawFn = (backend: RenderBackend, x: number, y: number, size: number) => void;

/** Draw an upward-pointing triangle (green arrow up) */
function drawArrowUp(backend: RenderBackend, x: number, y: number, size: number): void {
  backend.setFillColor(0, 0.5, 0); // green
  backend.beginPath();
  backend.moveTo(x + size / 2, y);
  backend.lineTo(x + size, y + size);
  backend.lineTo(x, y + size);
  backend.closePath();
  backend.fill();
}

/** Draw a rightward-pointing diamond (yellow arrow right) */
function drawArrowRight(backend: RenderBackend, x: number, y: number, size: number): void {
  backend.setFillColor(0.8, 0.8, 0); // yellow
  backend.beginPath();
  backend.moveTo(x + size / 2, y);
  backend.lineTo(x + size, y + size / 2);
  backend.lineTo(x + size / 2, y + size);
  backend.lineTo(x, y + size / 2);
  backend.closePath();
  backend.fill();
}

/** Draw a downward-pointing triangle (red arrow down) */
function drawArrowDown(backend: RenderBackend, x: number, y: number, size: number): void {
  backend.setFillColor(1, 0, 0); // red
  backend.beginPath();
  backend.moveTo(x, y);
  backend.lineTo(x + size, y);
  backend.lineTo(x + size / 2, y + size);
  backend.closePath();
  backend.fill();
}

/** Draw an upward-diagonal arrow (4Arrows set) */
function drawArrowDiagonalUp(backend: RenderBackend, x: number, y: number, size: number): void {
  backend.setFillColor(0.5, 0.75, 0); // yellow-green
  backend.beginPath();
  backend.moveTo(x + size * 0.75, y);
  backend.lineTo(x + size, y);
  backend.lineTo(x + size, y + size * 0.25);
  backend.lineTo(x + size * 0.25, y + size);
  backend.lineTo(x, y + size);
  backend.lineTo(x, y + size * 0.75);
  backend.closePath();
  backend.fill();
}

/** Draw a downward-diagonal arrow (4Arrows set) */
function drawArrowDiagonalDown(backend: RenderBackend, x: number, y: number, size: number): void {
  backend.setFillColor(1, 0.5, 0); // orange
  backend.beginPath();
  backend.moveTo(x, y + size * 0.25);
  backend.lineTo(x, y);
  backend.lineTo(x + size * 0.25, y);
  backend.lineTo(x + size, y + size * 0.75);
  backend.lineTo(x + size, y + size);
  backend.lineTo(x + size * 0.75, y + size);
  backend.closePath();
  backend.fill();
}

/** Draw a filled circle with a given color */
function drawCircle(
  backend: RenderBackend,
  x: number,
  y: number,
  size: number,
  r: number,
  g: number,
  b: number,
): void {
  backend.setFillColor(r, g, b);
  const cx = x + size / 2;
  const cy = y + size / 2;
  const radius = size / 2;
  // Approximate circle with 4 cubic bezier curves
  const k = 0.5522847498; // magic number for circular arc approximation
  const kr = k * radius;
  backend.beginPath();
  backend.moveTo(cx + radius, cy);
  backend.curveTo(cx + radius, cy + kr, cx + kr, cy + radius, cx, cy + radius);
  backend.curveTo(cx - kr, cy + radius, cx - radius, cy + kr, cx - radius, cy);
  backend.curveTo(cx - radius, cy - kr, cx - kr, cy - radius, cx, cy - radius);
  backend.curveTo(cx + kr, cy - radius, cx + radius, cy - kr, cx + radius, cy);
  backend.closePath();
  backend.fill();
}

/** Draw a green traffic light (green circle) */
function drawTrafficGreen(backend: RenderBackend, x: number, y: number, size: number): void {
  drawCircle(backend, x, y, size, 0, 0.5, 0);
}

/** Draw a yellow traffic light (yellow circle) */
function drawTrafficYellow(backend: RenderBackend, x: number, y: number, size: number): void {
  drawCircle(backend, x, y, size, 0.8, 0.8, 0);
}

/** Draw a red traffic light (red circle) */
function drawTrafficRed(backend: RenderBackend, x: number, y: number, size: number): void {
  drawCircle(backend, x, y, size, 1, 0, 0);
}

/** Draw a green checkmark */
function drawCheckmark(backend: RenderBackend, x: number, y: number, size: number): void {
  backend.setStrokeColor(0, 0.5, 0);
  backend.setLineWidth(size * 0.15);
  backend.setLineCap('round');
  backend.setLineJoin('round');
  backend.beginPath();
  backend.moveTo(x + size * 0.15, y + size * 0.55);
  backend.lineTo(x + size * 0.4, y + size * 0.8);
  backend.lineTo(x + size * 0.85, y + size * 0.2);
  backend.stroke();
}

/** Draw a yellow exclamation mark */
function drawExclamation(backend: RenderBackend, x: number, y: number, size: number): void {
  backend.setFillColor(0.8, 0.8, 0);
  // Triangle background
  backend.beginPath();
  backend.moveTo(x + size / 2, y);
  backend.lineTo(x + size, y + size);
  backend.lineTo(x, y + size);
  backend.closePath();
  backend.fill();
  // Exclamation mark line (dark)
  backend.setStrokeColor(0, 0, 0);
  backend.setLineWidth(size * 0.1);
  backend.setLineCap('round');
  backend.beginPath();
  backend.moveTo(x + size / 2, y + size * 0.3);
  backend.lineTo(x + size / 2, y + size * 0.6);
  backend.stroke();
  // Exclamation mark dot
  drawCircle(backend, x + size * 0.4, y + size * 0.7, size * 0.15, 0, 0, 0);
}

/** Draw a red X */
function drawXMark(backend: RenderBackend, x: number, y: number, size: number): void {
  backend.setStrokeColor(1, 0, 0);
  backend.setLineWidth(size * 0.15);
  backend.setLineCap('round');
  backend.setLineJoin('round');
  backend.beginPath();
  backend.moveTo(x + size * 0.2, y + size * 0.2);
  backend.lineTo(x + size * 0.8, y + size * 0.8);
  backend.stroke();
  backend.beginPath();
  backend.moveTo(x + size * 0.8, y + size * 0.2);
  backend.lineTo(x + size * 0.2, y + size * 0.8);
  backend.stroke();
}

/** Draw a filled star */
function drawFilledStar(backend: RenderBackend, x: number, y: number, size: number): void {
  backend.setFillColor(0.9, 0.7, 0); // gold
  const cx = x + size / 2;
  const cy = y + size / 2;
  const outer = size / 2;
  const inner = size / 5;
  backend.beginPath();
  for (let i = 0; i < 5; i++) {
    const outerAngle = ((i * 72 - 90) * Math.PI) / 180;
    const innerAngle = ((i * 72 + 36 - 90) * Math.PI) / 180;
    const ox = cx + outer * Math.cos(outerAngle);
    const oy = cy + outer * Math.sin(outerAngle);
    const ix = cx + inner * Math.cos(innerAngle);
    const iy = cy + inner * Math.sin(innerAngle);
    if (i === 0) {
      backend.moveTo(ox, oy);
    } else {
      backend.lineTo(ox, oy);
    }
    backend.lineTo(ix, iy);
  }
  backend.closePath();
  backend.fill();
}

/** Draw an empty star (outline only) */
function drawEmptyStar(backend: RenderBackend, x: number, y: number, size: number): void {
  backend.setStrokeColor(0.6, 0.6, 0.6); // gray
  backend.setFillColor(1, 1, 1); // white
  backend.setLineWidth(0.5);
  const cx = x + size / 2;
  const cy = y + size / 2;
  const outer = size / 2;
  const inner = size / 5;
  backend.beginPath();
  for (let i = 0; i < 5; i++) {
    const outerAngle = ((i * 72 - 90) * Math.PI) / 180;
    const innerAngle = ((i * 72 + 36 - 90) * Math.PI) / 180;
    const ox = cx + outer * Math.cos(outerAngle);
    const oy = cy + outer * Math.sin(outerAngle);
    const ix = cx + inner * Math.cos(innerAngle);
    const iy = cy + inner * Math.sin(innerAngle);
    if (i === 0) {
      backend.moveTo(ox, oy);
    } else {
      backend.lineTo(ox, oy);
    }
    backend.lineTo(ix, iy);
  }
  backend.closePath();
  backend.fillAndStroke();
}

/**
 * Registry of icon draw functions by icon ID.
 */
const ICON_REGISTRY: Record<string, IconDrawFn> = {
  // 3Arrows
  '3arrows-up': drawArrowUp,
  '3arrows-right': drawArrowRight,
  '3arrows-down': drawArrowDown,

  // 4Arrows
  '4arrows-up': drawArrowUp,
  '4arrows-diagonal-up': drawArrowDiagonalUp,
  '4arrows-diagonal-down': drawArrowDiagonalDown,
  '4arrows-down': drawArrowDown,

  // 3TrafficLights
  '3trafficlights-green': drawTrafficGreen,
  '3trafficlights-yellow': drawTrafficYellow,
  '3trafficlights-red': drawTrafficRed,

  // 3Symbols
  '3symbols-check': drawCheckmark,
  '3symbols-exclamation': drawExclamation,
  '3symbols-x': drawXMark,
};

/**
 * Get the draw function for a 5Rating icon.
 * Rating icons are 1-5 filled stars + remaining empty stars.
 */
function getRatingDrawFn(rating: number): IconDrawFn {
  return (backend, x, y, size) => {
    const starSize = size * 0.9;
    // In a single-icon slot, we draw the appropriate filled/empty star
    if (rating > 0) {
      drawFilledStar(backend, x, y, starSize);
    } else {
      drawEmptyStar(backend, x, y, starSize);
    }
  };
}

// ============================================================================
// Constants
// ============================================================================

/** Default icon size in points */
const ICON_SIZE = 16;

/** Padding between icon and cell text in points */
const ICON_TEXT_GAP = 4;

/** Cell padding in points */
const CELL_PADDING = 2;

/** Axis line width in points */
const AXIS_LINE_WIDTH = 1;

/** Data bar vertical padding as fraction of cell height */
const BAR_VERTICAL_PADDING = 0.15;

// ============================================================================
// CFRenderer
// ============================================================================

/**
 * Renders conditional formatting visuals: data bars, icon sets, and color scales.
 */
export class CFRenderer {
  constructor(
    private backend: RenderBackend,
    _fontResolver: FontResolver,
  ) {}

  /**
   * Apply CF style overrides to a cell format, returning a new merged format.
   * The CF overrides take precedence over the base format.
   */
  applyCFOverrides(format: CellFormat, cfResult: CFResult): CellFormat {
    const hasOverrides = !!cfResult.styleOverrides;
    const hasColorScale = !!cfResult.colorScale;

    if (!hasOverrides && !hasColorScale) return format;

    const result = hasOverrides ? { ...format, ...cfResult.styleOverrides } : { ...format };

    // Color scale provides a computed background color
    if (hasColorScale) {
      result.backgroundColor = cfResult.colorScale;
    }

    return result;
  }

  /**
   * Render a data bar within cell bounds.
   *
   * Data bars are horizontal bars that fill a percentage of the cell width.
   * They can be solid or gradient, and support negative values with a
   * separate color and an axis line.
   */
  renderDataBar(bar: DataBarRenderData, bounds: CellBounds): void {
    this.backend.save();

    const barTop = bounds.y + bounds.height * BAR_VERTICAL_PADDING;
    const barHeight = bounds.height * (1 - 2 * BAR_VERTICAL_PADDING);

    if (bar.isNegative && bar.axisPosition !== undefined) {
      // Negative bar: extends leftward from axis
      const axisX = bounds.x + bounds.width * bar.axisPosition;
      const barWidth = bounds.width * bar.axisPosition * bar.fillPercent;
      const barX = axisX - barWidth;

      this.drawBarFill(
        barX,
        barTop,
        barWidth,
        barHeight,
        bar.negativeColor ?? bar.color,
        bar.fillType,
      );
    } else if (bar.axisPosition !== undefined) {
      // Positive bar with axis: extends rightward from axis
      const axisX = bounds.x + bounds.width * bar.axisPosition;
      const availableWidth = bounds.width * (1 - bar.axisPosition);
      const barWidth = availableWidth * bar.fillPercent;

      this.drawBarFill(axisX, barTop, barWidth, barHeight, bar.color, bar.fillType);
    } else {
      // Simple bar: extends from left edge
      const barWidth = bounds.width * bar.fillPercent;

      this.drawBarFill(bounds.x, barTop, barWidth, barHeight, bar.color, bar.fillType);
    }

    // Draw axis line if present
    if (bar.axisPosition !== undefined) {
      const axisX = bounds.x + bounds.width * bar.axisPosition;
      this.backend.setStrokeColor(0, 0, 0);
      this.backend.setLineWidth(AXIS_LINE_WIDTH);
      this.backend.setLineDash([], 0);
      this.backend.beginPath();
      this.backend.moveTo(axisX, bounds.y);
      this.backend.lineTo(axisX, bounds.y + bounds.height);
      this.backend.stroke();
    }

    this.backend.restore();
  }

  /**
   * Render an icon from an icon set within cell bounds.
   *
   * The icon is positioned at the left edge of the cell.
   * If iconOnly is true, only the icon is drawn (no text).
   * The icon size is fixed at 16x16pt.
   *
   * Returns the horizontal offset for text rendering (icon width + gap).
   */
  renderIcon(iconSet: IconSetRenderData, bounds: CellBounds): number {
    this.backend.save();

    const iconX = bounds.x + CELL_PADDING;
    const iconY = bounds.y + (bounds.height - ICON_SIZE) / 2;

    // Look up icon in registry
    const drawFn = ICON_REGISTRY[iconSet.iconId];
    if (drawFn) {
      drawFn(this.backend, iconX, iconY, ICON_SIZE);
    } else if (iconSet.iconId.startsWith('5rating-')) {
      // Handle rating icons: "5rating-3" means 3 filled stars
      const rating = parseInt(iconSet.iconId.split('-')[1], 10);
      const fn = getRatingDrawFn(rating);
      fn(this.backend, iconX, iconY, ICON_SIZE);
    } else {
      // Unknown icon: draw a gray placeholder square
      this.backend.setStrokeColor(0.6, 0.6, 0.6);
      this.backend.setLineWidth(0.5);
      this.backend.beginPath();
      this.backend.rect(iconX, iconY, ICON_SIZE, ICON_SIZE);
      this.backend.stroke();
    }

    this.backend.restore();

    // Return the text offset: icon width + gap
    return ICON_SIZE + ICON_TEXT_GAP;
  }

  /**
   * Render a color scale background within cell bounds.
   * The color is applied as a solid fill behind the cell content.
   */
  renderColorScale(color: [number, number, number], bounds: CellBounds): void {
    this.backend.save();

    const [r, g, b] = color;
    this.backend.setFillColor(r / 255, g / 255, b / 255);
    this.backend.beginPath();
    this.backend.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    this.backend.fill();

    this.backend.restore();
  }

  // ========================================================================
  // Private Helpers
  // ========================================================================

  /**
   * Draw a bar fill (solid or gradient) at the given position.
   */
  private drawBarFill(
    x: number,
    y: number,
    width: number,
    height: number,
    color: [number, number, number],
    fillType: 'solid' | 'gradient',
  ): void {
    if (width <= 0) return;

    const [r, g, b] = color;

    if (fillType === 'gradient') {
      // Gradient: simulate with two rectangles (bar color -> lighter shade)
      // Left half: full color; Right half: lighter color
      const halfWidth = width / 2;

      this.backend.setFillColor(r / 255, g / 255, b / 255);
      this.backend.beginPath();
      this.backend.rect(x, y, halfWidth, height);
      this.backend.fill();

      // Lighter shade: blend toward white
      const lr = Math.min(1, r / 255 + 0.3);
      const lg = Math.min(1, g / 255 + 0.3);
      const lb = Math.min(1, b / 255 + 0.3);
      this.backend.setFillColor(lr, lg, lb);
      this.backend.beginPath();
      this.backend.rect(x + halfWidth, y, width - halfWidth, height);
      this.backend.fill();
    } else {
      // Solid fill
      this.backend.setFillColor(r / 255, g / 255, b / 255);
      this.backend.beginPath();
      this.backend.rect(x, y, width, height);
      this.backend.fill();
    }

    // Border around the bar
    this.backend.setStrokeColor((r / 255) * 0.7, (g / 255) * 0.7, (b / 255) * 0.7);
    this.backend.setLineWidth(0.5);
    this.backend.setLineDash([], 0);
    this.backend.beginPath();
    this.backend.rect(x, y, width, height);
    this.backend.stroke();
  }
}
