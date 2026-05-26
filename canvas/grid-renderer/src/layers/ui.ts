/**
 * UI Layer
 *
 * Renders interactive UI elements on top of the grid:
 * - Fill handle (autofill small square)
 * - Marching ants (animated dashed border for cut/copy indicator)
 * - Resize handles during row/col resize
 * - Drag preview (semi-transparent cells at target position)
 * - Table resize handle (bottom-right grip)
 * - Selection size tooltip ("5R x 3C") during active drag
 * - Fill drag tooltip
 * - Blocked edit flash (red overlay, decays over 300ms)
 *
 * Extends BaseLayer with z-index 400, per-region rendering on canvas 0.
 *
 * @module @mog/grid-renderer/layers/ui
 */

import {
  docSpaceRect,
  regionLocalVisibleRect,
  type AnimationClock,
  type DirtyHint,
  type DocSpaceRect,
  type FrameContext,
  type Rect as EngineRect,
  type RenderRegion,
} from '@mog/canvas-engine';
import type { CellRange } from '@mog-sdk/contracts/core';
import type {
  CellCoord,
  GridRegionMeta,
  SelectionDataSource,
  SheetDataSource,
} from '@mog-sdk/contracts/rendering';
import type { ViewportPositionIndex } from '../coordinates/viewport-position-index';
import { cellRectInRegion, rangeRectInRegion } from '../shared/cell-bounds';
import { BaseLayer } from './base-layer';

// =============================================================================
// Internal Rect type
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

export interface UILayerConfig {
  readonly fillHandleSize?: number;
  readonly fillHandleColor?: string;
  readonly fillHandleBorderColor?: string;
  readonly marchingAntsDash?: number[];
  readonly marchingAntsLineWidth?: number;
  readonly marchingAntsColor?: string;
  readonly marchingAntsContrastColor?: string;
  readonly marchingAntsSpeed?: number;
  readonly resizeHandleSize?: number;
  readonly resizeHandleColor?: string;
  readonly dragSourceColor?: string;
  readonly dragTargetColor?: string;
  readonly dragTargetFillColor?: string;
  readonly dragCopyModeColor?: string;
  readonly resizeLineColor?: string;
  readonly resizeLineWidth?: number;
  readonly resizeTooltipBackground?: string;
  readonly resizeTooltipTextColor?: string;
  readonly resizeTooltipFont?: string;
  readonly tableResizeHandleSize?: number;
  readonly tableResizeHandleColor?: string;
}

function defaultConfigFromSheet(sheetData: SheetDataSource): Required<UILayerConfig> {
  const theme = sheetData.chromeTheme;
  const handle =
    sheetData.sheetViewSkin.skinId === 'default' ? null : sheetData.sheetViewSkin.selection.handle;
  return {
    fillHandleSize: handle?.sizePx ?? 8,
    fillHandleColor: handle?.color ?? theme.fillHandleColor,
    fillHandleBorderColor: handle?.borderColor ?? '#ffffff',
    marchingAntsDash: [4, 4],
    marchingAntsLineWidth: 1,
    marchingAntsColor: '#000000',
    marchingAntsContrastColor: '#ffffff',
    marchingAntsSpeed: 0.5,
    resizeHandleSize: 6,
    resizeHandleColor: theme.fillHandleColor,
    dragSourceColor: theme.dragSourceColor,
    dragTargetColor: theme.dragTargetColor,
    dragTargetFillColor: 'rgba(66, 133, 244, 0.1)',
    dragCopyModeColor: '#34a853',
    resizeLineColor: theme.fillHandleColor,
    resizeLineWidth: 2,
    resizeTooltipBackground: 'rgba(60, 64, 67, 0.9)',
    resizeTooltipTextColor: '#ffffff',
    resizeTooltipFont: '11px -apple-system, BlinkMacSystemFont, sans-serif',
    tableResizeHandleSize: 10,
    tableResizeHandleColor: '#5B9BD5',
  };
}

// =============================================================================
// Marching Ants State
// =============================================================================

/** Simple marching ants phase tracker using FrameContext.timestamp */
interface MarchingAntsState {
  phase: number;
  lastTimestamp: number;
  isActive: boolean;
}

