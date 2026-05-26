/**
 * TimelineCanvas Component
 *
 * Canvas-based rendering for timeline bars and grid.
 * Handles high-performance rendering with device pixel ratio support.
 */

import type { RowId } from '@mog-sdk/contracts/cell-identity';
import React, { useCallback, useEffect, useRef } from 'react';
import type { TimelineScale } from '../config';
import { renderGridLines, renderRowSeparators } from '../renderer/axis-renderer';
import { renderBars, renderResizeHandles } from '../renderer/bar-renderer';
import type { TimelineBar, TimelineGroup } from '../utils/bar-positioning';
import type { AxisLabel } from '../utils/date-utils';
/**
 * Props for TimelineCanvas component.
 */
export interface TimelineCanvasProps {
  /** Calculated bar positions */
  bars: TimelineBar[];
  /** Group headers */
  groups: TimelineGroup[];
  /** Axis labels for grid lines */
  axisLabels: AxisLabel[];
  /** Canvas width in CSS pixels */
  width: number;
  /** Canvas height in CSS pixels */
  height: number;
  /** Horizontal scroll offset */
  scrollLeft: number;
  /** Vertical scroll offset */
  scrollTop: number;
  /** Current time scale */
  scale: TimelineScale;
  /** Selected bar IDs */
  selectedBars: Set<RowId>;
  /** Focused bar ID */
  focusedBar: RowId | null;
  /** Whether to show bar labels */
  showLabels?: boolean;
  /** Whether to shade weekends */
  showWeekends?: boolean;
  /** Row height for separator lines */
  rowHeight?: number;
  /** Callback when canvas is clicked */
  onClick?: (x: number, y: number, event: React.MouseEvent) => void;
  /** Callback when mouse moves */
  onMouseMove?: (x: number, y: number, event: React.MouseEvent) => void;
  /** Callback when mouse leaves */
  onMouseLeave?: () => void;
}

/**
 * Canvas component for rendering timeline content.
 */
export function TimelineCanvas({
  bars,
  groups,
  axisLabels,
  width,
  height,
  scrollLeft,
  scrollTop,
  scale,
  selectedBars,
  focusedBar,
  showLabels = true,
  showWeekends = true,
  rowHeight = 40,
  onClick,
  onMouseMove,
  onMouseLeave,
}: TimelineCanvasProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const devicePixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  // Render canvas content
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Apply scroll offset
    ctx.save();
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.translate(-scrollLeft, -scrollTop);

    // Calculate visible area
    const visibleMinX = scrollLeft;
    const visibleMaxX = scrollLeft + width;
    const visibleMinY = scrollTop;
    const visibleMaxY = scrollTop + height;

    // Render grid lines
    const visibleLabels = axisLabels.filter(
      (label) => label.x + label.width >= visibleMinX && label.x <= visibleMaxX,
    );
    renderGridLines(ctx, visibleLabels, bars.length * rowHeight + groups.length * 32, {
      showWeekends,
      scale,
    });

    // Render row separators
    const totalRows = bars.length + groups.length;
    renderRowSeparators(ctx, totalRows, rowHeight, visibleMaxX);

    // Filter visible bars
    const visibleBars = bars.filter((bar) => {
      const barRight = bar.isMilestone ? bar.x + bar.height : bar.x + bar.width;
      const barBottom = bar.y + bar.height;
      return (
        barRight >= visibleMinX &&
        bar.x <= visibleMaxX &&
        barBottom >= visibleMinY &&
        bar.y <= visibleMaxY
      );
    });

    // Render bars
    renderBars(ctx, visibleBars, {
      selectedBars,
      focusedBar,
      showLabels,
    });

    // Render resize handles for selected bars
    if (selectedBars.size > 0) {
      renderResizeHandles(ctx, visibleBars, selectedBars);
    }

    ctx.restore();
  }, [
    bars,
    groups,
    axisLabels,
    width,
    height,
    scrollLeft,
    scrollTop,
    scale,
    selectedBars,
    focusedBar,
    showLabels,
    showWeekends,
    rowHeight,
    devicePixelRatio,
  ]);

  // Re-render on changes
  useEffect(() => {
    render();
  }, [render]);

  // Handle canvas click
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (!onClick) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left + scrollLeft;
      const y = event.clientY - rect.top + scrollTop;

      onClick(x, y, event);
    },
    [onClick, scrollLeft, scrollTop],
  );

  // Handle mouse move
  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (!onMouseMove) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left + scrollLeft;
      const y = event.clientY - rect.top + scrollTop;

      onMouseMove(x, y, event);
    },
    [onMouseMove, scrollLeft, scrollTop],
  );

  return (
    <canvas
      ref={canvasRef}
      width={width * devicePixelRatio}
      height={height * devicePixelRatio}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        display: 'block',
      }}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={onMouseLeave}
    />
  );
}
