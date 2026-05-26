/**
 * Sparkline Renderer -- renders line, column, and win/loss sparklines in PDF export.
 *
 * Sparklines are small inline charts rendered within a single cell.
 * Three types are supported:
 * - Line: connected data points with optional marker highlights
 * - Column: vertical bars (positive/negative distinguished by color)
 * - Win/Loss: fixed-height bars above/below axis
 *
 * All rendering uses the RenderBackend interface for format-agnostic output.
 */

import type { RenderBackend } from '@mog/pdf-graphics';
import type { CellBounds } from './cell-renderer';

// ============================================================================
// Types
// ============================================================================

export interface SparklineRenderData {
  type: 'line' | 'column' | 'winLoss';
  values: number[];
  options: SparklineOptions;
}

export interface SparklineOptions {
  /** Line/bar color (0-255 RGB) */
  seriesColor: [number, number, number];
  /** Negative bar color (column/winLoss only, 0-255 RGB) */
  negativeColor?: [number, number, number];
  /** Show marker points */
  markers?: {
    high?: [number, number, number];
    low?: [number, number, number];
    first?: [number, number, number];
    last?: [number, number, number];
    negative?: [number, number, number];
    all?: [number, number, number];
  };
  /** Show axis line */
  showAxis?: boolean;
  /** Line weight for line sparklines (default: 1) */
  lineWeight?: number;
  /** Min value for scaling (auto-detected if not set) */
  minValue?: number;
  /** Max value for scaling (auto-detected if not set) */
  maxValue?: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Padding inside cell bounds for sparkline rendering */
const SPARKLINE_PADDING = 3;

/** Default marker radius in points */
const MARKER_RADIUS = 2.5;

/** Default line weight for line sparklines */
const DEFAULT_LINE_WEIGHT = 1;

/** Gap between column bars as fraction of bar width */
const COLUMN_GAP_RATIO = 0.2;

/** Axis line width */
const AXIS_LINE_WIDTH = 0.5;

// ============================================================================
// SparklineRenderer
// ============================================================================

/**
 * Renders sparklines (line, column, win/loss) within cell bounds.
 */
export class SparklineRenderer {
  constructor(private backend: RenderBackend) {}

  /**
   * Render a sparkline into the given cell bounds.
   */
  renderSparkline(data: SparklineRenderData, bounds: CellBounds): void {
    if (data.values.length === 0) return;

    // Guard: if all values are NaN/non-finite, skip rendering
    if (!data.values.some((v) => Number.isFinite(v))) return;

    switch (data.type) {
      case 'line':
        this.renderLine(data, bounds);
        break;
      case 'column':
        this.renderColumn(data, bounds);
        break;
      case 'winLoss':
        this.renderWinLoss(data, bounds);
        break;
    }
  }

  // ========================================================================
  // Line Sparkline
  // ========================================================================

  /**
   * Render a line sparkline: connected data points with optional markers.
   *
   * The line is drawn as a path using moveTo/lineTo. Marker circles are
   * drawn at special points (high, low, first, last, negative, all).
   */
  private renderLine(data: SparklineRenderData, bounds: CellBounds): void {
    const { values, options } = data;
    const { minVal, maxVal, range } = this.computeScale(values, options);
    const area = this.getPlotArea(bounds);

    this.backend.save();

    // Draw axis line if requested
    if (options.showAxis && minVal < 0 && maxVal > 0) {
      this.drawAxisLine(minVal, maxVal, range, area);
    }

    // Draw the line path
    const [r, g, b] = options.seriesColor;
    this.backend.setStrokeColor(r / 255, g / 255, b / 255);
    this.backend.setLineWidth(options.lineWeight ?? DEFAULT_LINE_WEIGHT);
    this.backend.setLineDash([], 0);
    this.backend.setLineCap('round');
    this.backend.setLineJoin('round');

    const points = this.computeLinePoints(values, minVal, range, area);

    this.backend.beginPath();
    for (let i = 0; i < points.length; i++) {
      const { x, y } = points[i];
      if (i === 0) {
        this.backend.moveTo(x, y);
      } else {
        this.backend.lineTo(x, y);
      }
    }
    this.backend.stroke();

    // Draw markers
    if (options.markers) {
      this.drawLineMarkers(values, points, options);
    }

    this.backend.restore();
  }

