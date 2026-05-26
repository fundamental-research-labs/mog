/**
 * Sticky Headers Layer
 *
 * Renders table header rows that stick when scrolled past.
 * When a table's header row scrolls out of the viewport, a sticky copy
 * is rendered at the top of the visible area with shadow and styling.
 *
 * renderMode: 'per-region' | canvas: 0 | z-index: 700
 *
 * @module grid-renderer/layers/sticky-headers
 */

import type { FrameContext, RenderRegion } from '@mog/canvas-engine';
import { regionLocalVisibleRect, snapToPixelGrid } from '@mog/canvas-engine';
import type { CellDataSource, GridRegionMeta } from '@mog-sdk/contracts/rendering';
import type { ViewportPositionIndex } from '../coordinates/viewport-position-index';
import { docToRegionXY } from '../shared/cell-bounds';
import { BaseLayer } from './base-layer';

// =============================================================================
// Configuration
// =============================================================================

export interface StickyHeadersLayerConfig {
  /** Background color for sticky header area */
  backgroundColor?: string;
  /** Border color for sticky header bottom edge */
  borderColor?: string;
  /** Border width for sticky header bottom edge */
  borderWidth?: number;
  /** Shadow blur radius */
  shadowBlur?: number;
  /** Shadow color */
  shadowColor?: string;
  /** Minimum visible pixels before showing sticky header */
  minScrollThreshold?: number;
  /** Default header cell font */
  headerFont?: string;
  /** Default header text color */
  headerTextColor?: string;
  /** Cell padding */
  cellPadding?: number;
}

const DEFAULT_CONFIG: Required<StickyHeadersLayerConfig> = {
  backgroundColor: '#f8f9fa',
  borderColor: '#d0d0d0',
  borderWidth: 2,
  shadowBlur: 4,
  shadowColor: 'rgba(0, 0, 0, 0.15)',
  minScrollThreshold: 1,
  headerFont: '11px Calibri, sans-serif',
  headerTextColor: '#333333',
  cellPadding: 4,
};

// =============================================================================
// Sticky Headers Layer
// =============================================================================

export class StickyHeadersLayer extends BaseLayer {
  private cellData: CellDataSource;
  private dimensions: ViewportPositionIndex;
  private config: Required<StickyHeadersLayerConfig>;

