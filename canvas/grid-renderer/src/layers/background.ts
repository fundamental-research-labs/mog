/**
 * Background Layer
 *
 * CanvasLayer implementation (z-index: 0, renderMode: 'per-region', canvas: 0)
 * that renders grid lines, alternating row colors, and hidden row/column indicators.
 *
 * This is the bottom-most layer in the render stack.
 *
 * Coordinate contract: renderMode is 'per-region', so ctx is already translated
 * and scaled to the region by the engine. Convert doc-space coords to
 * region-local via docToRegionXY / snapDoc{X|Y}ToPixelGrid (which compose
 * docToCanvasXY — the canonical formula in canvas-engine/coordinate-space.ts).
 *
 * @module grid-renderer/layers/background
 */

import type { FrameContext, RenderRegion } from '@mog/canvas-engine';
import { regionLocalVisibleRect, snapToPixelGrid } from '@mog/canvas-engine';
import type { GridRegionMeta, SheetDataSource } from '@mog-sdk/contracts/rendering';
import type { ViewportPositionIndex } from '../coordinates/viewport-position-index';
import { docToRegionXY, snapDocXToPixelGrid, snapDocYToPixelGrid } from '../shared/cell-bounds';
import { BaseLayer } from './base-layer';

// =============================================================================
// Constants
// =============================================================================

// =============================================================================
// Background Layer Config
// =============================================================================

export interface BackgroundLayerConfig {
  readonly sheet: SheetDataSource;
  readonly dimensions: ViewportPositionIndex;
}

// =============================================================================
// Background Layer
// =============================================================================

export class BackgroundLayer extends BaseLayer {
  private sheet: SheetDataSource;
  private dimensions: ViewportPositionIndex;

  constructor(config: BackgroundLayerConfig) {
    super({
      id: 'background',
      zIndex: 0,
      renderMode: 'per-region',
      canvas: 0,
    });
    this.sheet = config.sheet;
    this.dimensions = config.dimensions;
  }

  // ===========================================================================
  // Data Source Updates
  // ===========================================================================

  setSheet(sheet: SheetDataSource): void {
    this.sheet = sheet;
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
    frame: FrameContext,
  ): void {
    const meta = region.metadata;
    const sheetId = meta.sheetId;
    const { startRow, endRow, startCol, endCol } = meta.cellRange;
    const dpr = frame.dpr;

    const visible = regionLocalVisibleRect(region);
    const visibleWidth = visible.width;
    const visibleHeight = visible.height;

    // 1. Clear background
    this.renderBackground(ctx, visibleWidth, visibleHeight);

    // 2. Draw grid lines (if enabled)
    if (this.shouldRenderGridlines()) {
      this.renderGridLines(
        ctx,
        sheetId,
        startRow,
        endRow,
        startCol,
        endCol,
        region,
        visibleWidth,
        visibleHeight,
        dpr,
      );
    }

    // 3. Draw hidden row/column indicators
    this.renderHiddenIndicators(
      ctx,
      sheetId,
      startRow,
      endRow,
      startCol,
      endCol,
      region,
      visibleWidth,
      visibleHeight,
      dpr,
    );
  }

  // ===========================================================================
  // Grid Lines
  // ===========================================================================

  private renderBackground(
    ctx: CanvasRenderingContext2D,
    visibleWidth: number,
    visibleHeight: number,
  ): void {
    const skin = this.sheet.sheetViewSkin;
    const background = skin.background;
    if (background?.kind === 'transparent') {
      ctx.clearRect(0, 0, visibleWidth, visibleHeight);
      return;
    }

    ctx.save();
    ctx.globalAlpha = background?.opacity ?? 1;
    ctx.fillStyle =
      skin.defaultCellBackground ?? background?.color ?? this.sheet.chromeTheme.canvasBackground;
    ctx.fillRect(0, 0, visibleWidth, visibleHeight);
    ctx.restore();
  }

  private shouldRenderGridlines(): boolean {
    const skin = this.sheet.sheetViewSkin;
    return skin.gridlines.kind !== 'hidden' && this.sheet.showGridlines;
  }

