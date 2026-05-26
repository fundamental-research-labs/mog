/**
 * Remote Cursors Layer
 *
 * Renders collaborator cursor positions with colored selection boxes
 * and name labels for each remote user.
 *
 * renderMode: 'per-region' | canvas: 0 | z-index: 300
 *
 * @module grid-renderer/layers/remote-cursors
 */

import {
  docSpaceRect,
  regionLocalVisibleRect,
  type DirtyHint,
  type DocSpaceRect,
  type FrameContext,
  type Rect as EngineRect,
  type RenderRegion,
} from '@mog/canvas-engine';
import type { CellRange } from '@mog-sdk/contracts/core';
import type {
  CellCoord,
  CollaborationDataSource,
  GridRegionMeta,
  RemoteCursor,
} from '@mog-sdk/contracts/rendering';
import type { ViewportPositionIndex } from '../coordinates/viewport-position-index';
import { cellRectInRegion, rangeRectInRegion } from '../shared/cell-bounds';
import { BaseLayer } from './base-layer';

// =============================================================================
// Configuration
// =============================================================================

export interface RemoteCursorsLayerConfig {
  /** Border width for remote selections */
  borderWidth?: number;
  /** Fill opacity for remote selections */
  fillOpacity?: number;
  /** Label font size in pixels */
  labelFontSize?: number;
  /** Label font family */
  labelFontFamily?: string;
  /** Label padding in pixels */
  labelPadding?: number;
  /** Label border radius in pixels */
  labelBorderRadius?: number;
  /** Show "editing" indicator when user is editing a cell */
  showEditingIndicator?: boolean;
}

const DEFAULT_CONFIG: Required<RemoteCursorsLayerConfig> = {
  borderWidth: 2,
  fillOpacity: 0.1,
  labelFontSize: 11,
  labelFontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
  labelPadding: 4,
  labelBorderRadius: 2,
  showEditingIndicator: true,
};

// =============================================================================
// Helper Types
// =============================================================================

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// =============================================================================
// Remote Cursors Layer
// =============================================================================

export class RemoteCursorsLayer extends BaseLayer {
  private collaboration: CollaborationDataSource;
  private dimensions: ViewportPositionIndex;
  private config: Required<RemoteCursorsLayerConfig>;

  /** Previous cursor snapshot for computing targeted dirty rects on update */
  private previousCursors: ReadonlyArray<RemoteCursor> = [];

  /** Cached avatar images keyed by URL */
  private avatarImageCache = new Map<string, HTMLImageElement>();
  /** Cache of generated default avatar data URIs keyed by "name|color" */
  private defaultAvatarUriCache = new Map<string, string>();

  constructor(
    collaboration: CollaborationDataSource,
    dimensions: ViewportPositionIndex,
    config: RemoteCursorsLayerConfig = {},
  ) {
    super({
      id: 'remote-cursors',
      zIndex: 300,
      renderMode: 'per-region',
      canvas: 0,
      cacheable: false,
    });
    this.collaboration = collaboration;
    this.dimensions = dimensions;
    this.config = { ...DEFAULT_CONFIG, ...config };
    // Snapshot initial cursors so the first setCollaboration() can diff against them
    this.previousCursors = collaboration.getRemoteCursors();
  }

  // ===========================================================================
  // Data Source Updates
  // ===========================================================================

  setCollaboration(collaboration: CollaborationDataSource): void {
    const hint = this.computeCursorDirtyHint(collaboration);
    this.collaboration = collaboration;
    this.markDirty(hint);
  }

  setDimensions(dimensions: ViewportPositionIndex): void {
    this.dimensions = dimensions;
    this.markDirty();
  }

  // ===========================================================================
  // Targeted Dirty Rect Computation
  // ===========================================================================

