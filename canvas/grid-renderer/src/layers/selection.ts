/**
 * Selection Layer
 *
 * Renders selection ranges, active cell, formula highlights, search highlights,
 * paste preview, spill range outlines, table preview ranges, and error states.
 *
 * Extends BaseLayer from grid-renderer with z-index 850, per-region rendering on canvas 0.
 *
 * @module @mog/grid-renderer/layers/selection
 */

import { regionLocalVisibleRect, type FrameContext, type RenderRegion } from '@mog/canvas-engine';
import type { CellRange } from '@mog-sdk/contracts/core';
import type {
  CellCoord,
  GridRegionMeta,
  PreviewCellData,
  SelectionDataSource,
  SelectionRenderState,
  SheetDataSource,
} from '@mog-sdk/contracts/rendering';
import type { SearchHighlight } from '@mog-sdk/contracts/search';
import type { ViewportMergeIndex } from '../coordinates/viewport-merge-index';
import type { ViewportPositionIndex } from '../coordinates/viewport-position-index';
import { cellRectInRegion, rangeRectInRegion } from '../shared/cell-bounds';
import { BaseLayer } from './base-layer';

// =============================================================================
// Internal Rect type (document-space rectangle, not exported)
// =============================================================================

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// =============================================================================
// Configuration
// =============================================================================

export interface SelectionLayerConfig {
  readonly selectionFillColor?: string;
  readonly selectionBorderColor?: string;
  readonly selectionBorderWidth?: number;
  readonly activeCellBorderColor?: string;
  readonly activeCellBorderWidth?: number;
  readonly formulaRangeFillOpacity?: number;
  readonly searchHighlightFillColor?: string;
  readonly searchHighlightBorderColor?: string;
  readonly searchCurrentFillColor?: string;
  readonly searchCurrentBorderColor?: string;
  readonly projectionRangeBorderColor?: string;
  readonly projectionRangeBorderWidth?: number;
  readonly pastePreviewFillColor?: string;
  readonly pastePreviewBorderColor?: string;
  readonly pastePreviewTextColor?: string;
  readonly selectionErrorBorderColor?: string;
  readonly selectionErrorFillColor?: string;
}

function defaultConfigFromSheet(sheetData: SheetDataSource): Required<SelectionLayerConfig> {
  const theme = sheetData.chromeTheme;
  const skin =
    sheetData.sheetViewSkin.skinId === 'default' ? null : sheetData.sheetViewSkin.selection;
  return {
    selectionFillColor: skin?.fill ?? theme.selectionFill,
    selectionBorderColor: skin?.border ?? theme.selectionBorder,
    selectionBorderWidth: skin?.borderWidth ?? 2,
    activeCellBorderColor: skin?.activeBorder ?? theme.activeCellBorder,
    activeCellBorderWidth: skin?.borderWidth ?? 2,
    formulaRangeFillOpacity: 0.2,
    searchHighlightFillColor: 'rgba(255, 235, 59, 0.3)',
    searchHighlightBorderColor: '#ffc107',
    searchCurrentFillColor: 'rgba(255, 152, 0, 0.5)',
    searchCurrentBorderColor: '#ff9800',
    projectionRangeBorderColor: '#0078D4',
    projectionRangeBorderWidth: 1.5,
    pastePreviewFillColor: 'rgba(76, 175, 80, 0.25)',
    pastePreviewBorderColor: '#4CAF50',
    pastePreviewTextColor: 'rgba(0, 0, 0, 0.6)',
    selectionErrorBorderColor: '#dc3545',
    selectionErrorFillColor: 'rgba(220, 53, 69, 0.15)',
  };
}

// =============================================================================
// Selection Layer
// =============================================================================

export class SelectionLayer extends BaseLayer {
  private readonly selectionData: SelectionDataSource;
  private readonly positionIndex: ViewportPositionIndex;
  private readonly mergeIndex: ViewportMergeIndex;
  private sheetData: SheetDataSource;
  private config: Required<SelectionLayerConfig>;
  private readonly configOverrides: SelectionLayerConfig;

