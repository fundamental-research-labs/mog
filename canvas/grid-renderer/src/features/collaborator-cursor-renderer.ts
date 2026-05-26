/**
 * Collaborator Cursor Renderer
 *
 * Renders remote collaborators' cursors and selections on the canvas:
 * - Active cell with colored border (user's color)
 * - Selection ranges with semi-transparent fill
 * - Name labels above cursors
 *
 * @module canvas/collaborator-cursor-renderer
 */

import { hexToRgba } from '@mog/canvas-engine';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type { HeaderVisibility } from '@mog-sdk/contracts/rendering';
import { getEffectiveHeaderDimensions } from '../shared/constants';
import type { DimensionGetter, ViewportInfo } from '../viewports/viewport';

// =============================================================================
// Types
// =============================================================================

export interface CollaboratorCursorData {
  clientId: number;
  user: {
    id: string;
    name: string;
    color: string;
    avatar?: string;
  };
  cursor?: {
    sheetId: SheetId;
    row: number;
    col: number;
  };
  selection?: {
    sheetId: SheetId;
    ranges: CellRange[];
  };
}

export interface CollaboratorRenderContext {
  ctx: CanvasRenderingContext2D;
  sheetId: SheetId;
  viewport: ViewportInfo;
  dimensions: DimensionGetter;
  devicePixelRatio: number;
  /** Optional header visibility settings (defaults to both visible) */
  headerVisibility?: HeaderVisibility;
}

// =============================================================================
// Constants
// =============================================================================

const CURSOR_BORDER_WIDTH = 2;
const SELECTION_FILL_OPACITY = 0.1;
const NAME_LABEL_PADDING = 4;
const NAME_LABEL_FONT_SIZE = 11;
const NAME_LABEL_FONT = `${NAME_LABEL_FONT_SIZE}px Arial, sans-serif`;
const NAME_LABEL_HEIGHT = NAME_LABEL_FONT_SIZE + NAME_LABEL_PADDING * 2;
const NAME_LABEL_BORDER_RADIUS = 2;

// =============================================================================
// Main Render Function
// =============================================================================

/**
 * Render all collaborator cursors and selections.
 */
export function renderCollaboratorCursors(
  context: CollaboratorRenderContext,
  collaborators: CollaboratorCursorData[],
): void {
  const { ctx, sheetId, viewport, dimensions, devicePixelRatio, headerVisibility } = context;

  // Get effective header dimensions based on visibility
  const { rowHeaderWidth, colHeaderHeight } = getEffectiveHeaderDimensions(headerVisibility);

  // Filter to collaborators on the same sheet
  const visibleCollaborators = collaborators.filter(
    (c) => c.cursor?.sheetId === sheetId || c.selection?.sheetId === sheetId,
  );

  if (visibleCollaborators.length === 0) return;

  // Clip to grid area
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    rowHeaderWidth,
    colHeaderHeight,
    ctx.canvas.width / devicePixelRatio - rowHeaderWidth,
    ctx.canvas.height / devicePixelRatio - colHeaderHeight,
  );
  ctx.clip();

  // Render each collaborator
  for (const collaborator of visibleCollaborators) {
    // Draw selection ranges first (behind cursor)
    if (collaborator.selection?.sheetId === sheetId) {
      for (const range of collaborator.selection.ranges) {
        drawCollaboratorRangeFill(
          ctx,
          range,
          collaborator.user.color,
          viewport,
          dimensions,
          sheetId,
          headerVisibility,
        );
        drawCollaboratorRangeBorder(
          ctx,
          range,
          collaborator.user.color,
          viewport,
          dimensions,
          sheetId,
          headerVisibility,
        );
      }
    }

    // Draw cursor (active cell)
    if (collaborator.cursor?.sheetId === sheetId) {
      drawCollaboratorCursor(
        ctx,
        collaborator.cursor.row,
        collaborator.cursor.col,
        collaborator.user.color,
        viewport,
        dimensions,
        sheetId,
        headerVisibility,
      );

      // Draw name label
      drawCollaboratorNameLabel(
        ctx,
        collaborator.cursor.row,
        collaborator.cursor.col,
        collaborator.user.name,
        collaborator.user.color,
        viewport,
        dimensions,
        sheetId,
        headerVisibility,
      );
    }
  }

  ctx.restore();
}