  private renderGridLines(
    ctx: CanvasRenderingContext2D,
    sheetId: string,
    startRow: number,
    endRow: number,
    startCol: number,
    endCol: number,
    region: RenderRegion<GridRegionMeta>,
    visibleWidth: number,
    visibleHeight: number,
    dpr: number,
  ): void {
    const skin = this.sheet.sheetViewSkin;
    const gridlines = skin.gridlines;
    const kind = gridlines?.kind ?? 'solid';
    const dash = gridlines?.dash ?? [];
    const lineCap = gridlines?.lineCap ?? 'butt';
    const opacity = gridlines?.opacity ?? 1;
    const jitter = gridlines?.jitter ?? null;

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = gridlines.color ?? this.sheet.gridlineColor;
    ctx.lineWidth = gridlines.width ?? 1;
    ctx.lineCap = lineCap;
    ctx.setLineDash(kind === 'double' ? [] : dash);

    if (kind === 'double') {
      this.renderDoubleGridLines(
        ctx,
        startRow,
        endRow,
        startCol,
        endCol,
        region,
        visibleWidth,
        visibleHeight,
        dpr,
        gridlines.majorEveryRows ?? null,
        gridlines.majorEveryCols ?? null,
        gridlines.majorColor ?? this.sheet.gridlineColor,
        gridlines.majorWidth ?? 1,
        jitter,
      );
      ctx.restore();
      return;
    }

    ctx.beginPath();

    // Horizontal lines (row boundaries)
    for (let row = startRow; row <= endRow + 1; row++) {
      const docY = this.dimensions.getRowTop(row);
      const y = snapDocYToPixelGrid(region, docY, dpr) + this.jitterFor(jitter, 'row', row);
      ctx.moveTo(0, y);
      ctx.lineTo(visibleWidth, y);
    }

    // Vertical lines (column boundaries)
    for (let col = startCol; col <= endCol + 1; col++) {
      const docX = this.dimensions.getColLeft(col);
      const x = snapDocXToPixelGrid(region, docX, dpr) + this.jitterFor(jitter, 'col', col);
      ctx.moveTo(x, 0);
      ctx.lineTo(x, visibleHeight);
    }

    ctx.stroke();

    this.renderMajorGridLines(
      ctx,
      startRow,
      endRow,
      startCol,
      endCol,
      region,
      visibleWidth,
      visibleHeight,
      dpr,
      gridlines.majorEveryRows ?? null,
      gridlines.majorEveryCols ?? null,
      gridlines.majorColor ?? this.sheet.gridlineColor,
      gridlines.majorWidth ?? 1,
      jitter,
    );

    ctx.restore();
  }

  private renderMajorGridLines(
    ctx: CanvasRenderingContext2D,
    startRow: number,
    endRow: number,
    startCol: number,
    endCol: number,
    region: RenderRegion<GridRegionMeta>,
    visibleWidth: number,
    visibleHeight: number,
    dpr: number,
    everyRows: number | null,
    everyCols: number | null,
    color: string,
    width: number,
    jitter: { readonly amplitudePx: number; readonly seed: string } | null,
  ): void {
    if (!everyRows && !everyCols) return;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash([]);
    ctx.beginPath();

    if (everyRows && everyRows > 0) {
      for (let row = startRow; row <= endRow + 1; row++) {
        if (row % everyRows !== 0) continue;
        const docY = this.dimensions.getRowTop(row);
        const y = snapDocYToPixelGrid(region, docY, dpr) + this.jitterFor(jitter, 'row', row);
        ctx.moveTo(0, y);
        ctx.lineTo(visibleWidth, y);
      }
    }

    if (everyCols && everyCols > 0) {
      for (let col = startCol; col <= endCol + 1; col++) {
        if (col % everyCols !== 0) continue;
        const docX = this.dimensions.getColLeft(col);
        const x = snapDocXToPixelGrid(region, docX, dpr) + this.jitterFor(jitter, 'col', col);
        ctx.moveTo(x, 0);
        ctx.lineTo(x, visibleHeight);
      }
    }

    ctx.stroke();
    ctx.restore();
  }