  /**
   * Compute the X,Y coordinates for each data point on the line.
   */
  private computeLinePoints(
    values: number[],
    minVal: number,
    range: number,
    area: PlotArea,
  ): { x: number; y: number }[] {
    const n = values.length;
    const points: { x: number; y: number }[] = [];

    for (let i = 0; i < n; i++) {
      const x = n === 1 ? area.x + area.width / 2 : area.x + (i / (n - 1)) * area.width;
      const normalized = range === 0 ? 0.5 : (values[i] - minVal) / range;
      const y = area.y + area.height - normalized * area.height;
      points.push({ x, y });
    }

    return points;
  }

  /**
   * Draw marker circles at special data points.
   */
  private drawLineMarkers(
    values: number[],
    points: { x: number; y: number }[],
    options: SparklineOptions,
  ): void {
    const markers = options.markers!;
    const n = values.length;

    // Find high and low indices
    let highIdx = 0;
    let lowIdx = 0;
    for (let i = 1; i < n; i++) {
      if (values[i] > values[highIdx]) highIdx = i;
      if (values[i] < values[lowIdx]) lowIdx = i;
    }

    for (let i = 0; i < n; i++) {
      let markerColor: [number, number, number] | undefined;

      // Check each marker condition in priority order
      if (markers.high && i === highIdx) {
        markerColor = markers.high;
      } else if (markers.low && i === lowIdx) {
        markerColor = markers.low;
      } else if (markers.first && i === 0) {
        markerColor = markers.first;
      } else if (markers.last && i === n - 1) {
        markerColor = markers.last;
      } else if (markers.negative && values[i] < 0) {
        markerColor = markers.negative;
      } else if (markers.all) {
        markerColor = markers.all;
      }

      if (markerColor) {
        this.drawMarkerCircle(points[i].x, points[i].y, markerColor);
      }
    }
  }

  /**
   * Draw a filled circle marker at the given position.
   */
  private drawMarkerCircle(cx: number, cy: number, color: [number, number, number]): void {
    const [r, g, b] = color;
    this.backend.setFillColor(r / 255, g / 255, b / 255);
    const k = 0.5522847498;
    const kr = k * MARKER_RADIUS;
    this.backend.beginPath();
    this.backend.moveTo(cx + MARKER_RADIUS, cy);
    this.backend.curveTo(
      cx + MARKER_RADIUS,
      cy + kr,
      cx + kr,
      cy + MARKER_RADIUS,
      cx,
      cy + MARKER_RADIUS,
    );
    this.backend.curveTo(
      cx - kr,
      cy + MARKER_RADIUS,
      cx - MARKER_RADIUS,
      cy + kr,
      cx - MARKER_RADIUS,
      cy,
    );
    this.backend.curveTo(
      cx - MARKER_RADIUS,
      cy - kr,
      cx - kr,
      cy - MARKER_RADIUS,
      cx,
      cy - MARKER_RADIUS,
    );
    this.backend.curveTo(
      cx + kr,
      cy - MARKER_RADIUS,
      cx + MARKER_RADIUS,
      cy - kr,
      cx + MARKER_RADIUS,
      cy,
    );
    this.backend.closePath();
    this.backend.fill();
  }

  // ========================================================================
  // Column Sparkline
  // ========================================================================

  /**
   * Render a column sparkline: vertical bars for each data point.
   *
   * Positive bars extend upward from the axis (or bottom).
   * Negative bars extend downward from the axis in a different color.
   */
  private renderColumn(data: SparklineRenderData, bounds: CellBounds): void {
    const { values, options } = data;
    const { minVal, maxVal, range } = this.computeScale(values, options);
    const area = this.getPlotArea(bounds);

    this.backend.save();

    // Compute axis Y position
    const axisY =
      range === 0
        ? area.y + area.height
        : area.y + area.height - ((0 - minVal) / range) * area.height;

    // Draw axis if requested and data spans zero
    if (options.showAxis && minVal < 0 && maxVal > 0) {
      this.drawAxisLine(minVal, maxVal, range, area);
    }

    // Compute bar geometry
    const n = values.length;
    const totalBarWidth = area.width / n;
    const gap = totalBarWidth * COLUMN_GAP_RATIO;
    const barWidth = totalBarWidth - gap;

    for (let i = 0; i < n; i++) {
      const barX = area.x + i * totalBarWidth + gap / 2;
      const value = values[i];
      const normalized = range === 0 ? 0 : Math.abs(value) / range;
      const barHeight = normalized * area.height;

      let barY: number;
      let color: [number, number, number];

      if (value >= 0) {
        barY = axisY - barHeight;
        color = options.seriesColor;
      } else {
        barY = axisY;
        color = options.negativeColor ?? options.seriesColor;
      }

      const [r, g, b] = color;
      this.backend.setFillColor(r / 255, g / 255, b / 255);
      this.backend.beginPath();
      this.backend.rect(barX, barY, barWidth, barHeight);
      this.backend.fill();
    }

    this.backend.restore();
  }