// =============================================================================
// Selection Range Fill
// =============================================================================

function drawCollaboratorRangeFill(
  ctx: CanvasRenderingContext2D,
  range: CellRange,
  color: string,
  viewport: ViewportInfo,
  dimensions: DimensionGetter,
  sheetId: SheetId,
  headerVisibility?: HeaderVisibility,
): void {
  const rect = getRangeRect(range, sheetId, viewport, dimensions, headerVisibility);
  if (!rect) return;

  // Semi-transparent fill
  ctx.fillStyle = hexToRgba(color, SELECTION_FILL_OPACITY);
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
}

// =============================================================================
// Selection Range Border
// =============================================================================

function drawCollaboratorRangeBorder(
  ctx: CanvasRenderingContext2D,
  range: CellRange,
  color: string,
  viewport: ViewportInfo,
  dimensions: DimensionGetter,
  sheetId: SheetId,
  headerVisibility?: HeaderVisibility,
): void {
  const rect = getRangeRect(range, sheetId, viewport, dimensions, headerVisibility);
  if (!rect) return;

  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
}

// =============================================================================
// Cursor (Active Cell)
// =============================================================================

function drawCollaboratorCursor(
  ctx: CanvasRenderingContext2D,
  row: number,
  col: number,
  color: string,
  viewport: ViewportInfo,
  dimensions: DimensionGetter,
  sheetId: SheetId,
  headerVisibility?: HeaderVisibility,
): void {
  const rect = getCellRect(row, col, sheetId, viewport, dimensions, headerVisibility);
  if (!rect) return;

  // Draw thick colored border
  ctx.strokeStyle = color;
  ctx.lineWidth = CURSOR_BORDER_WIDTH;
  ctx.strokeRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2);
}

// =============================================================================
// Name Label
// =============================================================================

function drawCollaboratorNameLabel(
  ctx: CanvasRenderingContext2D,
  row: number,
  col: number,
  name: string,
  color: string,
  viewport: ViewportInfo,
  dimensions: DimensionGetter,
  sheetId: SheetId,
  headerVisibility?: HeaderVisibility,
): void {
  const rect = getCellRect(row, col, sheetId, viewport, dimensions, headerVisibility);
  if (!rect) return;

  // Get effective header dimensions based on visibility
  const { rowHeaderWidth, colHeaderHeight } = getEffectiveHeaderDimensions(headerVisibility);

  ctx.font = NAME_LABEL_FONT;
  const textWidth = ctx.measureText(name).width;
  const labelWidth = textWidth + NAME_LABEL_PADDING * 2;

  // Position label above the cell, aligned to left edge
  let labelX = rect.x;
  let labelY = rect.y - NAME_LABEL_HEIGHT;

  // If label would be above the visible area, position it below the cell
  if (labelY < colHeaderHeight) {
    labelY = rect.y + rect.height;
  }

  // If label would be outside the right edge, align to right
  const canvasWidth = ctx.canvas.width / (window.devicePixelRatio ?? 1);
  if (labelX + labelWidth > canvasWidth) {
    labelX = canvasWidth - labelWidth;
  }

  // Ensure label doesn't go past left edge
  if (labelX < rowHeaderWidth) {
    labelX = rowHeaderWidth;
  }

  // Draw label background with rounded corners
  ctx.fillStyle = color;
  drawRoundedRect(ctx, labelX, labelY, labelWidth, NAME_LABEL_HEIGHT, NAME_LABEL_BORDER_RADIUS);
  ctx.fill();

  // Draw name text
  ctx.fillStyle = getContrastColor(color);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, labelX + NAME_LABEL_PADDING, labelY + NAME_LABEL_HEIGHT / 2);
}

