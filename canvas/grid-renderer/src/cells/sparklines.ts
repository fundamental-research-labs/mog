/**
 * Sparkline Renderer
 *
 * Canvas-based renderer for in-cell sparklines. Supports three sparkline types:
 * - Line: continuous line connecting data points with optional markers
 * - Column: vertical bars for each data point
 * - Win/Loss: binary bars above/below center axis
 *
 * Design notes:
 * - Renders within cell bounds with configurable padding
 * - Uses pre-computed SparklineRenderData for performance
 * - Supports high/low/first/last point coloring
 * - Supports axis line rendering
 *
 * Ported from grid-canvas/src/conditional-formats/sparkline-renderer.ts.
 *
 * @module grid-renderer/cells/sparklines
 */

import type { SparklineRenderData } from '@mog-sdk/contracts/sparklines';

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for SparklineRenderer.
 */
export interface SparklineRendererConfig {
  /** Padding inside cell bounds (default: 2) */
  padding?: number;
  /** Marker radius for line sparklines (default: 2) */
  markerRadius?: number;
}

const DEFAULT_CONFIG: Required<SparklineRendererConfig> = {
  padding: 2,
  markerRadius: 2,
};

// =============================================================================
// Sparkline Renderer
// =============================================================================

export class SparklineRenderer {
  private config: Required<SparklineRendererConfig>;

