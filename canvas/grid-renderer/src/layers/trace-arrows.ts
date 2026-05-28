/**
 * Trace Arrows Layer
 *
 * Renders formula auditing trace arrows (precedent/dependent) between cells.
 * Arrows use bezier curves with arrowheads. Cross-sheet indicators display
 * a dashed line to the viewport edge with a sheet icon.
 *
 * renderMode: 'per-region' | canvas: 0 | z-index: 250
 *
 * @module grid-renderer/layers/trace-arrows
 */

import { regionLocalVisibleRect, type FrameContext, type RenderRegion } from '@mog/canvas-engine';
import type { GridRegionMeta, TraceDataSource } from '@mog-sdk/contracts/rendering';
import type { TraceArrow } from '@mog-sdk/contracts/trace-arrows';
import type { ViewportPositionIndex } from '../coordinates/viewport-position-index';
import { cellRectInRegion } from '../shared/cell-bounds';
import { BaseLayer } from './base-layer';

// =============================================================================
// Configuration
// =============================================================================

export interface TraceArrowsLayerConfig {
  /** Precedent arrow color (default: blue) */
  precedentColor?: string;
  /** Dependent arrow color (default: red) */
  dependentColor?: string;
  /** Line width in pixels */
  lineWidth?: number;
  /** Source dot radius */
  sourceDotRadius?: number;
  /** Arrowhead size */
  arrowheadSize?: number;
  /** Dash pattern for cross-sheet arrows */
  crossSheetDash?: readonly [number, number];
}

const DEFAULT_CONFIG: Required<TraceArrowsLayerConfig> = {
  precedentColor: '#0066cc',
  dependentColor: '#cc0000',
  lineWidth: 2,
  sourceDotRadius: 4,
  arrowheadSize: 8,
  crossSheetDash: [6, 4] as const,
};

// =============================================================================
// Helper Types
// =============================================================================

interface Point {
  x: number;
  y: number;
}

interface BezierControlPoints {
  cp1: Point;
  cp2: Point;
}

interface TraceCellPosition {
  row: number;
  col: number;
  sheet: string;
}

function isTraceCellPosition(value: unknown): value is TraceCellPosition {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const maybePromise = value as { then?: unknown };
  if (typeof maybePromise.then === 'function') {
    return false;
  }

  const candidate = value as Partial<TraceCellPosition>;
  return (
    Number.isFinite(candidate.row) &&
    Number.isFinite(candidate.col) &&
    typeof candidate.sheet === 'string'
  );
}

function fallbackTracePosition(position: TraceArrow['fromPosition']): TraceCellPosition {
  return {
    row: position.row,
    col: position.col,
    sheet: position.sheetId,
  };
}

// =============================================================================
// Trace Arrows Layer
// =============================================================================

export class TraceArrowsLayer extends BaseLayer {
  private traceData: TraceDataSource;
  private dimensions: ViewportPositionIndex;
  private config: Required<TraceArrowsLayerConfig>;

