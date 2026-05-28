/**
 * Validation Circles Layer
 *
 * Renders red dashed ellipses around cells with data validation errors.
 * Z-index deliberately below Selection(200) to match Excel behavior
 * where validation circles appear behind the selection highlight.
 *
 * renderMode: 'per-region' | canvas: 0 | z-index: 125
 *
 * @module grid-renderer/layers/validation-circles
 */

import { regionLocalVisibleRect, type FrameContext, type RenderRegion } from '@mog/canvas-engine';
import type { CellDataSource, GridRegionMeta, SheetDataSource } from '@mog-sdk/contracts/rendering';
import type { ViewportPositionIndex } from '../coordinates/viewport-position-index';
import { cellRectInRegion } from '../shared/cell-bounds';
import { BaseLayer } from './base-layer';

// =============================================================================
// Configuration
// =============================================================================

export interface ValidationCirclesLayerConfig {
  /** Circle stroke color (default: red) */
  strokeColor?: string;
  /** Line width in pixels */
  lineWidth?: number;
  /** Dash pattern [dash, gap] */
  dashPattern?: readonly [number, number];
  /** Padding around cell (oval extends beyond cell bounds) */
  padding?: number;
}

const DEFAULT_CONFIG: Required<ValidationCirclesLayerConfig> = {
  strokeColor: '#dc2626',
  lineWidth: 2,
  dashPattern: [4, 4] as const,
  padding: 3,
};

// =============================================================================
// Validation Circles Layer
// =============================================================================

export class ValidationCirclesLayer extends BaseLayer {
  private cellData: CellDataSource;
  private dimensions: ViewportPositionIndex;
  private sheetData: SheetDataSource | null;
  private config: Required<ValidationCirclesLayerConfig>;

  constructor(
    cellData: CellDataSource,
    dimensions: ViewportPositionIndex,
    config: ValidationCirclesLayerConfig = {},
    sheetData?: SheetDataSource,
  ) {
    super({
      id: 'validationCircles',
      zIndex: 125,
      renderMode: 'per-region',
      canvas: 0,
    });
    this.cellData = cellData;
    this.dimensions = dimensions;
    this.sheetData = sheetData ?? null;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ===========================================================================
  // Data Source Updates
  // ===========================================================================

  setCellData(cellData: CellDataSource): void {
    this.cellData = cellData;
    this.markDirty();
  }

  setDimensions(dimensions: ViewportPositionIndex): void {
    this.dimensions = dimensions;
    this.markDirty();
  }

  setSheetData(sheetData: SheetDataSource): void {
    this.sheetData = sheetData;
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
    // Only render when validation circles are explicitly enabled via the
    // Data Ribbon "Circle Invalid Data" toggle (validationCirclesVisible).
    if (!this.sheetData?.validationCirclesVisible) return;

    const meta = region.metadata;
    const sheetId = meta.sheetId;
    const { startRow, endRow, startCol, endCol } = meta.cellRange;
    const visible = regionLocalVisibleRect(region);
    const visibleWidth = visible.width;
    const visibleHeight = visible.height;

    ctx.save();
    ctx.strokeStyle = this.config.strokeColor;
    ctx.lineWidth = this.config.lineWidth;
    ctx.setLineDash([...this.config.dashPattern]);

    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        if (this.cellData.hasValidationErrors(sheetId, { row, col })) {
          this.renderCircle(ctx, row, col, region, visibleWidth, visibleHeight, sheetId);
        }
      }
    }

    ctx.restore();
  }

  // ===========================================================================
  // Circle Rendering
  // ===========================================================================

  private renderCircle(
    ctx: CanvasRenderingContext2D,
    row: number,
    col: number,
    region: RenderRegion<GridRegionMeta>,
    visibleWidth: number,
    visibleHeight: number,
    sheetId: string,
  ): void {
    const cellRect = cellRectInRegion(region, row, col, this.dimensions);

    const padding = this.config.padding;
    const x = cellRect.x - padding;
    const y = cellRect.y - padding;
    const w = cellRect.width + padding * 2;
    const h = cellRect.height + padding * 2;

    // Skip if completely outside visible area
    if (x + w < 0 || x > visibleWidth || y + h < 0 || y > visibleHeight) {
      return;
    }

    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, 2 * Math.PI);
    ctx.stroke();
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  setConfig(config: Partial<ValidationCirclesLayerConfig>): void {
    this.config = { ...this.config, ...config };
    this.markDirty();
  }

  getConfig(): Required<ValidationCirclesLayerConfig> {
    return { ...this.config };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createValidationCirclesLayer(
  cellData: CellDataSource,
  dimensions: ViewportPositionIndex,
  config?: ValidationCirclesLayerConfig,
  sheetData?: SheetDataSource,
): ValidationCirclesLayer {
  return new ValidationCirclesLayer(cellData, dimensions, config, sheetData);
}
