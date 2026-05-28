/**
 * Page Breaks Layer
 *
 * Renders page break preview lines for print layout visualization.
 * Manual breaks are solid blue lines, auto breaks are dashed gray.
 * Also renders print area boundaries and drag preview lines.
 *
 * renderMode: 'per-region' | canvas: 0 | z-index: 150
 *
 * @module grid-renderer/layers/page-breaks
 */

import { regionLocalVisibleRect, type FrameContext, type RenderRegion } from '@mog/canvas-engine';
import type {
  GridRegionMeta,
  PageBreakDataSource,
  PageBreakDragState,
} from '@mog-sdk/contracts/rendering';
import type { ViewportPositionIndex } from '../coordinates/viewport-position-index';
import { docToRegionXY } from '../shared/cell-bounds';
import { BaseLayer } from './base-layer';

// =============================================================================
// Configuration
// =============================================================================

export interface PageBreakLayerConfig {
  /** Color for manual page break lines */
  manualBreakColor?: string;
  /** Color for automatic page break lines */
  autoBreakColor?: string;
  /** Line width for manual breaks */
  manualBreakLineWidth?: number;
  /** Line width for automatic breaks */
  autoBreakLineWidth?: number;
  /** Dash pattern for automatic breaks */
  autoBreakDash?: number[];
  /** Page number label font */
  pageNumberFont?: string;
  /** Page number label color */
  pageNumberColor?: string;
  /** Whether to show page numbers */
  showPageNumbers?: boolean;
  /** Color for print area boundary */
  printAreaColor?: string;
  /** Line width for print area boundary */
  printAreaLineWidth?: number;
  /** Dash pattern for print area boundary */
  printAreaDash?: number[];
  /** Fill color for area outside print area (with alpha) */
  printAreaOutsideFill?: string;
  /** Color for drag preview line */
  dragPreviewColor?: string;
  /** Line width for drag preview */
  dragPreviewLineWidth?: number;
  /** Dash pattern for drag preview */
  dragPreviewDash?: number[];
  /** Opacity for drag preview line */
  dragPreviewOpacity?: number;
}

const DEFAULT_CONFIG: Required<PageBreakLayerConfig> = {
  manualBreakColor: '#217346',
  autoBreakColor: '#999999',
  manualBreakLineWidth: 2,
  autoBreakLineWidth: 1,
  autoBreakDash: [5, 5],
  pageNumberFont: '11px sans-serif',
  pageNumberColor: '#666666',
  showPageNumbers: true,
  printAreaColor: '#217346',
  printAreaLineWidth: 2,
  printAreaDash: [8, 4],
  printAreaOutsideFill: 'rgba(128, 128, 128, 0.1)',
  dragPreviewColor: '#34a853',
  dragPreviewLineWidth: 3,
  dragPreviewDash: [6, 4],
  dragPreviewOpacity: 0.8,
};

// =============================================================================
// Page Break Layer
// =============================================================================

export class PageBreakLayer extends BaseLayer {
  private pageBreakData: PageBreakDataSource;
  private dimensions: ViewportPositionIndex;
  private config: Required<PageBreakLayerConfig>;