  constructor(
    traceData: TraceDataSource,
    dimensions: ViewportPositionIndex,
    config: TraceArrowsLayerConfig = {},
  ) {
    super({
      id: 'traceArrows',
      zIndex: 250,
      renderMode: 'per-region',
      canvas: 0,
    });
    this.traceData = traceData;
    this.dimensions = dimensions;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ===========================================================================
  // Data Source Updates
  // ===========================================================================

  setTraceData(traceData: TraceDataSource): void {
    this.traceData = traceData;
    this.markDirty();
  }

  setDimensions(dimensions: ViewportPositionIndex): void {
    this.dimensions = dimensions;
    this.markDirty();
  }

  // ===========================================================================
  // Render
  // ===========================================================================

  render(
    ctx: CanvasRenderingContext2D,
    region: RenderRegion<GridRegionMeta>,
    _frame: FrameContext,
  ): void {
    const meta = region.metadata;
    const sheetId = meta.sheetId;
    const arrows = this.traceData.getTraceArrows();

    if (arrows.length === 0) return;

    const visible = regionLocalVisibleRect(region);
    const visibleWidth = visible.width;
    const visibleHeight = visible.height;

    ctx.save();

    for (const arrow of arrows) {
      // Resolve cell positions via data source, fall back to stored positions
      const fromPosLookup = this.traceData.getCellPositionForTrace(arrow.fromCellId);
      const toPosLookup = this.traceData.getCellPositionForTrace(arrow.toCellId);

      const fromPos = isTraceCellPosition(fromPosLookup)
        ? fromPosLookup
        : fallbackTracePosition(arrow.fromPosition);
      const toPos = isTraceCellPosition(toPosLookup)
        ? toPosLookup
        : fallbackTracePosition(arrow.toPosition);

      const fromOnSheet = fromPos.sheet === sheetId;
      const toOnSheet = toPos.sheet === sheetId;

      if (!fromOnSheet && !toOnSheet) continue;

      if (arrow.crossSheet) {
        this.drawCrossSheetArrow(
          ctx,
          arrow,
          fromPos,
          toPos,
          fromOnSheet,
          region,
          visibleWidth,
          visibleHeight,
          sheetId,
        );
      } else {
        this.drawArrow(ctx, arrow, fromPos, toPos, region, visibleWidth, visibleHeight, sheetId);
      }
    }

    ctx.restore();
  }

  // ===========================================================================
  // Same-sheet Arrow
  // ===========================================================================

  private drawArrow(
    ctx: CanvasRenderingContext2D,
    arrow: TraceArrow,
    fromPos: { row: number; col: number },
    toPos: { row: number; col: number },
    region: RenderRegion<GridRegionMeta>,
    visibleWidth: number,
    visibleHeight: number,
    sheetId: string,
  ): void {
    const fromCenter = this.getCellCenter(fromPos.row, fromPos.col, region, sheetId);
    const toCenter = this.getCellCenter(toPos.row, toPos.col, region, sheetId);

    // Skip if both points are well outside the visible area
    const padding = 100;
    if (
      (fromCenter.x < -padding && toCenter.x < -padding) ||
      (fromCenter.x > visibleWidth + padding && toCenter.x > visibleWidth + padding) ||
      (fromCenter.y < -padding && toCenter.y < -padding) ||
      (fromCenter.y > visibleHeight + padding && toCenter.y > visibleHeight + padding)
    ) {
      return;
    }

    const controlPoints = this.calculateBezierControlPoints(fromCenter, toCenter);

    // Draw the curve
    ctx.beginPath();
    ctx.moveTo(fromCenter.x, fromCenter.y);
    ctx.bezierCurveTo(
      controlPoints.cp1.x,
      controlPoints.cp1.y,
      controlPoints.cp2.x,
      controlPoints.cp2.y,
      toCenter.x,
      toCenter.y,
    );

    ctx.strokeStyle =
      arrow.type === 'precedent' ? this.config.precedentColor : this.config.dependentColor;
    ctx.lineWidth = this.config.lineWidth;
    ctx.setLineDash([]);
    ctx.stroke();

    // Arrowhead at target
    this.drawArrowhead(ctx, controlPoints.cp2, toCenter, arrow.type);

    // Dot at source
    this.drawSourceDot(ctx, fromCenter, arrow.type);
  }

  // ===========================================================================
  // Cross-sheet Arrow
  // ===========================================================================

  private drawCrossSheetArrow(
    ctx: CanvasRenderingContext2D,
    arrow: TraceArrow,
    fromPos: { row: number; col: number; sheet: string },
    toPos: { row: number; col: number; sheet: string },
    fromOnSheet: boolean,
    region: RenderRegion<GridRegionMeta>,
    visibleWidth: number,
    visibleHeight: number,
    sheetId: string,
  ): void {
    const localPos = fromOnSheet ? fromPos : toPos;
    const isFromLocal = fromOnSheet;

    const localCenter = this.getCellCenter(localPos.row, localPos.col, region, sheetId);

    // Edge point towards other sheet (right edge as default)
    const edgePoint: Point = {
      x: visibleWidth - 20,
      y: Math.min(Math.max(localCenter.y, 20), visibleHeight - 20),
    };

    // Dashed line from local cell to edge
    ctx.beginPath();
    ctx.moveTo(localCenter.x, localCenter.y);
    ctx.lineTo(edgePoint.x, edgePoint.y);

    ctx.strokeStyle =
      arrow.type === 'precedent' ? this.config.precedentColor : this.config.dependentColor;
    ctx.lineWidth = this.config.lineWidth;
    ctx.setLineDash([...this.config.crossSheetDash]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Sheet indicator icon at edge
    this.drawSheetIndicator(ctx, edgePoint, arrow.type);

    // Source dot or arrowhead based on direction
    if (isFromLocal) {
      this.drawSourceDot(ctx, localCenter, arrow.type);
    } else {
      const direction = {
        x: localCenter.x - edgePoint.x,
        y: localCenter.y - edgePoint.y,
      };
      const length = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
      if (length > 0) {
        const normalized = { x: direction.x / length, y: direction.y / length };
        const controlPoint = {
          x: localCenter.x - normalized.x * 20,
          y: localCenter.y - normalized.y * 20,
        };
        this.drawArrowhead(ctx, controlPoint, localCenter, arrow.type);
      }
    }
  }

  // ===========================================================================
  // Geometry Helpers
  // ===========================================================================

  private getCellCenter(
    row: number,
    col: number,
    region: RenderRegion<GridRegionMeta>,
    sheetId: string,
  ): Point {
    const rect = cellRectInRegion(region, row, col, this.dimensions);
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }

  private calculateBezierControlPoints(from: Point, to: Point): BezierControlPoints {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance === 0) {
      return { cp1: { ...from }, cp2: { ...to } };
    }

    const curveOffset = Math.min(distance * 0.2, 50);
    const perpX = -dy / distance;
    const perpY = dx / distance;
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;

    return {
      cp1: {
        x: midX + perpX * curveOffset * 0.5,
        y: midY + perpY * curveOffset * 0.5,
      },
      cp2: {
        x: midX + perpX * curveOffset * 0.5,
        y: midY + perpY * curveOffset * 0.5,
      },
    };
  }

  // ===========================================================================
  // Drawing Primitives
  // ===========================================================================

  private drawArrowhead(
    ctx: CanvasRenderingContext2D,
    from: Point,
    to: Point,
    type: 'precedent' | 'dependent',
  ): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) return;