  constructor(config: SparklineRendererConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Render a sparkline within the given cell bounds.
   *
   * @param ctx - Canvas rendering context
   * @param data - Pre-computed sparkline render data
   * @param x - Cell X position
   * @param y - Cell Y position
   * @param width - Cell width
   * @param height - Cell height
   */
  render(
    ctx: CanvasRenderingContext2D,
    data: SparklineRenderData,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    if (data.points.length === 0) return;

    switch (data.type) {
      case 'line':
        this.renderLine(ctx, data, x, y, width, height);
        break;
      case 'column':
        this.renderColumn(ctx, data, x, y, width, height);
        break;
      case 'winLoss':
        this.renderWinLoss(ctx, data, x, y, width, height);
        break;
    }
  }

  // ===========================================================================
  // Line Sparkline
  // ===========================================================================

  private renderLine(
    ctx: CanvasRenderingContext2D,
    data: SparklineRenderData,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    const padding = this.config.padding;
    const drawX = x + padding;
    const drawY = y + padding;
    const drawWidth = width - padding * 2;
    const drawHeight = height - padding * 2;

    if (drawWidth <= 0 || drawHeight <= 0) return;

    ctx.save();

    // Clip to cell bounds
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();

    const visual = data.visual;

    // Draw axis line if enabled
    if (data.showAxis && data.axisPosition !== undefined) {
      ctx.strokeStyle = visual.markerColor || '#9ca3af';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      const axisY = drawY + drawHeight * (1 - data.axisPosition);
      ctx.beginPath();
      ctx.moveTo(drawX, axisY);
      ctx.lineTo(drawX + drawWidth, axisY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw line
    ctx.strokeStyle = visual.color;
    ctx.lineWidth = visual.lineWeight || 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();

    let firstPoint = true;
    const displayEmptyCells =
      (visual as { displayEmptyCells?: string }).displayEmptyCells || 'gaps';

    for (let i = 0; i < data.points.length; i++) {
      const point = data.points[i];

      if (point.isNull && displayEmptyCells === 'gaps') {
        // Start a new line segment after the gap
        firstPoint = true;
        continue;
      }

      const px = drawX + point.x * drawWidth;
      const py = drawY + drawHeight * (1 - point.y);

      if (firstPoint) {
        ctx.moveTo(px, py);
        firstPoint = false;
      } else {
        ctx.lineTo(px, py);
      }
    }

    ctx.stroke();

    // Draw markers if enabled
    if (visual.showMarkers) {
      this.renderLineMarkers(ctx, data, drawX, drawY, drawWidth, drawHeight);
    } else {
      // Always draw special point markers (high, low, first, last) if colors are set
      this.renderSpecialPointMarkers(ctx, data, drawX, drawY, drawWidth, drawHeight);
    }

    ctx.restore();
  }

  private renderLineMarkers(
    ctx: CanvasRenderingContext2D,
    data: SparklineRenderData,
    drawX: number,
    drawY: number,
    drawWidth: number,
    drawHeight: number,
  ): void {
    const visual = data.visual;
    const markerRadius = this.config.markerRadius;

    for (let i = 0; i < data.points.length; i++) {
      const point = data.points[i];
      if (point.isNull) continue;

      const px = drawX + point.x * drawWidth;
      const py = drawY + drawHeight * (1 - point.y);

      // Determine marker color
      let markerColor = visual.markerColor || visual.color;

      if (i === data.highPointIndex && visual.highPointColor) {
        markerColor = visual.highPointColor;
      } else if (i === data.lowPointIndex && visual.lowPointColor) {
        markerColor = visual.lowPointColor;
      } else if (i === data.firstPointIndex && visual.firstPointColor) {
        markerColor = visual.firstPointColor;
      } else if (i === data.lastPointIndex && visual.lastPointColor) {
        markerColor = visual.lastPointColor;
      }

      ctx.fillStyle = markerColor;
      ctx.beginPath();
      ctx.arc(px, py, markerRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private renderSpecialPointMarkers(
    ctx: CanvasRenderingContext2D,
    data: SparklineRenderData,
    drawX: number,
    drawY: number,
    drawWidth: number,
    drawHeight: number,
  ): void {
    const visual = data.visual;
    const markerRadius = this.config.markerRadius + 0.5;

    const specialPoints: Array<{ index: number | undefined; color: string | undefined }> = [
      { index: data.highPointIndex, color: visual.highPointColor },
      { index: data.lowPointIndex, color: visual.lowPointColor },
      { index: data.firstPointIndex, color: visual.firstPointColor },
      { index: data.lastPointIndex, color: visual.lastPointColor },
    ];

    for (const { index, color } of specialPoints) {
      if (index === undefined || !color) continue;

      const point = data.points[index];
      if (!point || point.isNull) continue;

      const px = drawX + point.x * drawWidth;
      const py = drawY + drawHeight * (1 - point.y);

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, markerRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ===========================================================================
  // Column Sparkline
  // ===========================================================================

  private renderColumn(
    ctx: CanvasRenderingContext2D,
    data: SparklineRenderData,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    const padding = this.config.padding;
    const drawX = x + padding;
    const drawY = y + padding;
    const drawWidth = width - padding * 2;
    const drawHeight = height - padding * 2;

    if (drawWidth <= 0 || drawHeight <= 0) return;

    ctx.save();

    // Clip to cell bounds
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();

    const visual = data.visual;
    const columnGap = (visual as { columnGap?: number }).columnGap ?? 0.1;
    const pointCount = data.points.length;

    // Calculate column width
    const totalGapRatio = columnGap * (pointCount - 1);
    const columnWidth = (drawWidth * (1 - totalGapRatio)) / pointCount;
    const gapWidth = pointCount > 1 ? (drawWidth * columnGap) / (pointCount - 1) : 0;

    // Calculate baseline (where value = 0)
    const baseline =
      data.axisPosition !== undefined
        ? drawY + drawHeight * (1 - data.axisPosition)
        : drawY + drawHeight; // Bottom if no negative values

    // Draw axis line if enabled
    if (data.showAxis && data.axisPosition !== undefined) {
      ctx.strokeStyle = visual.markerColor || '#9ca3af';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(drawX, baseline);
      ctx.lineTo(drawX + drawWidth, baseline);
      ctx.stroke();
    }

    // Draw columns
    for (let i = 0; i < pointCount; i++) {
      const point = data.points[i];
      if (point.isNull) continue;

      const barX = drawX + i * (columnWidth + gapWidth);
      const barY = drawY + drawHeight * (1 - point.y);

      // Determine bar height and direction
      const barHeight = Math.abs(barY - baseline);
      const barTop = point.value >= 0 ? barY : baseline;

      // Determine color
      let barColor = visual.color;

      if (point.value < 0 && visual.negativeColor) {
        barColor = visual.negativeColor;
      } else if (i === data.highPointIndex && visual.highPointColor) {
        barColor = visual.highPointColor;
      } else if (i === data.lowPointIndex && visual.lowPointColor) {
        barColor = visual.lowPointColor;
      } else if (i === data.firstPointIndex && visual.firstPointColor) {
        barColor = visual.firstPointColor;
      } else if (i === data.lastPointIndex && visual.lastPointColor) {
        barColor = visual.lastPointColor;
      }

      ctx.fillStyle = barColor;
      ctx.fillRect(barX, barTop, columnWidth, barHeight);
    }

    ctx.restore();
  }

  // ===========================================================================
  // Win/Loss Sparkline
  // ===========================================================================

  private renderWinLoss(
    ctx: CanvasRenderingContext2D,
    data: SparklineRenderData,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    const padding = this.config.padding;
    const drawX = x + padding;
    const drawY = y + padding;
    const drawWidth = width - padding * 2;
    const drawHeight = height - padding * 2;

    if (drawWidth <= 0 || drawHeight <= 0) return;

    ctx.save();

    // Clip to cell bounds
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();

    const visual = data.visual;
    const barGap = (visual as { barGap?: number }).barGap ?? 0.1;
    const pointCount = data.points.length;

    // Calculate bar width
    const totalGapRatio = barGap * (pointCount - 1);
    const barWidth = (drawWidth * (1 - totalGapRatio)) / pointCount;
    const gapWidthPx = pointCount > 1 ? (drawWidth * barGap) / (pointCount - 1) : 0;

    // Win/loss uses center line as axis
    const centerY = drawY + drawHeight / 2;
    const halfHeight = drawHeight / 2 - 1; // -1 for small gap at center

    // Draw axis line if enabled
    if (data.showAxis) {
      ctx.strokeStyle = visual.markerColor || '#9ca3af';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(drawX, centerY);
      ctx.lineTo(drawX + drawWidth, centerY);
      ctx.stroke();
    }

    // Draw bars
    for (let i = 0; i < pointCount; i++) {
      const point = data.points[i];
      if (point.isNull) continue;

      const barX = drawX + i * (barWidth + gapWidthPx);

      // Win (positive) goes up, loss (negative) goes down
      const isWin = point.value >= 0;
      const barTop = isWin ? centerY - halfHeight : centerY + 1;
      const barHeight = halfHeight;

      // Determine color
      let barColor = isWin ? visual.color : visual.negativeColor || visual.color;

      if (i === data.firstPointIndex && visual.firstPointColor) {
        barColor = visual.firstPointColor;
      } else if (i === data.lastPointIndex && visual.lastPointColor) {
        barColor = visual.lastPointColor;
      }

      ctx.fillStyle = barColor;
      ctx.fillRect(barX, barTop, barWidth, barHeight);
    }

    ctx.restore();
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  setConfig(config: Partial<SparklineRendererConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): Required<SparklineRendererConfig> {
    return { ...this.config };
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a SparklineRenderer instance.
 */
export function createSparklineRenderer(config?: SparklineRendererConfig): SparklineRenderer {
  return new SparklineRenderer(config);
}