  /**
   * Compute a targeted dirty hint by comparing previous and new cursor positions.
   * Returns rects covering the old positions (to erase) and new positions (to paint).
   */
  private computeCursorDirtyHint(newCollaboration: CollaborationDataSource): DirtyHint {
    const oldCursors = this.previousCursors;
    const newCursors = newCollaboration.getRemoteCursors();

    // Snapshot for next comparison
    this.previousCursors = newCursors;

    // If no cursors before and after, nothing changed
    if (oldCursors.length === 0 && newCursors.length === 0) {
      return { type: 'full' };
    }

    const rects: DocSpaceRect[] = [];

    // Add dirty rects for all old cursor positions (erase, doc-space from ViewportPositionIndex)
    for (const cursor of oldCursors) {
      this.addCursorBoundsRects(rects, cursor);
    }

    // Add dirty rects for all new cursor positions (paint)
    for (const cursor of newCursors) {
      this.addCursorBoundsRects(rects, cursor);
    }

    if (rects.length === 0) {
      return { type: 'full' };
    }

    return { type: 'rects', bounds: rects };
  }

  /**
   * Add bounding rects for a cursor's visual footprint:
   * - Selection range fill + border
   * - Active cell border
   * - Name label above the active cell
   */
  private addCursorBoundsRects(rects: DocSpaceRect[], cursor: RemoteCursor): void {
    const borderWidth = this.config.borderWidth;
    const labelHeight = this.config.labelFontSize + this.config.labelPadding * 2;

    // Selection ranges (doc-space from ViewportPositionIndex)
    for (const range of cursor.selection) {
      const rect = this.rangeToAbsoluteRect(range);
      rects.push(
        docSpaceRect(
          rect.x - borderWidth,
          rect.y - borderWidth,
          rect.width + borderWidth * 2,
          rect.height + borderWidth * 2,
        ),
      );
    }

    // Active cell + name label
    const labelCell =
      cursor.isEditing && cursor.editingCell ? cursor.editingCell : cursor.activeCell;
    const cellRect = this.cellToAbsoluteRect(labelCell);

    // The label sits above the cell; we need to include it in the dirty rect.
    // Extend upward by label height + gap (2px).
    const labelGap = 2;
    // Generous width estimate for the label (name + possible " (editing)" suffix).
    // Use a reasonable max since we can't measure text here.
    const labelWidthEstimate = 200;

    rects.push(
      docSpaceRect(
        cellRect.x - borderWidth,
        cellRect.y - labelHeight - labelGap - borderWidth,
        Math.max(cellRect.width, labelWidthEstimate) + borderWidth * 2,
        cellRect.height + labelHeight + labelGap + borderWidth * 2,
      ),
    );
  }