    const nx = dx / length;
    const ny = dy / length;
    const size = this.config.arrowheadSize;
    const angle = Math.PI / 6;

    const p1 = {
      x: to.x - size * (nx * Math.cos(angle) - ny * Math.sin(angle)),
      y: to.y - size * (ny * Math.cos(angle) + nx * Math.sin(angle)),
    };
    const p2 = {
      x: to.x - size * (nx * Math.cos(angle) + ny * Math.sin(angle)),
      y: to.y - size * (ny * Math.cos(angle) - nx * Math.sin(angle)),
    };

    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.closePath();
    ctx.fillStyle = type === 'precedent' ? this.config.precedentColor : this.config.dependentColor;
    ctx.fill();
  }

  private drawSourceDot(
    ctx: CanvasRenderingContext2D,
    center: Point,
    type: 'precedent' | 'dependent',
  ): void {
    ctx.beginPath();
    ctx.arc(center.x, center.y, this.config.sourceDotRadius, 0, Math.PI * 2);
    ctx.fillStyle = type === 'precedent' ? this.config.precedentColor : this.config.dependentColor;
    ctx.fill();
  }

  private drawSheetIndicator(
    ctx: CanvasRenderingContext2D,
    position: Point,
    type: 'precedent' | 'dependent',
  ): void {
    const size = 12;
    const color = type === 'precedent' ? this.config.precedentColor : this.config.dependentColor;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = 'white';
    ctx.lineWidth = 1.5;

    // Main rectangle (sheet icon)
    ctx.beginPath();
    ctx.rect(position.x - size / 2, position.y - size / 2, size, size * 1.2);
    ctx.fill();
    ctx.stroke();

    // Folded corner
    ctx.beginPath();
    ctx.moveTo(position.x + size / 2 - 4, position.y - size / 2);
    ctx.lineTo(position.x + size / 2, position.y - size / 2 + 4);
    ctx.lineTo(position.x + size / 2 - 4, position.y - size / 2 + 4);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();

    ctx.restore();
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  setConfig(config: Partial<TraceArrowsLayerConfig>): void {
    this.config = { ...this.config, ...config };
    this.markDirty();
  }

  getConfig(): Required<TraceArrowsLayerConfig> {
    return { ...this.config };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createTraceArrowsLayer(
  traceData: TraceDataSource,
  dimensions: ViewportPositionIndex,
  config?: TraceArrowsLayerConfig,
): TraceArrowsLayer {
  return new TraceArrowsLayer(traceData, dimensions, config);
}