  private renderDoubleGridLines(
    ctx: CanvasRenderingContext2D,
    startRow: number,
    endRow: number,
    startCol: number,
    endCol: number,
    region: RenderRegion<GridRegionMeta>,
    visibleWidth: number,
    visibleHeight: number,
    dpr: number,
    everyRows: number | null,
    everyCols: number | null,
    majorColor: string,
    majorWidth: number,
    jitter: { readonly amplitudePx: number; readonly seed: string } | null,
  ): void {
    const offset = Math.max(1, ctx.lineWidth) / 2;
    ctx.beginPath();
    for (let row = startRow; row <= endRow + 1; row++) {
      const docY = this.dimensions.getRowTop(row);
      const y = snapDocYToPixelGrid(region, docY, dpr) + this.jitterFor(jitter, 'row', row);
      ctx.moveTo(0, y - offset);
      ctx.lineTo(visibleWidth, y - offset);
      ctx.moveTo(0, y + offset);
      ctx.lineTo(visibleWidth, y + offset);
    }
    for (let col = startCol; col <= endCol + 1; col++) {
      const docX = this.dimensions.getColLeft(col);
      const x = snapDocXToPixelGrid(region, docX, dpr) + this.jitterFor(jitter, 'col', col);
      ctx.moveTo(x - offset, 0);
      ctx.lineTo(x - offset, visibleHeight);
      ctx.moveTo(x + offset, 0);
      ctx.lineTo(x + offset, visibleHeight);
    }
    ctx.stroke();
    this.renderMajorGridLines(
      ctx,
      startRow,
      endRow,
      startCol,
      endCol,
      region,
      visibleWidth,
      visibleHeight,
      dpr,
      everyRows,
      everyCols,
      majorColor,
      majorWidth,
      jitter,
    );
  }

  private jitterFor(
    jitter: { readonly amplitudePx: number; readonly seed: string } | null,
    axis: 'row' | 'col',
    index: number,
  ): number {
    if (!jitter || jitter.amplitudePx <= 0) return 0;
    let hash = 2166136261;
    const input = `${jitter.seed}:${axis}:${index}`;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (((hash >>> 0) / 0xffffffff) * 2 - 1) * jitter.amplitudePx;
  }

  // ===========================================================================
  // Hidden Row/Column Indicators
  // ===========================================================================

  /**
   * Render double-line indicators at hidden row/column boundaries.
   * A double line (2 thin lines with a 1px gap) is drawn where a hidden
   * row or column is adjacent to a visible one.
   */
  private renderHiddenIndicators(
    ctx: CanvasRenderingContext2D,
    sheetId: string,
    startRow: number,
    endRow: number,
    startCol: number,
    endCol: number,
    region: RenderRegion<GridRegionMeta>,
    visibleWidth: number,
    visibleHeight: number,
    dpr: number,
  ): void {
    ctx.save();
    ctx.strokeStyle = this.sheet.sheetViewSkin.controls.hiddenIndicator;
    ctx.lineWidth = 1;

    // Hidden columns: check for hidden column immediately before each visible column
    for (let col = startCol; col <= endCol; col++) {
      if (col > 0 && this.dimensions.isColHidden(col - 1)) {
        const docX = this.dimensions.getColLeft(col);
        const { x } = docToRegionXY(docX, 0, region);

        // Draw double vertical line (2 lines with ~2px gap)
        const x1 = snapToPixelGrid(x - 1, dpr);
        const x2 = snapToPixelGrid(x + 1, dpr);

        ctx.beginPath();
        ctx.moveTo(x1, 0);
        ctx.lineTo(x1, visibleHeight);
        ctx.moveTo(x2, 0);
        ctx.lineTo(x2, visibleHeight);
        ctx.stroke();
      }
    }

    // Hidden rows: check for hidden row immediately before each visible row
    for (let row = startRow; row <= endRow; row++) {
      if (row > 0 && this.dimensions.isRowHidden(row - 1)) {
        const docY = this.dimensions.getRowTop(row);
        const { y } = docToRegionXY(0, docY, region);

        // Draw double horizontal line (2 lines with ~2px gap)
        const y1 = snapToPixelGrid(y - 1, dpr);
        const y2 = snapToPixelGrid(y + 1, dpr);

        ctx.beginPath();
        ctx.moveTo(0, y1);
        ctx.lineTo(visibleWidth, y1);
        ctx.moveTo(0, y2);
        ctx.lineTo(visibleWidth, y2);
        ctx.stroke();
      }
    }

    ctx.restore();
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a background layer.
 */
export function createBackgroundLayer(config: BackgroundLayerConfig): BackgroundLayer {
  return new BackgroundLayer(config);
}