  constructor(
    selectionData: SelectionDataSource,
    positionIndex: ViewportPositionIndex,
    mergeIndex: ViewportMergeIndex,
    sheetData: SheetDataSource,
    config: SelectionLayerConfig = {},
  ) {
    super({
      id: 'selection',
      zIndex: 850,
      renderMode: 'per-region',
      canvas: 0,
      cacheable: false,
      // Expand clip by 1px so the 2px selection/active-cell border stroke
      // (which extends 1px outside the cell rect) isn't clipped at region edges.
      // z-index 850 (above headers at 800) ensures the border paints on top of
      // the header background rather than being covered by it.
      clipPadding: 1,
    });
    this.selectionData = selectionData;
    this.positionIndex = positionIndex;
    this.mergeIndex = mergeIndex;
    this.sheetData = sheetData;
    this.configOverrides = config;
    this.config = { ...defaultConfigFromSheet(sheetData), ...this.configOverrides };
  }

  // ===========================================================================
  // Data Source Updates
  // ===========================================================================

  setSheetData(sheetData: SheetDataSource): void {
    this.sheetData = sheetData;
    this.config = { ...defaultConfigFromSheet(sheetData), ...this.configOverrides };
    this.markDirty();
  }

  // ===========================================================================
  // Render Entry Point
  // ===========================================================================

  render(
    ctx: CanvasRenderingContext2D,
    region: RenderRegion<GridRegionMeta>,
    _frame: FrameContext,
  ): void {
    const meta = region.metadata as GridRegionMeta;
    if (!meta) return;

    const sheetId = meta.sheetId;
    const bounds = regionLocalVisibleRect(region);
    const regionCellRange = meta.cellRange;

    const selection = this.selectionData.getSelectionState();
    const editor = this.selectionData.getEditorState();
    const clipboard = this.selectionData.getClipboardState();
    const searchHighlights = this.selectionData.getSearchHighlights();
    const pastePreview = this.selectionData.getPastePreview();
    const tablePreviewRange = this.selectionData.getTablePreviewRange();
    const hasError = this.selectionData.hasError();

    const isEditMode = editor?.isEditing === true;

    // Determine if copy/cut is active — suppress selection fill for clipboard ranges
    // so only the UI layer's marching ants are visible (matching Excel/Sheets behavior)
    const clipboardRanges = clipboard.hasCut ? clipboard.cutSource : clipboard.copySource;
    const hasActiveClipboard =
      this.sheetData.showCutCopyIndicator &&
      ((clipboard.hasCopy && clipboard.copySource) || (clipboard.hasCut && clipboard.cutSource));

    // 1. Formula range highlights (behind everything)
    if (selection.isFormulaMode && selection.formulaRanges) {
      const activeIndex = selection.activeReferenceIndex ?? -1;
      for (const { range, color, index } of selection.formulaRanges) {
        const clipped = this.intersectWithRegion(range, regionCellRange);
        if (!clipped) continue;
        const isActive = index === activeIndex;
        this.renderFormulaRange(ctx, clipped, color, region, bounds, sheetId, isActive);
      }
    }

    // 2. Search highlights — filter to cells within this region
    if (searchHighlights && searchHighlights.length > 0) {
      const regionHighlights = searchHighlights.filter((h) =>
        this.isCellInRegion({ row: h.row, col: h.col }, regionCellRange),
      );
      if (regionHighlights.length > 0) {
        this.renderSearchHighlights(ctx, regionHighlights, region, bounds, sheetId);
      }
    }

    // 3. Selection ranges
    for (const range of selection.ranges) {
      // Skip selection fill/border if this range is the clipboard source —
      // marching ants from the UI layer will be the visual indicator instead
      if (
        hasActiveClipboard &&
        clipboardRanges &&
        this.rangeMatchesClipboard(range, clipboardRanges)
      ) {
        continue;
      }

      const clipped = this.intersectWithRegion(range, regionCellRange);
      if (!clipped) continue;

      // Only pass activeCell for the hole if the active cell is in this region
      const activeCellInRange = this.isActiveCellInRange(selection.activeCell, range);
      const activeCellForRegion =
        activeCellInRange &&
        selection.activeCell &&
        this.isCellInRegion(selection.activeCell, regionCellRange)
          ? selection.activeCell
          : null;

      this.renderSelectionRange(
        ctx,
        clipped,
        activeCellForRegion,
        region,
        bounds,
        sheetId,
        hasError,
        isEditMode,
      );
    }

    // 4. Active cell border — only render in the region containing the active cell
    if (selection.activeCell && this.isCellInRegion(selection.activeCell, regionCellRange)) {
      const isSingleCell =
        selection.ranges.length === 1 && this.isSingleCellRange(selection.ranges[0]);
      if (isSingleCell || selection.isFormulaMode) {
        this.renderActiveCell(ctx, selection.activeCell, region, bounds, sheetId, hasError);
      }
    }

    // 5. Spill range highlight
    if (selection.activeCell && this.isCellInRegion(selection.activeCell, regionCellRange)) {
      this.renderProjectionRangeIfNeeded(ctx, selection, sheetId);
    }

    // 6. Paste preview
    if (pastePreview?.isActive) {
      const clipped = this.intersectWithRegion(pastePreview.targetRange, regionCellRange);
      if (clipped) {
        // Filter preview cells to those in this region
        const regionCells = pastePreview.cells.filter((c) =>
          this.isCellInRegion({ row: c.row, col: c.col }, regionCellRange),
        );
        this.renderPastePreview(ctx, clipped, regionCells, region, bounds, sheetId);
      }
    }

    // 7. Table preview range
    if (tablePreviewRange) {
      const clipped = this.intersectWithRegion(tablePreviewRange, regionCellRange);
      if (clipped) {
        this.renderTablePreviewRange(ctx, clipped, region, bounds, sheetId);
      }
    }
  }

