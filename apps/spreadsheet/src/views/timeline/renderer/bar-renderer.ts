/**
 * Bar Renderer for Timeline View
 *
 * Canvas-based rendering for timeline bars (tasks, events, etc.).
 * Handles drawing bars, milestones, selection highlights, and labels.
 */

import type { RowId } from '@mog-sdk/contracts/cell-identity';
import type { TimelineBar } from '../utils/bar-positioning';

/**
 * Render options for bars.
 */
export interface BarRenderOptions {
  /** Selected bar IDs for highlight */
  selectedBars: Set<RowId>;
  /** Focused bar ID for keyboard navigation */
  focusedBar: RowId | null;
  /** Preview state for drag/resize operations */
  preview?: {
    barId: RowId;
    x: number;
    width: number;
  } | null;
  /** Device pixel ratio for crisp rendering */
  devicePixelRatio?: number;
  /** Whether to show bar labels */
  showLabels?: boolean;
}

/**
 * Color constants for bar rendering.
 */
const COLORS = {
  selection: {
    stroke: '#0066CC',
    strokeWidth: 2,
  },
  focus: {
    stroke: '#FF6600',
    strokeWidth: 2,
  },
  preview: {
    fill: 'rgba(74, 144, 217, 0.3)',
    stroke: '#4A90D9',
    strokeWidth: 1,
    dashArray: [4, 2],
  },
  milestone: {
    fill: '#FF9800',
  },
  label: {
    color: '#FFFFFF',
    shadowColor: 'rgba(0, 0, 0, 0.5)',
    font: '12px system-ui, sans-serif',
  },
};

/**
 * Render timeline bars to a canvas.
 */
export function renderBars(
  ctx: CanvasRenderingContext2D,
  bars: TimelineBar[],
  options: BarRenderOptions,
): void {
  const { selectedBars, focusedBar, preview, devicePixelRatio = 1, showLabels = true } = options;

  ctx.save();

  // Scale for device pixel ratio
  if (devicePixelRatio !== 1) {
    ctx.scale(devicePixelRatio, devicePixelRatio);
  }

  // Render bars in order: unselected, selected, focused
  const normalBars: TimelineBar[] = [];
  const selectedBarList: TimelineBar[] = [];
  let focusedBarObj: TimelineBar | null = null;

  for (const bar of bars) {
    if (bar.rowId === focusedBar) {
      focusedBarObj = bar;
    } else if (selectedBars.has(bar.rowId)) {
      selectedBarList.push(bar);
    } else {
      normalBars.push(bar);
    }
  }

  // Draw normal bars
  for (const bar of normalBars) {
    drawBar(ctx, bar, false, false, showLabels);
  }

  // Draw selected bars
  for (const bar of selectedBarList) {
    drawBar(ctx, bar, true, false, showLabels);
  }

  // Draw focused bar
  if (focusedBarObj) {
    drawBar(ctx, focusedBarObj, selectedBars.has(focusedBarObj.rowId), true, showLabels);
  }

  // Draw preview (drag/resize ghost)
  if (preview) {
    drawPreview(ctx, preview);
  }

  ctx.restore();
}

/**
 * Draw a single bar.
 */
function drawBar(
  ctx: CanvasRenderingContext2D,
  bar: TimelineBar,
  isSelected: boolean,
  isFocused: boolean,
  showLabel: boolean,
): void {
  if (bar.isMilestone) {
    drawMilestone(ctx, bar, isSelected, isFocused);
  } else {
    drawRegularBar(ctx, bar, isSelected, isFocused, showLabel);
  }
}

/**
 * Draw a regular bar (rectangle with rounded corners).
 */