// =============================================================================
// UI Layer
// =============================================================================

export class UILayer extends BaseLayer {
  private readonly selectionData: SelectionDataSource;
  private sheetData: SheetDataSource;
  private readonly dimensions: ViewportPositionIndex;
  private readonly animationClock: AnimationClock;
  private config: Required<UILayerConfig>;
  private readonly configOverrides: UILayerConfig;
  private marchingAnts: MarchingAntsState;

  constructor(
    selectionData: SelectionDataSource,
    sheetData: SheetDataSource,
    dimensions: ViewportPositionIndex,
    animationClock: AnimationClock,
    config: UILayerConfig = {},
  ) {
    super({
      id: 'ui',
      zIndex: 400,
      renderMode: 'per-region',
      canvas: 0,
      cacheable: false,
    });
    this.selectionData = selectionData;
    this.sheetData = sheetData;
    this.dimensions = dimensions;
    this.animationClock = animationClock;
    this.configOverrides = config;
    this.config = { ...defaultConfigFromSheet(sheetData), ...this.configOverrides };
    this.marchingAnts = { phase: 0, lastTimestamp: 0, isActive: false };
  }

  setSheetData(sheetData: SheetDataSource): void {
    this.sheetData = sheetData;
    this.config = { ...defaultConfigFromSheet(sheetData), ...this.configOverrides };
    this.markDirty();
  }

  // ===========================================================================
  // Continuous Frame Dirty Hint (marching ants animation)
  // ===========================================================================

  /**
   * Return a targeted dirty hint for the marching ants animation tick.
   *
   * Instead of marking the entire UI layer as full-dirty every frame,
   * we compute the pixel bounds of the marching ants border strip
   * (a thin rect around the clipboard range) and return a rect hint.
   * This allows the render loop to repaint only the border region.
   */
  getContinuousFrameDirtyHint(): DirtyHint {
    if (!this.marchingAnts.isActive) {
      return { type: 'full' };
    }

    const clipboard = this.selectionData.getClipboardState();
    const ranges = clipboard.hasCut ? clipboard.cutSource : clipboard.copySource;

    if (!ranges || ranges.length === 0) {
      return { type: 'full' };
    }

    const rects: DocSpaceRect[] = [];
    for (const range of ranges) {
      const strip = this.computeMarchingAntsBorderStrip(range);
      if (strip) {
        rects.push(strip);
      }
    }

    if (rects.length === 0) {
      return { type: 'full' };
    }

    return { type: 'rects', bounds: rects };
  }

  /**
   * Compute the outer bounding rect of the marching ants border strip
   * for a given range. The strip includes the contrast line (lineWidth + 1)
   * plus the dashed line, with a few pixels of padding for anti-aliasing.
   *
   * Returns absolute document-space pixel coordinates (no scroll offset applied,
   * since the dirty hint is in canvas-space and the render loop clips accordingly).
   */
  private computeMarchingAntsBorderStrip(range: CellRange): DocSpaceRect | null {
    // Compute the pixel bounds of the range using dimensions
    const x1 = this.dimensions.getColLeft(range.startCol);
    const y1 = this.dimensions.getRowTop(range.startRow);
    const x2 = this.dimensions.getColLeft(range.endCol) + this.dimensions.getColWidth(range.endCol);
    const y2 = this.dimensions.getRowTop(range.endRow) + this.dimensions.getRowHeight(range.endRow);

    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const right = Math.max(x1, x2);
    const bottom = Math.max(y1, y2);

    // The marching ants render a contrast line (lineWidth + 1) and a dashed line (lineWidth).
    // With 0.5px offsets and rounding, we need about 3px padding on each side.
    const padding = this.config.marchingAntsLineWidth + 3;

    return docSpaceRect(
      left - padding,
      top - padding,
      right - left + padding * 2,
      bottom - top + padding * 2,
    );
  }

  // ===========================================================================
  // Render Entry Point
  // ===========================================================================