  // ========================================================================
  // Win/Loss Sparkline
  // ========================================================================

  /**
   * Render a win/loss sparkline: fixed-height bars above/below axis.
   *
   * All positive values get the same bar height (above axis).
   * All negative values get the same bar height (below axis).
   * Zero values are shown as a thin line on the axis.
   */
  private renderWinLoss(data: SparklineRenderData, bounds: CellBounds): void {
    const { values, options } = data;
    const area = this.getPlotArea(bounds);

    this.backend.save();

    const axisY = area.y + area.height / 2;
    const halfHeight = area.height / 2;

    // Draw axis
    if (options.showAxis) {
      this.backend.setStrokeColor(0.5, 0.5, 0.5);
      this.backend.setLineWidth(AXIS_LINE_WIDTH);
      this.backend.setLineDash([], 0);
      this.backend.beginPath();
      this.backend.moveTo(area.x, axisY);
      this.backend.lineTo(area.x + area.width, axisY);
      this.backend.stroke();
    }

    // Compute bar geometry
    const n = values.length;
    const totalBarWidth = area.width / n;
    const gap = totalBarWidth * COLUMN_GAP_RATIO;
    const barWidth = totalBarWidth - gap;

    for (let i = 0; i < n; i++) {
      const barX = area.x + i * totalBarWidth + gap / 2;
      const value = values[i];

      let color: [number, number, number];
      let barY: number;
      let barHeight: number;

      if (value > 0) {
        // Win: bar above axis
        color = options.seriesColor;
        barY = axisY - halfHeight;
        barHeight = halfHeight;
      } else if (value < 0) {
        // Loss: bar below axis
        color = options.negativeColor ?? options.seriesColor;
        barY = axisY;
        barHeight = halfHeight;
      } else {
        // Zero: thin line on axis
        color = options.seriesColor;
        barY = axisY - 0.5;
        barHeight = 1;
      }

      const [r, g, b] = color;
      this.backend.setFillColor(r / 255, g / 255, b / 255);
      this.backend.beginPath();
      this.backend.rect(barX, barY, barWidth, barHeight);
      this.backend.fill();
    }

    this.backend.restore();
  }

  // ========================================================================
  // Shared Helpers
  // ========================================================================

  /**
   * Compute the min/max/range for scaling data values.
   */
  private computeScale(
    values: number[],
    options: SparklineOptions,
  ): { minVal: number; maxVal: number; range: number } {
    // Guard against empty values or all non-finite
    const finiteValues = values.filter((v) => Number.isFinite(v));
    if (finiteValues.length === 0) {
      return { minVal: 0, maxVal: 1, range: 1 };
    }

    let minVal = options.minValue ?? Math.min(...finiteValues);
    let maxVal = options.maxValue ?? Math.max(...finiteValues);

    // Guard against non-finite overrides
    if (!Number.isFinite(minVal)) minVal = 0;
    if (!Number.isFinite(maxVal)) maxVal = 1;

    // Ensure min <= max
    if (minVal > maxVal) {
      [minVal, maxVal] = [maxVal, minVal];
    }

    // If all values are the same, create a small range
    const range = maxVal - minVal;

    return { minVal, maxVal, range };
  }

  /**
   * Get the plot area within cell bounds (after padding).
   */
  private getPlotArea(bounds: CellBounds): PlotArea {
    return {
      x: bounds.x + SPARKLINE_PADDING,
      y: bounds.y + SPARKLINE_PADDING,
      width: bounds.width - 2 * SPARKLINE_PADDING,
      height: bounds.height - 2 * SPARKLINE_PADDING,
    };
  }

  /**
   * Draw a horizontal axis line at y=0 in the data coordinate system.
   */
  private drawAxisLine(minVal: number, _maxVal: number, range: number, area: PlotArea): void {
    const axisY =
      range === 0
        ? area.y + area.height
        : area.y + area.height - ((0 - minVal) / range) * area.height;

    this.backend.setStrokeColor(0.5, 0.5, 0.5);
    this.backend.setLineWidth(AXIS_LINE_WIDTH);
    this.backend.setLineDash([], 0);
    this.backend.beginPath();
    this.backend.moveTo(area.x, axisY);
    this.backend.lineTo(area.x + area.width, axisY);
    this.backend.stroke();
  }
}

// ============================================================================
// Internal Types
// ============================================================================

interface PlotArea {
  x: number;
  y: number;
  width: number;
  height: number;
}