  // ===========================================================================
  // Selection Range Rendering
  // ===========================================================================

  private renderSelectionRange(
    ctx: CanvasRenderingContext2D,
    range: CellRange,
    activeCell: CellCoord | null,
    region: RenderRegion,
    bounds: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    },
    sheetId: string,
    hasError: boolean,
    isEditMode: boolean,
  ): void {
    const activeCellForHole = activeCell;

    // CRITICAL OPTIMIZATION: Full-row and full-column selections MUST avoid O(n)
    // dimension queries. Compute visible portion from region bounds.
    if (range.isFullColumn || range.isFullRow) {
      const rect = this.getFullSelectionRect(range, region, bounds, sheetId);
      if (rect) {
        this.drawSelectionRect(ctx, rect, activeCellForHole, region, sheetId, hasError, isEditMode);
      }
      return;
    }

    const rect = this.rangeToRegionRelative(range, region, sheetId);
    if (rect) {
      this.drawSelectionRect(ctx, rect, activeCellForHole, region, sheetId, hasError, isEditMode);
    }
  }

  /**
   * Get optimized viewport rectangle for full column/row selections.
   * Instead of calculating bounds for MAX_ROWS or MAX_COLS, we render
   * rectangles that span the region area using region.bounds.
   */
  private getFullSelectionRect(
    range: CellRange,
    region: RenderRegion,
    bounds: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    },
    sheetId: string,
  ): Rect | null {
    if (range.isFullColumn) {
      // Full column: get column X bounds, use region height for Y span
      const startRect = cellRectInRegion(region, 0, range.startCol, this.positionIndex);
      const endRect = cellRectInRegion(region, 0, range.endCol, this.positionIndex);
      const x1 = startRect.x;
      const x2 = endRect.x + endRect.width;

      return {
        x: Math.min(x1, x2),
        y: 0,
        width: Math.abs(x2 - x1),
        height: bounds.height,
      };
    } else if (range.isFullRow) {
      // Full row: get row Y bounds, use region width for X span
      const startRect = cellRectInRegion(region, range.startRow, 0, this.positionIndex);
      const endRect = cellRectInRegion(region, range.endRow, 0, this.positionIndex);
      const y1 = startRect.y;
      const y2 = endRect.y + endRect.height;

      return {
        x: 0,
        y: Math.min(y1, y2),
        width: bounds.width,
        height: Math.abs(y2 - y1),
      };
    }
    return null;
  }

  private drawSelectionRect(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    activeCell: CellCoord | null,
    region: RenderRegion,
    sheetId: string,
    hasError: boolean,
    isEditMode: boolean,
  ): void {
    const fillColor = hasError
      ? this.config.selectionErrorFillColor
      : this.config.selectionFillColor;
    const borderColor = hasError
      ? this.config.selectionErrorBorderColor
      : this.config.selectionBorderColor;

    // Edit mode: reduced alpha fill (0.05 effective)
    ctx.fillStyle = isEditMode ? this.adjustAlpha(fillColor, 0.33) : fillColor;

    // Hole-punch the active cell using evenodd clip
    const holeRect = this.getActiveCellHoleRect(activeCell, region, sheetId);
    this.fillRectWithHole(ctx, rect, holeRect);

    // Border
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = this.config.selectionBorderWidth;

    // Edit mode: dashed selection border
    if (isEditMode) {
      ctx.setLineDash([4, 4]);
    } else {
      ctx.setLineDash([]);
    }

    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);

    if (isEditMode) {
      ctx.setLineDash([]);
    }
  }

  // ===========================================================================
  // Active Cell
  // ===========================================================================

  private renderActiveCell(
    ctx: CanvasRenderingContext2D,
    cell: CellCoord,
    region: RenderRegion,
    bounds: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    },
    sheetId: string,
    hasError: boolean,
  ): void {
    const mergedRegion = this.mergeIndex.getMergedRegion(cell.row, cell.col);
    const rect = mergedRegion
      ? this.rangeToRegionRelative(mergedRegion, region, sheetId)
      : this.cellToRegionRelative(cell, region, sheetId);

    if (!rect) return;

    // Skip if outside region bounds
    if (
      rect.x + rect.width < 0 ||
      rect.x > bounds.width ||
      rect.y + rect.height < 0 ||
      rect.y > bounds.height
    ) {
      return;
    }

    const borderColor = hasError
      ? this.config.selectionErrorBorderColor
      : this.config.activeCellBorderColor;

    ctx.strokeStyle = borderColor;
    ctx.lineWidth = this.config.activeCellBorderWidth;
    ctx.setLineDash([]);
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
  }

  // ===========================================================================
  // Formula Range Highlights
  // ===========================================================================

  private renderFormulaRange(
    ctx: CanvasRenderingContext2D,
    range: CellRange,
    color: string,
    region: RenderRegion,
    bounds: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    },
    sheetId: string,
    isActive: boolean,
  ): void {
    const rect = this.rangeToRegionRelative(range, region, sheetId);
    if (!rect) return;

    // Skip if outside region
    if (
      rect.x + rect.width < 0 ||
      rect.x > bounds.width ||
      rect.y + rect.height < 0 ||
      rect.y > bounds.height
    ) {
      return;
    }

    // Active reference gets more emphasis
    const fillOpacity = isActive
      ? Math.min(this.config.formulaRangeFillOpacity * 1.5, 0.5)
      : this.config.formulaRangeFillOpacity;
    const borderWidth = isActive ? 3 : 2;

    // Fill
    ctx.globalAlpha = fillOpacity;
    ctx.fillStyle = color;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.globalAlpha = 1;

    // Border
    ctx.strokeStyle = color;
    ctx.lineWidth = borderWidth;
    ctx.setLineDash([]);
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);

    // Resize handles for active reference
    if (isActive) {
      this.renderFormulaRangeHandles(ctx, rect, color);
    }
  }

  private renderFormulaRangeHandles(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    color: string,
  ): void {
    const handleSize = 6;
    const halfHandle = handleSize / 2;

    const handles = [
      { x: rect.x - halfHandle, y: rect.y - halfHandle },
      { x: rect.x + rect.width - halfHandle, y: rect.y - halfHandle },
      { x: rect.x - halfHandle, y: rect.y + rect.height - halfHandle },
      { x: rect.x + rect.width - halfHandle, y: rect.y + rect.height - halfHandle },
    ];

    ctx.fillStyle = color;
    for (const h of handles) {
      ctx.fillRect(h.x, h.y, handleSize, handleSize);
    }

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    for (const h of handles) {
      ctx.strokeRect(h.x + 0.5, h.y + 0.5, handleSize - 1, handleSize - 1);
    }
  }

  // ===========================================================================
  // Search Highlights
  // ===========================================================================

  private renderSearchHighlights(
    ctx: CanvasRenderingContext2D,
    highlights: ReadonlyArray<SearchHighlight>,
    region: RenderRegion,
    bounds: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    },
    sheetId: string,
  ): void {
    for (const highlight of highlights) {
      const rect = this.cellToRegionRelative(
        { row: highlight.row, col: highlight.col },
        region,
        sheetId,
      );
      if (!rect) continue;

      // Skip if outside region bounds
      if (
        rect.x + rect.width < 0 ||
        rect.x > bounds.width ||
        rect.y + rect.height < 0 ||
        rect.y > bounds.height
      ) {
        continue;
      }

      if (highlight.isCurrent) {
        ctx.fillStyle = this.config.searchCurrentFillColor;
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
        ctx.strokeStyle = this.config.searchCurrentBorderColor;
        ctx.lineWidth = 2;
        ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
      } else {
        ctx.fillStyle = this.config.searchHighlightFillColor;
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
        ctx.strokeStyle = this.config.searchHighlightBorderColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
      }
    }
  }

  // ===========================================================================
  // Projection Range Highlight
  // ===========================================================================

  private renderProjectionRangeIfNeeded(
    _ctx: CanvasRenderingContext2D,
    selection: SelectionRenderState,
    _sheetId: string,
  ): void {
    if (!selection.activeCell) return;

    // Check for projection range on active cell via selection state.
    // This is a stub — projection range info would come from the cell metadata cache.
    // We skip if not available.
  }

  // ===========================================================================
  // Paste Preview
  // ===========================================================================

  private renderPastePreview(
    ctx: CanvasRenderingContext2D,
    targetRange: CellRange,
    cells: ReadonlyArray<PreviewCellData>,
    region: RenderRegion,
    bounds: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    },
    sheetId: string,
  ): void {
    const rangeRect = this.rangeToRegionRelative(targetRange, region, sheetId);
    if (!rangeRect) return;

    // Skip if outside region bounds
    if (
      rangeRect.x + rangeRect.width < 0 ||
      rangeRect.x > bounds.width ||
      rangeRect.y + rangeRect.height < 0 ||
      rangeRect.y > bounds.height
    ) {
      return;
    }

    ctx.save();

    // Fill
    ctx.fillStyle = this.config.pastePreviewFillColor;
    ctx.fillRect(rangeRect.x, rangeRect.y, rangeRect.width, rangeRect.height);

    // Dashed green border
    ctx.strokeStyle = this.config.pastePreviewBorderColor;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(rangeRect.x + 0.5, rangeRect.y + 0.5, rangeRect.width - 1, rangeRect.height - 1);
    ctx.setLineDash([]);

    // Render preview cell values (limit to 100 cells for performance)
    const maxCells = 100;
    const cellsToRender = cells.slice(0, maxCells);

    for (const previewCell of cellsToRender) {
      const cellRect = this.cellToRegionRelative(
        { row: previewCell.row, col: previewCell.col },
        region,
        sheetId,
      );
      if (!cellRect) continue;

      if (
        cellRect.x + cellRect.width < 0 ||
        cellRect.x > bounds.width ||
        cellRect.y + cellRect.height < 0 ||
        cellRect.y > bounds.height
      ) {
        continue;
      }

      if (previewCell.displayValue) {
        this.renderPreviewCellText(ctx, cellRect, previewCell);
      }
    }

    ctx.restore();
  }

  private renderPreviewCellText(
    ctx: CanvasRenderingContext2D,
    cellRect: Rect,
    previewCell: PreviewCellData,
  ): void {
    const padding = 4;
    const maxWidth = cellRect.width - padding * 2;
    const maxHeight = cellRect.height - padding * 2;

    if (maxWidth < 20 || maxHeight < 12) return;

    ctx.fillStyle = this.config.pastePreviewTextColor;
    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textBaseline = 'middle';

    let text = previewCell.displayValue;
    let textWidth = ctx.measureText(text).width;
    if (textWidth > maxWidth) {
      while (textWidth > maxWidth && text.length > 1) {
        text = text.slice(0, -1);
        textWidth = ctx.measureText(text + '...').width;
      }
      text = text + '...';
    }

    ctx.fillText(text, cellRect.x + padding, cellRect.y + cellRect.height / 2, maxWidth);
  }

  // ===========================================================================
  // Table Preview Range
  // ===========================================================================

  private renderTablePreviewRange(
    ctx: CanvasRenderingContext2D,
    range: CellRange,
    region: RenderRegion,
    bounds: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    },
    sheetId: string,
  ): void {
    const rect = this.rangeToRegionRelative(range, region, sheetId);
    if (!rect) return;

    if (
      rect.x + rect.width < 0 ||
      rect.x > bounds.width ||
      rect.y + rect.height < 0 ||
      rect.y > bounds.height
    ) {
      return;
    }

    ctx.save();

    // Light blue fill
    ctx.fillStyle = 'rgba(68, 114, 196, 0.15)';
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

    // Dashed border in table accent color
    ctx.strokeStyle = '#4472C4';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
    ctx.setLineDash([]);

    ctx.restore();
  }

  // ===========================================================================
  // Hole Punching Helpers
  // ===========================================================================

  private rangeMatchesClipboard(range: CellRange, clipboardRanges: CellRange[]): boolean {
    return clipboardRanges.some(
      (cr) =>
        cr.startRow === range.startRow &&
        cr.startCol === range.startCol &&
        cr.endRow === range.endRow &&
        cr.endCol === range.endCol,
    );
  }

  private isActiveCellInRange(activeCell: CellCoord | null, range: CellRange): boolean {
    if (!activeCell) return false;
    return (
      activeCell.row >= range.startRow &&
      activeCell.row <= range.endRow &&
      activeCell.col >= range.startCol &&
      activeCell.col <= range.endCol
    );
  }

  private isSingleCellRange(range: CellRange): boolean {
    return range.startRow === range.endRow && range.startCol === range.endCol;
  }

  private fillRectWithHole(
    ctx: CanvasRenderingContext2D,
    outerRect: Rect,
    holeRect: Rect | null,
  ): void {
    if (holeRect) {
      if (this.rectContainsRect(holeRect, outerRect)) {
        return;
      }
      ctx.save();
      ctx.beginPath();
      ctx.rect(outerRect.x, outerRect.y, outerRect.width, outerRect.height);
      ctx.rect(holeRect.x, holeRect.y, holeRect.width, holeRect.height);
      ctx.clip('evenodd');
      ctx.fillRect(outerRect.x, outerRect.y, outerRect.width, outerRect.height);
      ctx.restore();
    } else {
      ctx.fillRect(outerRect.x, outerRect.y, outerRect.width, outerRect.height);
    }
  }

  private rectContainsRect(container: Rect, contained: Rect): boolean {
    return (
      container.x <= contained.x &&
      container.y <= contained.y &&
      container.x + container.width >= contained.x + contained.width &&
      container.y + container.height >= contained.y + contained.height
    );
  }

  private getActiveCellHoleRect(
    activeCell: CellCoord | null,
    region: RenderRegion,
    sheetId: string,
  ): Rect | null {
    if (!activeCell) return null;
    const mergedRegion = this.mergeIndex.getMergedRegion(activeCell.row, activeCell.col);
    return mergedRegion
      ? this.rangeToRegionRelative(mergedRegion, region, sheetId)
      : this.cellToRegionRelative(activeCell, region, sheetId);
  }

  // ===========================================================================
  // Region Cell-Range Clipping
  // ===========================================================================

  /**
   * Intersect a selection range with the region's visible cell range.
   * Returns null if no overlap (selection is entirely outside this region).
   *
   * For full-row selections, only the row range is intersected (columns span
   * the region's column range). For full-column selections, only the column
   * range is intersected.
   */
  private intersectWithRegion(range: CellRange, regionCellRange: CellRange): CellRange | null {
    const startRow = range.isFullColumn
      ? regionCellRange.startRow
      : Math.max(range.startRow, regionCellRange.startRow);
    const endRow = range.isFullColumn
      ? regionCellRange.endRow
      : Math.min(range.endRow, regionCellRange.endRow);
    const startCol = range.isFullRow
      ? regionCellRange.startCol
      : Math.max(range.startCol, regionCellRange.startCol);
    const endCol = range.isFullRow
      ? regionCellRange.endCol
      : Math.min(range.endCol, regionCellRange.endCol);

    if (startRow > endRow || startCol > endCol) return null;

    return {
      startRow,
      endRow,
      startCol,
      endCol,
      isFullRow: range.isFullRow,
      isFullColumn: range.isFullColumn,
    };
  }

  /**
   * Check if a cell coordinate falls within the given cell range.
   */
  private isCellInRegion(cell: CellCoord, regionCellRange: CellRange): boolean {
    return (
      cell.row >= regionCellRange.startRow &&
      cell.row <= regionCellRange.endRow &&
      cell.col >= regionCellRange.startCol &&
      cell.col <= regionCellRange.endCol
    );
  }

  // ===========================================================================
  // Coordinate Conversion Helpers
  // ===========================================================================

  /**
   * Convert a cell range to region-local UNZOOMED rectangle. Composes the
   * canonical helper `rangeRectInRegion` (which composes `docToCanvasXY`)
   * so the doc⇄canvas formula lives in exactly one place.
   */
  private rangeToRegionRelative(range: CellRange, region: RenderRegion, sheetId: string): Rect {
    return rangeRectInRegion(
      region,
      range.startRow,
      range.startCol,
      range.endRow,
      range.endCol,
      this.positionIndex,
    );
  }

  /**
   * Convert a single cell to region-local UNZOOMED rectangle. Composes the
   * canonical helper `cellRectInRegion`.
   */
  private cellToRegionRelative(cell: CellCoord, region: RenderRegion, sheetId: string): Rect {
    return cellRectInRegion(region, cell.row, cell.col, this.positionIndex);
  }

  // ===========================================================================
  // Color Helpers
  // ===========================================================================

  /**
   * Adjust the alpha value of an rgba() color string.
   */
  private adjustAlpha(color: string, multiplier: number): string {
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (match) {
      const r = match[1];
      const g = match[2];
      const b = match[3];
      const a = match[4] ? parseFloat(match[4]) * multiplier : 1 * multiplier;
      return `rgba(${r}, ${g}, ${b}, ${Math.min(a, 1)})`;
    }
    return color;
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  setConfig(config: Partial<SelectionLayerConfig>): void {
    const changed = Object.keys(config).some(
      (key) =>
        config[key as keyof SelectionLayerConfig] !==
        this.config[key as keyof SelectionLayerConfig],
    );
    if (changed) {
      this.config = { ...this.config, ...config };
      this.markDirty();
    }
  }

  getConfig(): Required<SelectionLayerConfig> {
    return { ...this.config };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createSelectionLayer(
  selectionData: SelectionDataSource,
  positionIndex: ViewportPositionIndex,
  mergeIndex: ViewportMergeIndex,
  sheetData: SheetDataSource,
  config?: SelectionLayerConfig,
): SelectionLayer {
  return new SelectionLayer(selectionData, positionIndex, mergeIndex, sheetData, config);
}