  constructor(
    pageBreakData: PageBreakDataSource,
    dimensions: ViewportPositionIndex,
    config: PageBreakLayerConfig = {},
  ) {
    super({
      id: 'pageBreaks',
      zIndex: 150,
      renderMode: 'per-region',
      canvas: 0,
    });
    this.pageBreakData = pageBreakData;
    this.dimensions = dimensions;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ===========================================================================
  // Data Source Updates
  // ===========================================================================

  setPageBreakData(data: PageBreakDataSource): void {
    this.pageBreakData = data;
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
    if (!this.pageBreakData.pageBreakPreviewMode) return;

    const meta = region.metadata;
    const sheetId = meta.sheetId;
    const pageBreaks = this.pageBreakData.getPageBreaks();
    const autoPageBreaks = this.pageBreakData.getAutoPageBreaks();
    const printArea = this.pageBreakData.getPrintArea();
    const dragState = this.pageBreakData.getPageBreakDragState();
    const visible = regionLocalVisibleRect(region);
    const visibleWidth = visible.width;
    const visibleHeight = visible.height;

    // Print area boundary
    if (printArea) {
      this.renderPrintArea(ctx, printArea, region, visibleWidth, visibleHeight, sheetId);
    }

    // Auto breaks (dashed gray, rendered first so manual breaks appear on top)
    for (const entry of autoPageBreaks.rowBreaks) {
      this.renderHorizontalBreak(
        ctx,
        entry.id,
        'auto',
        region,
        visibleWidth,
        visibleHeight,
        sheetId,
      );
    }
    for (const entry of autoPageBreaks.colBreaks) {
      this.renderVerticalBreak(ctx, entry.id, 'auto', region, visibleWidth, visibleHeight, sheetId);
    }

    // Manual breaks (solid blue)
    for (const entry of pageBreaks.rowBreaks) {
      this.renderHorizontalBreak(
        ctx,
        entry.id,
        'manual',
        region,
        visibleWidth,
        visibleHeight,
        sheetId,
      );
    }
    for (const entry of pageBreaks.colBreaks) {
      this.renderVerticalBreak(
        ctx,
        entry.id,
        'manual',
        region,
        visibleWidth,
        visibleHeight,
        sheetId,
      );
    }

    // Page numbers
    if (this.config.showPageNumbers) {
      const allRowIds = [
        ...new Set([
          ...pageBreaks.rowBreaks.map((e) => e.id),
          ...autoPageBreaks.rowBreaks.map((e) => e.id),
        ]),
      ].sort((a, b) => a - b);
      const allColIds = [
        ...new Set([
          ...pageBreaks.colBreaks.map((e) => e.id),
          ...autoPageBreaks.colBreaks.map((e) => e.id),
        ]),
      ].sort((a, b) => a - b);
      const allBreaks = {
        rowBreaks: allRowIds,
        colBreaks: allColIds,
      };
      this.renderPageNumbers(ctx, allBreaks, region, visibleWidth, visibleHeight, sheetId);
    }

    // Drag preview
    if (dragState?.isDragging) {
      this.renderDragPreview(ctx, dragState, region, visibleWidth, visibleHeight, sheetId);
    }
  }

  // ===========================================================================
  // Break Lines
  // ===========================================================================

  private renderHorizontalBreak(
    ctx: CanvasRenderingContext2D,
    row: number,
    type: 'manual' | 'auto',
    region: RenderRegion<GridRegionMeta>,
    visibleWidth: number,
    visibleHeight: number,
    sheetId: string,
  ): void {
    const docY = this.dimensions.getRowTop(row);
    const y = docToRegionXY(0, docY, region).y;
    if (y < 0 || y > visibleHeight) return;

    if (type === 'manual') {
      ctx.strokeStyle = this.config.manualBreakColor;
      ctx.lineWidth = this.config.manualBreakLineWidth;
      ctx.setLineDash([]);
    } else {
      ctx.strokeStyle = this.config.autoBreakColor;
      ctx.lineWidth = this.config.autoBreakLineWidth;
      ctx.setLineDash(this.config.autoBreakDash);
    }

    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(visibleWidth, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private renderVerticalBreak(
    ctx: CanvasRenderingContext2D,
    col: number,
    type: 'manual' | 'auto',
    region: RenderRegion<GridRegionMeta>,
    visibleWidth: number,
    visibleHeight: number,
    sheetId: string,
  ): void {
    const docX = this.dimensions.getColLeft(col);
    const x = docToRegionXY(docX, 0, region).x;
    if (x < 0 || x > visibleWidth) return;

    if (type === 'manual') {
      ctx.strokeStyle = this.config.manualBreakColor;
      ctx.lineWidth = this.config.manualBreakLineWidth;
      ctx.setLineDash([]);
    } else {
      ctx.strokeStyle = this.config.autoBreakColor;
      ctx.lineWidth = this.config.autoBreakLineWidth;
      ctx.setLineDash(this.config.autoBreakDash);
    }

    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, visibleHeight);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ===========================================================================
  // Print Area
  // ===========================================================================

  private renderPrintArea(
    ctx: CanvasRenderingContext2D,
    printArea: { startRow: number; startCol: number; endRow: number; endCol: number },
    region: RenderRegion<GridRegionMeta>,
    visibleWidth: number,
    visibleHeight: number,
    sheetId: string,
  ): void {
    const topLeft = docToRegionXY(
      this.dimensions.getColLeft(printArea.startCol),
      this.dimensions.getRowTop(printArea.startRow),
      region,
    );
    const left = topLeft.x;
    const top = topLeft.y;
    const bottomRight = docToRegionXY(
      this.dimensions.getColLeft(printArea.endCol) + this.dimensions.getColWidth(printArea.endCol),
      this.dimensions.getRowTop(printArea.endRow) + this.dimensions.getRowHeight(printArea.endRow),
      region,
    );
    const right = bottomRight.x;
    const bottom = bottomRight.y;

    // Semi-transparent overlay outside print area
    ctx.fillStyle = this.config.printAreaOutsideFill;

    // Top
    if (top > 0) {
      ctx.fillRect(0, 0, visibleWidth, Math.min(top, visibleHeight));
    }
    // Bottom
    if (bottom < visibleHeight) {
      ctx.fillRect(0, Math.max(0, bottom), visibleWidth, visibleHeight - Math.max(0, bottom));
    }
    // Left
    if (left > 0) {
      const overlayTop = Math.max(0, top);
      const overlayBottom = Math.min(visibleHeight, bottom);
      if (overlayBottom > overlayTop) {
        ctx.fillRect(0, overlayTop, Math.min(left, visibleWidth), overlayBottom - overlayTop);
      }
    }
    // Right
    if (right < visibleWidth) {
      const overlayTop = Math.max(0, top);
      const overlayBottom = Math.min(visibleHeight, bottom);
      if (overlayBottom > overlayTop) {
        ctx.fillRect(
          Math.max(0, right),
          overlayTop,
          visibleWidth - Math.max(0, right),
          overlayBottom - overlayTop,
        );
      }
    }

    // Boundary lines
    ctx.strokeStyle = this.config.printAreaColor;
    ctx.lineWidth = this.config.printAreaLineWidth;
    ctx.setLineDash(this.config.printAreaDash);

    const visibleLeft = Math.max(0, left);
    const visibleTop = Math.max(0, top);
    const visibleRight = Math.min(visibleWidth, right);
    const visibleBottom = Math.min(visibleHeight, bottom);

    if (visibleRight > visibleLeft && visibleBottom > visibleTop) {
      ctx.beginPath();
      if (top >= 0 && top <= visibleHeight) {
        ctx.moveTo(visibleLeft, top);
        ctx.lineTo(visibleRight, top);
      }
      if (bottom >= 0 && bottom <= visibleHeight) {
        ctx.moveTo(visibleLeft, bottom);
        ctx.lineTo(visibleRight, bottom);
      }
      if (left >= 0 && left <= visibleWidth) {
        ctx.moveTo(left, visibleTop);
        ctx.lineTo(left, visibleBottom);
      }
      if (right >= 0 && right <= visibleWidth) {
        ctx.moveTo(right, visibleTop);
        ctx.lineTo(right, visibleBottom);
      }
      ctx.stroke();
    }

    ctx.setLineDash([]);
  }

  // ===========================================================================
  // Page Numbers
  // ===========================================================================

  private renderPageNumbers(
    ctx: CanvasRenderingContext2D,
    pageBreaks: { rowBreaks: number[]; colBreaks: number[] },
    region: RenderRegion<GridRegionMeta>,
    visibleWidth: number,
    visibleHeight: number,
    sheetId: string,
  ): void {
    const hBreaks = [0, ...pageBreaks.rowBreaks.sort((a, b) => a - b)];
    const vBreaks = [0, ...pageBreaks.colBreaks.sort((a, b) => a - b)];

    ctx.font = this.config.pageNumberFont;
    ctx.fillStyle = this.config.pageNumberColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    let pageNum = 1;

    for (let vi = 0; vi < vBreaks.length; vi++) {
      for (let hi = 0; hi < hBreaks.length; hi++) {
        const startRow = hBreaks[hi];
        const startCol = vBreaks[vi];
        const local = docToRegionXY(
          this.dimensions.getColLeft(startCol),
          this.dimensions.getRowTop(startRow),
          region,
        );
        const x = local.x;
        const y = local.y;

        if (x < visibleWidth && y < visibleHeight && x + 50 > 0 && y + 30 > 0) {
          const labelX = Math.max(10, x + 10);
          const labelY = Math.max(10, y + 15);

          ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
          ctx.fillRect(labelX - 15, labelY - 10, 30, 20);

          ctx.strokeStyle = this.config.autoBreakColor;
          ctx.lineWidth = 1;
          ctx.strokeRect(labelX - 15, labelY - 10, 30, 20);

          ctx.fillStyle = this.config.pageNumberColor;
          ctx.fillText(`${pageNum}`, labelX, labelY);
        }

        pageNum++;
      }
    }
  }

  // ===========================================================================
  // Drag Preview
  // ===========================================================================

  private renderDragPreview(
    ctx: CanvasRenderingContext2D,
    dragState: PageBreakDragState,
    region: RenderRegion<GridRegionMeta>,
    visibleWidth: number,
    visibleHeight: number,
    sheetId: string,
  ): void {
    const { pageBreak, targetPosition } = dragState;
    if (!pageBreak || targetPosition === null) return;

    const { orientation } = pageBreak;
    let pixelPos: number;
    if (orientation === 'horizontal') {
      pixelPos = this.dimensions.getRowTop(targetPosition);
    } else {
      pixelPos = this.dimensions.getColLeft(targetPosition);
    }

    const viewportPos =
      orientation === 'horizontal'
        ? docToRegionXY(0, pixelPos, region).y
        : docToRegionXY(pixelPos, 0, region).x;

    if (orientation === 'horizontal') {
      if (viewportPos < 0 || viewportPos > visibleHeight) return;
    } else {
      if (viewportPos < 0 || viewportPos > visibleWidth) return;
    }

    ctx.save();
    ctx.strokeStyle = this.config.dragPreviewColor;
    ctx.lineWidth = this.config.dragPreviewLineWidth;
    ctx.setLineDash(this.config.dragPreviewDash);
    ctx.globalAlpha = this.config.dragPreviewOpacity;

    ctx.beginPath();
    if (orientation === 'horizontal') {
      ctx.moveTo(0, viewportPos);
      ctx.lineTo(visibleWidth, viewportPos);
    } else {
      ctx.moveTo(viewportPos, 0);
      ctx.lineTo(viewportPos, visibleHeight);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  setConfig(config: Partial<PageBreakLayerConfig>): void {
    this.config = { ...this.config, ...config };
    this.markDirty();
  }

  getConfig(): Required<PageBreakLayerConfig> {
    return { ...this.config };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createPageBreakLayer(
  pageBreakData: PageBreakDataSource,
  dimensions: ViewportPositionIndex,
  config?: PageBreakLayerConfig,
): PageBreakLayer {
  return new PageBreakLayer(pageBreakData, dimensions, config);
}