  render(
    ctx: CanvasRenderingContext2D,
    region: RenderRegion<GridRegionMeta>,
    frame: FrameContext,
  ): void {
    const meta = region.metadata as GridRegionMeta;
    if (!meta) return;

    const sheetId = meta.sheetId;
    const bounds = regionLocalVisibleRect(region);

    const selection = this.selectionData.getSelectionState();
    const clipboard = this.selectionData.getClipboardState();

    const showCutCopyIndicator = this.sheetData.showCutCopyIndicator;
    const allowDragFill = this.sheetData.allowDragFill;
    const blockedEditAttempt = this.sheetData.blockedEditAttempt;

    // 1. Marching ants for cut/copy
    // Sheet-scoped: only show ants on the sheet where the copy/cut originated.
    // External clipboard data (sourceSheetId === null) never shows ants.
    const isSourceSheet = clipboard.sourceSheetId === sheetId;
    const showAnts =
      showCutCopyIndicator &&
      isSourceSheet &&
      ((clipboard.hasCopy && clipboard.copySource) || (clipboard.hasCut && clipboard.cutSource));

    if (showAnts) {
      // Start continuous frames for animation
      if (!this.marchingAnts.isActive) {
        this.marchingAnts.isActive = true;
        this.animationClock.requestContinuousFrames(this.id);
      }

      // Advance phase based on timestamp
      this.updateMarchingAntsPhase(frame.timestamp);

      const ranges = clipboard.hasCut ? clipboard.cutSource : clipboard.copySource;
      if (ranges) {
        for (const range of ranges) {
          this.renderMarchingAnts(ctx, range, region, bounds, sheetId);
        }
      }
    } else if (this.marchingAnts.isActive) {
      // Stop continuous frames when ants no longer needed
      this.marchingAnts.isActive = false;
      this.marchingAnts.phase = 0;
      this.animationClock.stopContinuousFrames(this.id);
    }

    // 2. Fill handle
    if (allowDragFill && selection.ranges.length > 0 && !selection.isDraggingFillHandle) {
      const lastRange = selection.ranges[selection.ranges.length - 1];
      this.renderFillHandle(ctx, lastRange, region, bounds, sheetId);
    }

    // 3. Fill preview during fill handle drag
    if (selection.isDraggingFillHandle && selection.fillPreviewRange) {
      this.renderFillPreview(ctx, selection.fillPreviewRange, region, bounds, sheetId);

      // Fill drag tooltip
      this.renderFillDragTooltip(ctx, selection.fillPreviewRange, region, bounds, sheetId);
    }

    // 4. Cell drag-drop preview
    if (selection.isDraggingCells && selection.dragSourceRange && selection.dragTargetCell) {
      this.renderCellDragPreview(
        ctx,
        selection.dragSourceRange,
        selection.dragTargetCell,
        selection.dragMode,
        region,
        bounds,
        sheetId,
      );
    }

    // 5. Header resize line
    if (
      selection.isResizingHeader &&
      selection.resizeType !== null &&
      selection.resizeIndex !== null &&
      selection.resizeCurrentSize !== null
    ) {
      this.renderResizeLine(
        ctx,
        selection.resizeType,
        selection.resizeIndex,
        selection.resizeCurrentSize,
        region,
        bounds,
        sheetId,
      );
    }

    // 6. Selection size tooltip during drag selection
    if (selection.isSelecting && selection.ranges.length > 0) {
      const currentRange = selection.ranges[selection.ranges.length - 1];
      const rows = Math.abs(currentRange.endRow - currentRange.startRow) + 1;
      const cols = Math.abs(currentRange.endCol - currentRange.startCol) + 1;

      if (rows > 1 || cols > 1) {
        const tooltipText = `${rows}R x ${cols}C`;
        const endRow = Math.max(currentRange.startRow, currentRange.endRow);
        const endCol = Math.max(currentRange.startCol, currentRange.endCol);
        const cellRect = this.cellToRegionRelative({ row: endRow, col: endCol }, region, sheetId);
        this.renderTooltip(
          ctx,
          tooltipText,
          cellRect.x + cellRect.width + 4,
          cellRect.y + cellRect.height + 4,
        );
      }
    }

    // 7. Blocked edit flash (red overlay, decays over 300ms)
    if (blockedEditAttempt) {
      const elapsed = frame.timestamp - blockedEditAttempt.timestamp;
      if (elapsed < 300) {
        const cellId = blockedEditAttempt.cellId;
        const parts = cellId.split(':');
        if (parts.length === 3 && parts[0] === sheetId) {
          const row = parseInt(parts[1], 10);
          const col = parseInt(parts[2], 10);
          if (!isNaN(row) && !isNaN(col)) {
            this.renderBlockedEditFlash(ctx, { row, col }, elapsed, region, bounds, sheetId);
          }
        }
      }
    }

    // 8. Shimmer effects on recently-changed cells
    if (this.sheetData.shimmerEnabled && this.sheetData.shimmerEntries.length > 0) {
      let hasActive = false;
      const now = frame.timestamp;
      for (const entry of this.sheetData.shimmerEntries) {
        if (entry.sheetId !== sheetId) continue;
        const elapsed = now - entry.startTime;
        if (elapsed >= this.sheetData.shimmerDurationMs) continue;
        hasActive = true;
        const progress = elapsed / this.sheetData.shimmerDurationMs;
        const rect = rangeRectInRegion(
          region,
          entry.range.startRow,
          entry.range.startCol,
          entry.range.endRow,
          entry.range.endCol,
          this.dimensions,
        );
        if (!rect || rect.width <= 0 || rect.height <= 0) continue;
        const effect = this.sheetData.shimmerEffect;
        if (effect === 'sweep') {
          this.renderShimmerSweep(ctx, rect, progress);
        } else if (effect === 'pulse') {
          this.renderShimmerPulse(ctx, rect, progress);
        } else if (effect === 'border-glow') {
          this.renderShimmerBorderGlow(ctx, rect, progress);
        } else {
          this.renderShimmerFade(ctx, rect, progress);
        }
      }
      if (hasActive) {
        this.animationClock.requestContinuousFrames(this.id);
        this.markDirty();
      }
    }
  }

