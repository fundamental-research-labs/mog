/**
 * Axis Renderer for Timeline View
 *
 * Canvas-based rendering for the time axis header.
 * Handles drawing date labels, grid lines, today marker, and weekends.
 */

import type { TimelineScale } from '../config';
import { type AxisLabel, isWeekend } from '../utils/date-utils';

/**
 * Render options for the time axis.
 */
export interface AxisRenderOptions {
  /** Axis height in pixels */
  height: number;
  /** Whether to show today marker */
  showTodayMarker?: boolean;
  /** Whether to shade weekends */
  showWeekends?: boolean;
  /** Current time scale */
  scale: TimelineScale;
  /** Device pixel ratio for crisp rendering */
  devicePixelRatio?: number;
  /** Timeline start date for calculating today marker position */
  timelineStart?: Date;
  /** Pixels per unit for today marker positioning */
  pixelsPerUnit?: number;
}

/**
 * Color constants for axis rendering.
 */
const COLORS = {
  background: '#F5F5F5',
  border: '#E0E0E0',
  text: {
    primary: '#333333',
    secondary: '#666666',
    minor: '#999999',
  },
  grid: {
    major: '#E0E0E0',
    minor: '#F0F0F0',
  },
  today: {
    line: '#FF4444',
    marker: '#FF4444',
  },
  weekend: {
    fill: 'rgba(0, 0, 0, 0.03)',
  },
};

/**
 * Render the time axis header.
 */
export function renderAxis(
  ctx: CanvasRenderingContext2D,
  labels: AxisLabel[],
  options: AxisRenderOptions,
): void {
  const {
    height,
    showTodayMarker = true,
    showWeekends = true,
    scale,
    devicePixelRatio = 1,
    timelineStart,
    pixelsPerUnit = 40,
  } = options;

  ctx.save();

  // Scale for device pixel ratio
  if (devicePixelRatio !== 1) {
    ctx.scale(devicePixelRatio, devicePixelRatio);
  }

  // Draw background
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, ctx.canvas.width / devicePixelRatio, height);

  // Draw bottom border
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, height - 0.5);
  ctx.lineTo(ctx.canvas.width / devicePixelRatio, height - 0.5);
  ctx.stroke();

  // Draw weekend shading (for day scale)
  if (showWeekends && scale === 'day') {
    ctx.fillStyle = COLORS.weekend.fill;
    for (const label of labels) {
      if (isWeekend(label.date)) {
        ctx.fillRect(label.x, 0, label.width, height);
      }
    }
  }

  // Draw labels
  for (const label of labels) {
    drawAxisLabel(ctx, label, height, scale);
  }

  // Draw today marker
  if (showTodayMarker && timelineStart) {
    const today = new Date();
    const daysSinceStart = (today.getTime() - timelineStart.getTime()) / (24 * 60 * 60 * 1000);
    const todayX = daysSinceStart * pixelsPerUnit;

    if (todayX >= 0 && todayX <= ctx.canvas.width / devicePixelRatio) {
      drawTodayMarker(ctx, todayX, height);
    }
  }

  ctx.restore();
}

/**
 * Draw a single axis label.
 */
function drawAxisLabel(
  ctx: CanvasRenderingContext2D,
  label: AxisLabel,
  height: number,
  scale: TimelineScale,
): void {
  const { x, width, isMinor, date } = label;
  const labelText = label.label;

  // Draw vertical grid line
  ctx.strokeStyle = isMinor ? COLORS.grid.minor : COLORS.grid.major;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 0.5, 0);
  ctx.lineTo(x + 0.5, height);
  ctx.stroke();

  // Choose font and color based on importance
  if (isMinor) {
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = COLORS.text.minor;
  } else {
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = COLORS.text.primary;
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Position label
  const labelX = x + width / 2;
  const labelY = height / 2;

  // Draw label
  ctx.fillText(labelText, labelX, labelY);

  // Draw secondary label for multi-level headers
  if (shouldShowSecondaryLabel(date, scale)) {
    const secondary = getSecondaryLabel(date, scale);
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = COLORS.text.secondary;
    ctx.fillText(secondary, labelX, labelY + 14);
  }
}

/**
 * Check if a date should show a secondary label (e.g., month name on day 1).
 */
function shouldShowSecondaryLabel(date: Date, scale: TimelineScale): boolean {
  switch (scale) {
    case 'day':
      // Show month on first day of month
      return date.getDate() === 1;
    case 'week':
      // Show month on first week of month
      return date.getDate() <= 7;
    case 'month':
      // Show year on January
      return date.getMonth() === 0;
    case 'quarter':
      // Show year on Q1
      return date.getMonth() === 0;
    case 'year':
      return false;
  }
}

/**
 * Get the secondary label text for a date.
 */
function getSecondaryLabel(date: Date, scale: TimelineScale): string {
  switch (scale) {
    case 'day':
    case 'week':
      return date.toLocaleDateString('en-US', { month: 'short' });
    case 'month':
    case 'quarter':
      return date.getFullYear().toString();
    default:
      return '';
  }
}

/**
 * Draw the today marker line.
 */
function drawTodayMarker(ctx: CanvasRenderingContext2D, x: number, headerHeight: number): void {
  // Draw marker in header
  const markerSize = 8;

  ctx.fillStyle = COLORS.today.marker;
  ctx.beginPath();
  ctx.moveTo(x, headerHeight - markerSize);
  ctx.lineTo(x - markerSize / 2, headerHeight);
  ctx.lineTo(x + markerSize / 2, headerHeight);
  ctx.closePath();
  ctx.fill();

  // Draw vertical line extending down
  ctx.strokeStyle = COLORS.today.line;
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(x, headerHeight);
  ctx.lineTo(x, ctx.canvas.height);
  ctx.stroke();
  ctx.setLineDash([]);
}

/**
 * Render grid lines in the content area.
 */
export function renderGridLines(
  ctx: CanvasRenderingContext2D,
  labels: AxisLabel[],
  contentHeight: number,
  options: { showWeekends?: boolean; scale: TimelineScale },
): void {
  const { showWeekends = true, scale } = options;

  ctx.save();

  // Draw weekend shading
  if (showWeekends && scale === 'day') {
    ctx.fillStyle = COLORS.weekend.fill;
    for (const label of labels) {
      if (isWeekend(label.date)) {
        ctx.fillRect(label.x, 0, label.width, contentHeight);
      }
    }
  }

  // Draw vertical grid lines
  ctx.strokeStyle = COLORS.grid.minor;
  ctx.lineWidth = 1;

  for (const label of labels) {
    ctx.beginPath();
    ctx.moveTo(label.x + 0.5, 0);
    ctx.lineTo(label.x + 0.5, contentHeight);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Render horizontal row separators.
 */
export function renderRowSeparators(
  ctx: CanvasRenderingContext2D,
  rowCount: number,
  rowHeight: number,
  width: number,
): void {
  ctx.save();

  ctx.strokeStyle = COLORS.grid.minor;
  ctx.lineWidth = 1;

  for (let i = 1; i <= rowCount; i++) {
    const y = i * rowHeight;
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
    ctx.stroke();
  }

  ctx.restore();
}