  /**
   * Convert a range to absolute pixel rect (no scroll offset).
   */
  private rangeToAbsoluteRect(range: CellRange): Rect {
    const x1 = this.dimensions.getColLeft(range.startCol);
    const y1 = this.dimensions.getRowTop(range.startRow);
    const x2 = this.dimensions.getColLeft(range.endCol) + this.dimensions.getColWidth(range.endCol);
    const y2 = this.dimensions.getRowTop(range.endRow) + this.dimensions.getRowHeight(range.endRow);
    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    };
  }

  /**
   * Convert a cell to absolute pixel rect (no scroll offset).
   */
  private cellToAbsoluteRect(cell: CellCoord): Rect {
    return {
      x: this.dimensions.getColLeft(cell.col),
      y: this.dimensions.getRowTop(cell.row),
      width: this.dimensions.getColWidth(cell.col),
      height: this.dimensions.getRowHeight(cell.row),
    };
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
    const cursors = this.collaboration.getRemoteCursors();

    const visibleCursors = cursors.filter((c) => c.sheetId === sheetId);
    if (visibleCursors.length === 0) return;

    const visible = regionLocalVisibleRect(region);
    const visibleWidth = visible.width;
    const visibleHeight = visible.height;

    for (const cursor of visibleCursors) {
      this.renderCursor(ctx, cursor, region, visibleWidth, visibleHeight, sheetId);
    }
  }

  // ===========================================================================
  // Region Cell-Range Clipping
  // ===========================================================================

  /**
   * Intersect a selection range with the region's visible cell range.
   * Returns null if no overlap.
   */
  private intersectWithRegion(range: CellRange, regionCellRange: CellRange): CellRange | null {
    const startRow = Math.max(range.startRow, regionCellRange.startRow);
    const endRow = Math.min(range.endRow, regionCellRange.endRow);
    const startCol = Math.max(range.startCol, regionCellRange.startCol);
    const endCol = Math.min(range.endCol, regionCellRange.endCol);

    if (startRow > endRow || startCol > endCol) return null;
    return { startRow, endRow, startCol, endCol };
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
  // Cursor Rendering
  // ===========================================================================

  private renderCursor(
    ctx: CanvasRenderingContext2D,
    cursor: RemoteCursor,
    region: RenderRegion<GridRegionMeta>,
    visibleWidth: number,
    visibleHeight: number,
    sheetId: string,
  ): void {
    const { user, selection, activeCell, isEditing, editingCell } = cursor;
    const regionCellRange = region.metadata.cellRange;

    // Render selection ranges — clipped to this region's cell range
    for (const range of selection) {
      const clipped = this.intersectWithRegion(range, regionCellRange);
      if (!clipped) continue;
      this.renderRemoteSelection(
        ctx,
        clipped,
        user.color,
        region,
        visibleWidth,
        visibleHeight,
        sheetId,
      );
    }

    // Render active cell with label — only in the region containing the active cell
    const labelCell = isEditing && editingCell ? editingCell : activeCell;
    if (!this.isCellInRegion(labelCell, regionCellRange)) return;

    const cellRect = this.cellToRegionRelative(labelCell, region, sheetId);

    // Skip if outside visible area
    if (
      cellRect.x + cellRect.width < 0 ||
      cellRect.x > visibleWidth ||
      cellRect.y + cellRect.height < 0 ||
      cellRect.y > visibleHeight
    ) {
      return;
    }

    // Active cell border
    this.renderActiveCellBorder(ctx, cellRect, user.color);

    // Name label with avatar
    this.renderNameLabel(ctx, cellRect, user, isEditing);
  }

  private cellToRegionRelative(
    cell: CellCoord,
    region: RenderRegion<GridRegionMeta>,
    sheetId: string,
  ): Rect {
    const rect = cellRectInRegion(region, cell.row, cell.col, this.dimensions);
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
  }

  private rangeToRegionRelative(
    range: CellRange,
    region: RenderRegion<GridRegionMeta>,
    sheetId: string,
  ): Rect {
    const rect = rangeRectInRegion(
      region,
      range.startRow,
      range.startCol,
      range.endRow,
      range.endCol,
      this.dimensions,
    );
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
  }

  private renderRemoteSelection(
    ctx: CanvasRenderingContext2D,
    range: CellRange,
    color: string,
    region: RenderRegion<GridRegionMeta>,
    visibleWidth: number,
    visibleHeight: number,
    sheetId: string,
  ): void {
    const rect = this.rangeToRegionRelative(range, region, sheetId);

    if (
      rect.x + rect.width < 0 ||
      rect.x > visibleWidth ||
      rect.y + rect.height < 0 ||
      rect.y > visibleHeight
    ) {
      return;
    }

    // Fill with reduced opacity
    ctx.globalAlpha = this.config.fillOpacity;
    ctx.fillStyle = color;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.globalAlpha = 1;

    // Border
    ctx.strokeStyle = color;
    ctx.lineWidth = this.config.borderWidth;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
  }

  private renderActiveCellBorder(ctx: CanvasRenderingContext2D, rect: Rect, color: string): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = this.config.borderWidth;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
  }

  private renderNameLabel(
    ctx: CanvasRenderingContext2D,
    cellRect: Rect,
    user: RemoteCursor['user'],
    isEditing: boolean,
  ): void {
    const padding = this.config.labelPadding;
    const fontSize = this.config.labelFontSize;
    const borderRadius = this.config.labelBorderRadius;

    const displayText =
      isEditing && this.config.showEditingIndicator ? `${user.name} (editing)` : user.name;

    ctx.font = `${fontSize}px ${this.config.labelFontFamily}`;
    const textWidth = ctx.measureText(displayText).width;
    const textHeight = fontSize;

    const avatarSize = textHeight + 2; // Slightly larger than text
    const avatarGap = 4;

    const labelWidth = padding + avatarSize + avatarGap + textWidth + padding;
    const labelHeight = textHeight + padding * 2;
    const labelX = cellRect.x;
    const labelY = cellRect.y - labelHeight - 2;

    // Background pill
    ctx.fillStyle = user.color;
    this.roundRect(ctx, labelX, labelY, labelWidth, labelHeight, borderRadius);
    ctx.fill();

    // Avatar circle
    const avatarCenterX = labelX + padding + avatarSize / 2;
    const avatarCenterY = labelY + labelHeight / 2;
    const avatarRadius = avatarSize / 2;

    const avatarUrl = user.avatar || this.getDefaultAvatarDataUri(user.name, user.color);
    const img = this.getOrLoadImage(avatarUrl);

    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarCenterX, avatarCenterY, avatarRadius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(
        img,
        avatarCenterX - avatarRadius,
        avatarCenterY - avatarRadius,
        avatarSize,
        avatarSize,
      );
    } else {
      // Fallback: darker circle with initial while image loads
      ctx.fillStyle = this.adjustColor(user.color, -30);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `600 ${avatarSize * 0.6}px ${this.config.labelFontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(user.name.charAt(0).toUpperCase(), avatarCenterX, avatarCenterY);
    }
    ctx.restore();

    // Name text
    ctx.font = `${fontSize}px ${this.config.labelFontFamily}`;
    ctx.fillStyle = this.getContrastColor(user.color);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(displayText, labelX + padding + avatarSize + avatarGap, labelY + labelHeight / 2);
  }

  // ===========================================================================
  // Avatar Image Loading
  // ===========================================================================

  private getOrLoadImage(url: string): HTMLImageElement | null {
    const cached = this.avatarImageCache.get(url);
    if (cached) return cached;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    this.avatarImageCache.set(url, img);
    img.onload = () => this.markDirty();
    img.onerror = () => {
      // Remove failed entry so fallback renders
      this.avatarImageCache.delete(url);
    };
    img.src = url;
    return null;
  }

  private getDefaultAvatarDataUri(name: string, color: string): string {
    const key = `${name}|${color}`;
    const cached = this.defaultAvatarUriCache.get(key);
    if (cached) return cached;

    const initial = (name.charAt(0) || '?').toUpperCase();
    const lighter = this.adjustColor(color, 30);
    const darker = this.adjustColor(color, -40);

    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">',
      '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">',
      `<stop offset="0%" stop-color="${lighter}"/>`,
      `<stop offset="100%" stop-color="${darker}"/>`,
      '</linearGradient></defs>',
      '<circle cx="16" cy="16" r="16" fill="url(#bg)"/>',
      '<circle cx="16" cy="16" r="15" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>',
      `<text x="16" y="16" text-anchor="middle" dy="0.36em" fill="white" font-size="14" font-family="Inter,-apple-system,BlinkMacSystemFont,sans-serif" font-weight="600">${initial}</text>`,
      '</svg>',
    ].join('');

    const uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    this.defaultAvatarUriCache.set(key, uri);
    return uri;
  }

  private adjustColor(hex: string, amount: number): string {
    const clean = hex.replace('#', '');
    const r = Math.max(0, Math.min(255, parseInt(clean.substring(0, 2), 16) + amount));
    const g = Math.max(0, Math.min(255, parseInt(clean.substring(2, 4), 16) + amount));
    const b = Math.max(0, Math.min(255, parseInt(clean.substring(4, 6), 16) + amount));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  // ===========================================================================
  // Drawing Helpers
  // ===========================================================================

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ): void {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
  }

  private getContrastColor(backgroundColor: string): string {
    const hex = backgroundColor.replace('#', '');
    if (hex.length < 6) return '#ffffff';
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? '#000000' : '#ffffff';
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  setConfig(config: Partial<RemoteCursorsLayerConfig>): void {
    this.config = { ...this.config, ...config };
    this.markDirty();
  }

  getConfig(): Required<RemoteCursorsLayerConfig> {
    return { ...this.config };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createRemoteCursorsLayer(
  collaboration: CollaborationDataSource,
  dimensions: ViewportPositionIndex,
  config?: RemoteCursorsLayerConfig,
): RemoteCursorsLayer {
  return new RemoteCursorsLayer(collaboration, dimensions, config);
}