  // ===========================================================================
  // Marching Ants
  // ===========================================================================

  private updateMarchingAntsPhase(timestamp: number): void {
    if (this.marchingAnts.lastTimestamp === 0) {
      this.marchingAnts.lastTimestamp = timestamp;
      return;
    }
    const delta = timestamp - this.marchingAnts.lastTimestamp;
    this.marchingAnts.lastTimestamp = timestamp;

    // Advance phase (pixels per ms * elapsed ms)
    const speed = this.config.marchingAntsSpeed; // pixels per frame (~16ms)
    this.marchingAnts.phase += speed * (delta / 16);

    // Wrap phase to avoid overflow
    const totalDash = this.config.marchingAntsDash.reduce((a, b) => a + b, 0);
    if (totalDash > 0) {
      this.marchingAnts.phase %= totalDash;
    }
  }

  private renderMarchingAnts(
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

    // Skip if outside region bounds
    if (
      rect.x + rect.width < 0 ||
      rect.x > bounds.width ||
      rect.y + rect.height < 0 ||
      rect.y > bounds.height
    ) {
      return;
    }

    // White/contrast background line (solid) for visibility on dark backgrounds
    ctx.strokeStyle = this.config.marchingAntsContrastColor;
    ctx.lineWidth = this.config.marchingAntsLineWidth + 1;
    ctx.setLineDash([]);
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);