// =============================================================================
// Geometry Helpers
// =============================================================================

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function getCellRect(
  row: number,
  col: number,
  sheetId: SheetId,
  viewport: ViewportInfo,
  dimensions: DimensionGetter,
  headerVisibility?: HeaderVisibility,
): Rect | null {
  const { startRow, startCol, offsetX, offsetY } = viewport;

  // Get effective header dimensions based on visibility
  const { rowHeaderWidth, colHeaderHeight } = getEffectiveHeaderDimensions(headerVisibility);

  // Calculate y position
  let y = colHeaderHeight + offsetY;
  for (let r = startRow; r < row; r++) {
    y += dimensions.getRowHeight(sheetId, r);
  }

  // Calculate x position
  let x = rowHeaderWidth + offsetX;
  for (let c = startCol; c < col; c++) {
    x += dimensions.getColWidth(sheetId, c);
  }

  const width = dimensions.getColWidth(sheetId, col);
  const height = dimensions.getRowHeight(sheetId, row);

  // Check if cell is in visible area
  if (x + width < rowHeaderWidth || y + height < colHeaderHeight) {
    return null;
  }

  return { x, y, width, height };
}

function getRangeRect(
  range: CellRange,
  sheetId: SheetId,
  viewport: ViewportInfo,
  dimensions: DimensionGetter,
  headerVisibility?: HeaderVisibility,
): Rect | null {
  const {
    startRow: vpStartRow,
    startCol: vpStartCol,
    endRow: vpEndRow,
    endCol: vpEndCol,
    offsetX,
    offsetY,
  } = viewport;

  // Get effective header dimensions based on visibility
  const { rowHeaderWidth, colHeaderHeight } = getEffectiveHeaderDimensions(headerVisibility);

  // PERFORMANCE FIX: For full row/column selections, clip to viewport bounds
  // instead of iterating all 16K columns or 1M rows
  const effectiveStartCol = range.isFullRow ? Math.max(range.startCol, vpStartCol) : range.startCol;
  const effectiveEndCol = range.isFullRow ? Math.min(range.endCol, vpEndCol) : range.endCol;
  const effectiveStartRow = range.isFullColumn
    ? Math.max(range.startRow, vpStartRow)
    : range.startRow;
  const effectiveEndRow = range.isFullColumn ? Math.min(range.endRow, vpEndRow) : range.endRow;

  // Calculate top-left position
  let y = colHeaderHeight + offsetY;
  for (let r = vpStartRow; r < effectiveStartRow; r++) {
    y += dimensions.getRowHeight(sheetId, r);
  }

  let x = rowHeaderWidth + offsetX;
  for (let c = vpStartCol; c < effectiveStartCol; c++) {
    x += dimensions.getColWidth(sheetId, c);
  }

  // Calculate dimensions (only iterate within effective/visible bounds)
  let width = 0;
  for (let c = effectiveStartCol; c <= effectiveEndCol; c++) {
    width += dimensions.getColWidth(sheetId, c);
  }

  let height = 0;
  for (let r = effectiveStartRow; r <= effectiveEndRow; r++) {
    height += dimensions.getRowHeight(sheetId, r);
  }

  // Check if range is in visible area
  if (x + width < rowHeaderWidth || y + height < colHeaderHeight) {
    return null;
  }

  return { x, y, width, height };
}

// =============================================================================
// Drawing Helpers
// =============================================================================

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

// =============================================================================
// Color Helpers (hexToRgba imported from @mog/canvas-engine)
// =============================================================================

/**
 * Get contrasting text color (black or white) for a background color.
 */
function getContrastColor(hexColor: string): string {
  const cleanHex = hexColor.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);

  // Calculate relative luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  return luminance > 0.5 ? '#000000' : '#ffffff';
}