  constructor(
    cellData: CellDataSource,
    dimensions: ViewportPositionIndex,
    config: StickyHeadersLayerConfig = {},
  ) {
    super({
      id: 'sticky-headers',
      zIndex: 700,
      renderMode: 'per-region',
      canvas: 0,
    });
    this.cellData = cellData;
    this.dimensions = dimensions;
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
    const visibleWidth = regionLocalVisibleRect(region).width;

    // Scan for table headers that have scrolled out of view
    // We check each row in the visible range to find tables whose header
    // row is before the visible range but whose data rows are still visible.
    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        const table = this.cellData.getTableAtCell(sheetId, { row, col });
        if (!table) continue;

        // Skip if no header row
        if (!table.hasHeaderRow) continue;

        const headerRow = table.range.startRow;
        const headerRowTop = this.dimensions.getRowTop(headerRow);
        const headerRowHeight = this.dimensions.getRowHeight(headerRow);

        // Check if header row is scrolled out (before the visible area).
        // Rephrased in region-local coords: header is "scrolled out" when its
        // local-Y is negative; the magnitude is how far above the visible top.
        const headerLocalY = docToRegionXY(0, headerRowTop, region).y;
        const scrolledOut = -headerLocalY;
        if (scrolledOut < this.config.minScrollThreshold) continue;

        // Check if we've scrolled past the table entirely.
        // Rephrased in region-local coords: dataBottom is at-or-above the
        // sticky-header band (occupying local-Y [0, headerRowHeight]).
        const dataEndRow = table.hasTotalRow ? table.range.endRow - 1 : table.range.endRow;
        const dataBottom =
          this.dimensions.getRowTop(dataEndRow) + this.dimensions.getRowHeight(dataEndRow);
        const dataBottomLocalY = docToRegionXY(0, dataBottom, region).y;

        if (dataBottomLocalY <= headerRowHeight) continue;

        // Render sticky header for this table
        this.renderStickyHeader(
          ctx,
          sheetId,
          table.range,
          headerRowHeight,
          region,
          visibleWidth,
          frame.dpr,
        );

        // Skip remaining cols for this row (we found the table)
        break;
      }
    }
  }

  // ===========================================================================
  // Sticky Header Rendering
  // ===========================================================================

  private renderStickyHeader(
    ctx: CanvasRenderingContext2D,
    sheetId: string,
    tableRange: { startRow: number; endRow: number; startCol: number; endCol: number },
    headerHeight: number,
    region: RenderRegion<GridRegionMeta>,
    visibleWidth: number,
    dpr: number,
  ): void {
    const headerRow = tableRange.startRow;
    const tableLeft = docToRegionXY(this.dimensions.getColLeft(tableRange.startCol), 0, region).x;
    const tableRight = docToRegionXY(
      this.dimensions.getColLeft(tableRange.endCol) +
        this.dimensions.getColWidth(tableRange.endCol),
      0,
      region,
    ).x;

    // Skip if table is completely outside viewport horizontally
    if (tableRight < 0 || tableLeft > visibleWidth) return;

    const clipLeft = Math.max(0, tableLeft);
    const clipRight = Math.min(visibleWidth, tableRight);
    const clipWidth = clipRight - clipLeft;
    if (clipWidth <= 0) return;

    ctx.save();

    // Clip to table column range
    ctx.beginPath();
    ctx.rect(clipLeft, 0, clipWidth, headerHeight);
    ctx.clip();

    // Shadow
    ctx.shadowColor = this.config.shadowColor;
    ctx.shadowBlur = this.config.shadowBlur;
    ctx.shadowOffsetY = 2;

    // Background
    ctx.fillStyle = this.config.backgroundColor;
    ctx.fillRect(clipLeft, 0, clipWidth, headerHeight);

    // Reset shadow for cell rendering
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Render each header cell
    for (let col = tableRange.startCol; col <= tableRange.endCol; col++) {
      const cellX = docToRegionXY(this.dimensions.getColLeft(col), 0, region).x;
      const cellWidth = this.dimensions.getColWidth(col);

      if (cellX + cellWidth < 0 || cellX > visibleWidth) continue;

      // Get cell value and render text
      const value = this.cellData.getCellValue(sheetId, { row: headerRow, col });

      // Cell background
      ctx.fillStyle = this.config.backgroundColor;
      ctx.fillRect(cellX, 0, cellWidth, headerHeight);

      // Cell text
      if (value !== null && value !== undefined && value !== '') {
        const displayText = String(value);
        ctx.font = this.config.headerFont;
        ctx.fillStyle = this.config.headerTextColor;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';

        ctx.save();
        ctx.beginPath();
        ctx.rect(cellX, 0, cellWidth, headerHeight);
        ctx.clip();
        ctx.fillText(displayText, cellX + this.config.cellPadding, headerHeight / 2);
        ctx.restore();
      }

      // Right border
      ctx.strokeStyle = this.config.borderColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const snappedBorderX = snapToPixelGrid(cellX + cellWidth, dpr);
      ctx.moveTo(snappedBorderX, 0);
      ctx.lineTo(snappedBorderX, headerHeight);
      ctx.stroke();
    }

    // Bottom border
    ctx.strokeStyle = this.config.borderColor;
    ctx.lineWidth = this.config.borderWidth;
    ctx.beginPath();
    ctx.moveTo(clipLeft, headerHeight - this.config.borderWidth / 2);
    ctx.lineTo(clipRight, headerHeight - this.config.borderWidth / 2);
    ctx.stroke();

    ctx.restore();
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  setConfig(config: Partial<StickyHeadersLayerConfig>): void {
    this.config = { ...this.config, ...config };
    this.markDirty();
  }

  getConfig(): Required<StickyHeadersLayerConfig> {
    return { ...this.config };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createStickyHeadersLayer(
  cellData: CellDataSource,
  dimensions: ViewportPositionIndex,
  config?: StickyHeadersLayerConfig,
): StickyHeadersLayer {
  return new StickyHeadersLayer(cellData, dimensions, config);
}