    // Animated dashed primary line on top
    ctx.strokeStyle = this.config.marchingAntsColor;
    ctx.lineWidth = this.config.marchingAntsLineWidth;
    ctx.setLineDash(this.config.marchingAntsDash);
    ctx.lineDashOffset = -this.marchingAnts.phase;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }

  // ===========================================================================
  // Fill Handle
  // ===========================================================================

  private renderFillHandle(
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
    // Determine fill handle position based on selection type:
    // - Full column: top-right (avoids O(n) row iteration)
    // - Full row: bottom-left (avoids O(n) col iteration)
    // - Normal: bottom-right
    let handleCell: CellCoord;
    let positionAtTop = false;
    let positionAtLeft = false;

    if (range.isFullColumn) {
      handleCell = {
        row: Math.min(range.startRow, range.endRow),
        col: Math.max(range.startCol, range.endCol),
      };
      positionAtTop = true;
    } else if (range.isFullRow) {
      handleCell = {
        row: Math.max(range.startRow, range.endRow),
        col: Math.min(range.startCol, range.endCol),
      };
      positionAtLeft = true;
    } else {
      handleCell = {
        row: Math.max(range.startRow, range.endRow),
        col: Math.max(range.startCol, range.endCol),
      };
    }

    const cellRect = this.cellToRegionRelative(handleCell, region, sheetId);

    // Skip if outside region bounds
    if (
      cellRect.x + cellRect.width < 0 ||
      cellRect.x > bounds.width ||
      cellRect.y + cellRect.height < 0 ||
      cellRect.y > bounds.height
    ) {
      return;
    }

    const size = this.config.fillHandleSize;
    const x = positionAtLeft ? cellRect.x : cellRect.x + cellRect.width - size / 2;
    const y = positionAtTop ? cellRect.y : cellRect.y + cellRect.height - size / 2;

    // Small filled square
    ctx.fillStyle = this.config.fillHandleColor;
    ctx.fillRect(x, y, size, size);

    // White border
    ctx.strokeStyle = this.config.fillHandleBorderColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
  }

  // ===========================================================================
  // Fill Preview
  // ===========================================================================

  private renderFillPreview(
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

    if (
      rect.x + rect.width < 0 ||
      rect.x > bounds.width ||
      rect.y + rect.height < 0 ||
      rect.y > bounds.height
    ) {
      return;
    }

    // Semi-transparent fill
    ctx.fillStyle = 'rgba(66, 133, 244, 0.1)';
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

    // Dashed border
    ctx.strokeStyle = this.config.fillHandleColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
    ctx.setLineDash([]);
  }

  private renderFillDragTooltip(
    ctx: CanvasRenderingContext2D,
    fillPreviewRange: CellRange,
    region: RenderRegion,
    bounds: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    },
    sheetId: string,
  ): void {
    const rows = Math.abs(fillPreviewRange.endRow - fillPreviewRange.startRow) + 1;
    const cols = Math.abs(fillPreviewRange.endCol - fillPreviewRange.startCol) + 1;
    const tooltipText = `${rows}R x ${cols}C`;

    const endRow = Math.max(fillPreviewRange.startRow, fillPreviewRange.endRow);
    const endCol = Math.max(fillPreviewRange.startCol, fillPreviewRange.endCol);
    const cellRect = this.cellToRegionRelative({ row: endRow, col: endCol }, region, sheetId);

    const tooltipX = cellRect.x + cellRect.width + 8;
    const tooltipY = cellRect.y + cellRect.height + 8;

    if (tooltipX > bounds.width || tooltipY > bounds.height) return;

    this.renderTooltip(ctx, tooltipText, tooltipX, tooltipY);
  }

  // ===========================================================================
  // Cell Drag-Drop Preview
  // ===========================================================================

  private renderCellDragPreview(
    ctx: CanvasRenderingContext2D,
    sourceRange: CellRange,
    targetCell: CellCoord,
    mode: 'move' | 'copy',
    region: RenderRegion,
    bounds: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    },
    sheetId: string,
  ): void {
    const sourceRows = Math.abs(sourceRange.endRow - sourceRange.startRow) + 1;
    const sourceCols = Math.abs(sourceRange.endCol - sourceRange.startCol) + 1;

    // 1. Source highlight
    const sourceRect = this.rangeToRegionRelative(sourceRange, region, sheetId);
    const sourceVisible = !(
      sourceRect.x + sourceRect.width < 0 ||
      sourceRect.x > bounds.width ||
      sourceRect.y + sourceRect.height < 0 ||
      sourceRect.y > bounds.height
    );

    if (sourceVisible) {
      ctx.fillStyle = this.config.dragSourceColor;
      ctx.fillRect(sourceRect.x, sourceRect.y, sourceRect.width, sourceRect.height);

      ctx.strokeStyle =
        mode === 'copy' ? this.config.dragCopyModeColor : this.config.dragTargetColor;
      ctx.lineWidth = 1;
      ctx.setLineDash(mode === 'move' ? [4, 4] : []);
      ctx.strokeRect(
        sourceRect.x + 0.5,
        sourceRect.y + 0.5,
        sourceRect.width - 1,
        sourceRect.height - 1,
      );
      ctx.setLineDash([]);
    }

    // 2. Target preview
    const targetRange: CellRange = {
      startRow: targetCell.row,
      startCol: targetCell.col,
      endRow: targetCell.row + sourceRows - 1,
      endCol: targetCell.col + sourceCols - 1,
    };

    const targetRect = this.rangeToRegionRelative(targetRange, region, sheetId);
    const targetVisible = !(
      targetRect.x + targetRect.width < 0 ||
      targetRect.x > bounds.width ||
      targetRect.y + targetRect.height < 0 ||
      targetRect.y > bounds.height
    );

    if (targetVisible) {
      ctx.fillStyle = this.config.dragTargetFillColor;
      ctx.fillRect(targetRect.x, targetRect.y, targetRect.width, targetRect.height);

      ctx.strokeStyle =
        mode === 'copy' ? this.config.dragCopyModeColor : this.config.dragTargetColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(
        targetRect.x + 1,
        targetRect.y + 1,
        targetRect.width - 2,
        targetRect.height - 2,
      );
    }
  }

  // ===========================================================================
  // Header Resize Line
  // ===========================================================================

  private renderResizeLine(
    ctx: CanvasRenderingContext2D,
    resizeType: 'column' | 'row',
    resizeIndex: number,
    currentSize: number,
    region: RenderRegion,
    bounds: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    },
    sheetId: string,
  ): void {
    ctx.save();

    if (resizeType === 'column') {
      // Compose canonical helper: cellRectInRegion gives region-local x for the column.
      const colRect = cellRectInRegion(region, 0, resizeIndex, this.dimensions);
      const lineX = colRect.x + currentSize;

      if (lineX < 0 || lineX > bounds.width) {
        ctx.restore();
        return;
      }

      ctx.strokeStyle = this.config.resizeLineColor;
      ctx.lineWidth = this.config.resizeLineWidth;
      ctx.beginPath();
      ctx.moveTo(lineX, 0);
      ctx.lineTo(lineX, bounds.height);
      ctx.stroke();

      this.renderResizeTooltip(ctx, lineX, 30, `${Math.round(currentSize)}px`);
    } else {
      // Compose canonical helper: cellRectInRegion gives region-local y for the row.
      const rowRect = cellRectInRegion(region, resizeIndex, 0, this.dimensions);
      const lineY = rowRect.y + currentSize;

      if (lineY < 0 || lineY > bounds.height) {
        ctx.restore();
        return;
      }

      ctx.strokeStyle = this.config.resizeLineColor;
      ctx.lineWidth = this.config.resizeLineWidth;
      ctx.beginPath();
      ctx.moveTo(0, lineY);
      ctx.lineTo(bounds.width, lineY);
      ctx.stroke();

      this.renderResizeTooltip(ctx, 50, lineY - 20, `${Math.round(currentSize)}px`);
    }

    ctx.restore();
  }

  private renderResizeTooltip(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    text: string,
  ): void {
    ctx.font = this.config.resizeTooltipFont;
    const metrics = ctx.measureText(text);
    const padding = 4;
    const tooltipWidth = metrics.width + padding * 2;
    const tooltipHeight = 18;

    const tooltipX = x + 8;
    const tooltipY = Math.max(0, y);

    ctx.fillStyle = this.config.resizeTooltipBackground;
    ctx.beginPath();
    ctx.roundRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight, 3);
    ctx.fill();

    ctx.fillStyle = this.config.resizeTooltipTextColor;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, tooltipX + padding, tooltipY + tooltipHeight / 2);
  }

  // ===========================================================================
  // Blocked Edit Flash
  // ===========================================================================

  private renderBlockedEditFlash(
    ctx: CanvasRenderingContext2D,
    cell: CellCoord,
    elapsedMs: number,
    region: RenderRegion,
    bounds: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    },
    sheetId: string,
  ): void {
    const rect = this.cellToRegionRelative(cell, region, sheetId);

    if (
      rect.x + rect.width < 0 ||
      rect.x > bounds.width ||
      rect.y + rect.height < 0 ||
      rect.y > bounds.height
    ) {
      return;
    }

    // Decay alpha over 300ms
    const alpha = Math.max(0, 1 - elapsedMs / 300);

    ctx.fillStyle = `rgba(255, 0, 0, ${(0.15 * alpha).toFixed(3)})`;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

    ctx.strokeStyle = `rgba(255, 0, 0, ${(0.5 * alpha).toFixed(3)})`;
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2);
  }

  // ===========================================================================
  // Shimmer Effects
  // ===========================================================================

  private parseShimmerColor(): { r: number; g: number; b: number } {
    const color = this.sheetData.shimmerColor;
    return {
      r: parseInt(color.slice(1, 3), 16),
      g: parseInt(color.slice(3, 5), 16),
      b: parseInt(color.slice(5, 7), 16),
    };
  }

  /**
   * Fade: smooth opacity fade-out from full to zero.
   * Uses ease-out curve for a more natural feel.
   */
  private renderShimmerFade(ctx: CanvasRenderingContext2D, rect: Rect, progress: number): void {
    // Ease-out quadratic for a natural decay
    const eased = 1 - Math.pow(progress, 2);
    const maxOpacity = this.sheetData.shimmerMaxOpacity;
    const alpha = maxOpacity * eased;
    if (alpha <= 0.001) return;

    const { r, g, b } = this.parseShimmerColor();
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

    // Add a subtle border at higher opacity for visibility
    const borderAlpha = Math.min(alpha * 2.5, maxOpacity * 2);
    if (borderAlpha > 0.01) {
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${borderAlpha.toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2);
    }
  }

  /**
   * Sweep: a bright highlight band sweeps left-to-right across the range,
   * like a skeleton loader. Two passes then fade out.
   */
  private renderShimmerSweep(ctx: CanvasRenderingContext2D, rect: Rect, progress: number): void {
    const { r, g, b } = this.parseShimmerColor();
    const maxOpacity = this.sheetData.shimmerMaxOpacity;

    // Background tint that fades out
    const bgAlpha = maxOpacity * 0.6 * (1 - progress);
    if (bgAlpha > 0.001) {
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${bgAlpha.toFixed(3)})`;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }

    // Sweep band — two passes over the duration
    const sweepCycles = 2;
    const sweepProgress = (progress * sweepCycles) % 1;
    const bandWidth = rect.width * 0.3;
    const bandX = rect.x - bandWidth + sweepProgress * (rect.width + bandWidth);

    // Fade sweep intensity as overall progress advances
    const sweepAlpha = maxOpacity * 2 * (1 - progress * 0.7);
    if (sweepAlpha <= 0.001) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();

    const grad = ctx.createLinearGradient(bandX, rect.y, bandX + bandWidth, rect.y);
    grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
    grad.addColorStop(0.3, `rgba(255, 255, 255, ${(sweepAlpha * 0.7).toFixed(3)})`);
    grad.addColorStop(0.5, `rgba(255, 255, 255, ${sweepAlpha.toFixed(3)})`);
    grad.addColorStop(0.7, `rgba(255, 255, 255, ${(sweepAlpha * 0.7).toFixed(3)})`);
    grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

    ctx.restore();

    // Border
    const borderAlpha = maxOpacity * 1.5 * (1 - progress);
    if (borderAlpha > 0.01) {
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${borderAlpha.toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2);
    }
  }

  /**
   * Pulse: sine-wave pulsing overlay that breathes in and out,
   * with overall amplitude decaying to zero.
   */
  private renderShimmerPulse(ctx: CanvasRenderingContext2D, rect: Rect, progress: number): void {
    const { r, g, b } = this.parseShimmerColor();
    const maxOpacity = this.sheetData.shimmerMaxOpacity;

    // 3 full pulse cycles over the duration, with decaying envelope
    const pulseFreq = 3;
    const envelope = 1 - Math.pow(progress, 1.5);
    const pulse = (Math.sin(progress * pulseFreq * Math.PI * 2) + 1) / 2;
    const alpha = maxOpacity * 2 * envelope * (0.3 + 0.7 * pulse);
    if (alpha <= 0.001) return;

    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

    // Pulsing border at higher intensity
    const borderAlpha = Math.min(alpha * 2, 0.8);
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${borderAlpha.toFixed(3)})`;
    ctx.lineWidth = 2 + pulse;
    ctx.strokeRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2);
  }

  /**
   * Border-glow: animated glowing border that intensifies then fades,
   * with a subtle inner fill. The glow "rotates" around the border.
   */
  private renderShimmerBorderGlow(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    progress: number,
  ): void {
    const { r, g, b } = this.parseShimmerColor();
    const maxOpacity = this.sheetData.shimmerMaxOpacity;

    // Envelope: ramp up quickly, sustain, then fade
    let envelope: number;
    if (progress < 0.15) {
      envelope = progress / 0.15; // ramp up
    } else if (progress < 0.5) {
      envelope = 1; // sustain
    } else {
      envelope = 1 - (progress - 0.5) / 0.5; // fade out
    }

    // Very subtle inner fill
    const fillAlpha = maxOpacity * 0.5 * envelope;
    if (fillAlpha > 0.001) {
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${fillAlpha.toFixed(3)})`;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }

    // Multi-layer glow border
    const layers = [
      { width: 6, alphaScale: 0.3 },
      { width: 4, alphaScale: 0.6 },
      { width: 2, alphaScale: 1.0 },
    ];

    for (const layer of layers) {
      const alpha = maxOpacity * 3 * envelope * layer.alphaScale;
      if (alpha <= 0.001) continue;
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${Math.min(alpha, 1).toFixed(3)})`;
      ctx.lineWidth = layer.width;
      const half = layer.width / 2;
      ctx.strokeRect(
        rect.x + half,
        rect.y + half,
        rect.width - layer.width,
        rect.height - layer.width,
      );
    }
  }

  // ===========================================================================
  // Tooltip Helper
  // ===========================================================================

  private renderTooltip(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
    ctx.save();
    ctx.font = this.config.resizeTooltipFont;
    const metrics = ctx.measureText(text);
    const padding = 5;
    const tooltipWidth = metrics.width + padding * 2;
    const tooltipHeight = 20;

    const tooltipX = Math.max(0, x);
    const tooltipY = Math.max(0, y);

    ctx.fillStyle = this.config.resizeTooltipBackground;
    ctx.beginPath();
    ctx.roundRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight, 3);
    ctx.fill();

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = this.config.resizeTooltipTextColor;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, tooltipX + padding, tooltipY + tooltipHeight / 2);
    ctx.restore();
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
      this.dimensions,
    );
  }

  /**
   * Convert a single cell to region-local UNZOOMED rectangle. Composes the
   * canonical helper `cellRectInRegion`.
   */
  private cellToRegionRelative(cell: CellCoord, region: RenderRegion, sheetId: string): Rect {
    return cellRectInRegion(region, cell.row, cell.col, this.dimensions);
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  setConfig(config: Partial<UILayerConfig>): void {
    const changed = Object.keys(config).some(
      (key) => config[key as keyof UILayerConfig] !== this.config[key as keyof UILayerConfig],
    );
    if (changed) {
      this.config = { ...this.config, ...config };
      this.markDirty();
    }
  }

  getConfig(): Required<UILayerConfig> {
    return { ...this.config };
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  override dispose(): void {
    if (this.marchingAnts.isActive) {
      this.marchingAnts.isActive = false;
      this.animationClock.stopContinuousFrames(this.id);
    }
    super.dispose();
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createUILayer(
  selectionData: SelectionDataSource,
  sheetData: SheetDataSource,
  dimensions: ViewportPositionIndex,
  animationClock: AnimationClock,
  config?: UILayerConfig,
): UILayer {
  return new UILayer(selectionData, sheetData, dimensions, animationClock, config);
}