function drawRegularBar(
  ctx: CanvasRenderingContext2D,
  bar: TimelineBar,
  isSelected: boolean,
  isFocused: boolean,
  showLabel: boolean,
): void {
  const { x, y, width, height, color, title } = bar;
  const radius = Math.min(4, height / 2);

  // Draw bar background
  ctx.fillStyle = color;
  ctx.beginPath();
  roundRect(ctx, x, y, width, height, radius);
  ctx.fill();

  // Draw selection highlight
  if (isSelected) {
    ctx.strokeStyle = COLORS.selection.stroke;
    ctx.lineWidth = COLORS.selection.strokeWidth;
    ctx.beginPath();
    roundRect(ctx, x - 1, y - 1, width + 2, height + 2, radius + 1);
    ctx.stroke();
  }

  // Draw focus highlight
  if (isFocused) {
    ctx.strokeStyle = COLORS.focus.stroke;
    ctx.lineWidth = COLORS.focus.strokeWidth;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    roundRect(ctx, x - 3, y - 3, width + 6, height + 6, radius + 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Draw label
  if (showLabel && width > 30) {
    drawBarLabel(ctx, title, x, y, width, height);
  }
}

/**
 * Draw a milestone (diamond shape).
 */
function drawMilestone(
  ctx: CanvasRenderingContext2D,
  bar: TimelineBar,
  isSelected: boolean,
  isFocused: boolean,
): void {
  const { x, y, height, color, title } = bar;
  const size = Math.min(height - 4, 16);
  const centerX = x;
  const centerY = y + height / 2;

  // Draw diamond
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(centerX, centerY - size / 2);
  ctx.lineTo(centerX + size / 2, centerY);
  ctx.lineTo(centerX, centerY + size / 2);
  ctx.lineTo(centerX - size / 2, centerY);
  ctx.closePath();
  ctx.fill();

  // Draw selection highlight
  if (isSelected) {
    ctx.strokeStyle = COLORS.selection.stroke;
    ctx.lineWidth = COLORS.selection.strokeWidth;
    ctx.stroke();
  }

  // Draw focus highlight
  if (isFocused) {
    ctx.strokeStyle = COLORS.focus.stroke;
    ctx.lineWidth = COLORS.focus.strokeWidth;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.arc(centerX, centerY, size / 2 + 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Draw label to the right of milestone
  ctx.font = COLORS.label.font;
  ctx.fillStyle = '#333333';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, centerX + size / 2 + 8, centerY);
}

/**
 * Draw a label inside or beside a bar.
 */
function drawBarLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const padding = 8;
  const maxWidth = width - padding * 2;

  ctx.font = COLORS.label.font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  // Truncate text if needed
  let displayText = text;
  let textWidth = ctx.measureText(text).width;

  if (textWidth > maxWidth) {
    while (textWidth > maxWidth && displayText.length > 3) {
      displayText = displayText.slice(0, -4) + '...';
      textWidth = ctx.measureText(displayText).width;
    }
  }

  // Draw text shadow for readability
  ctx.fillStyle = COLORS.label.shadowColor;
  ctx.fillText(displayText, x + padding + 1, y + height / 2 + 1);

  // Draw text
  ctx.fillStyle = COLORS.label.color;
  ctx.fillText(displayText, x + padding, y + height / 2);
}

/**
 * Draw a preview bar (drag/resize ghost).
 */
function drawPreview(
  ctx: CanvasRenderingContext2D,
  preview: { barId: RowId; x: number; width: number },
): void {
  // This would need the full bar info - simplified for now
  ctx.fillStyle = COLORS.preview.fill;
  ctx.strokeStyle = COLORS.preview.stroke;
  ctx.lineWidth = COLORS.preview.strokeWidth;
  ctx.setLineDash(COLORS.preview.dashArray);

  // Draw placeholder rectangle
  ctx.fillRect(preview.x, 0, preview.width, 32);
  ctx.strokeRect(preview.x, 0, preview.width, 32);

  ctx.setLineDash([]);
}

/**
 * Draw a rounded rectangle path.
 */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
}

/**
 * Render resize handles for selected bars.
 */
export function renderResizeHandles(
  ctx: CanvasRenderingContext2D,
  bars: TimelineBar[],
  selectedBars: Set<RowId>,
): void {
  const handleSize = 6;
  const handleColor = '#0066CC';

  ctx.save();
  ctx.fillStyle = handleColor;

  for (const bar of bars) {
    if (!selectedBars.has(bar.rowId) || bar.isMilestone) continue;

    // Left handle (start date)
    ctx.fillRect(
      bar.x - handleSize / 2,
      bar.y + bar.height / 2 - handleSize / 2,
      handleSize,
      handleSize,
    );

    // Right handle (end date)
    ctx.fillRect(
      bar.x + bar.width - handleSize / 2,
      bar.y + bar.height / 2 - handleSize / 2,
      handleSize,
      handleSize,
    );
  }

  ctx.restore();
}
