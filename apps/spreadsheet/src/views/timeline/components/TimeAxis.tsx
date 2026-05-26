/**
 * TimeAxis Component
 *
 * Renders the time axis header showing dates, weeks, months, etc.
 * Uses canvas for performance.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import type { TimelineScale } from '../config';
import { renderAxis } from '../renderer/axis-renderer';
import type { AxisLabel } from '../utils/date-utils';

/**
 * Props for TimeAxis component.
 */
export interface TimeAxisProps {
  /** Axis labels to render */
  labels: AxisLabel[];
  /** Width in CSS pixels */
  width: number;
  /** Height in CSS pixels */
  height?: number;
  /** Horizontal scroll offset */
  scrollLeft: number;
  /** Current time scale */
  scale: TimelineScale;
  /** Timeline start date */
  timelineStart: Date;
  /** Whether to show today marker */
  showTodayMarker?: boolean;
  /** Whether to shade weekends */
  showWeekends?: boolean;
}

/**
 * Time axis header component.
 */
export function TimeAxis({
  labels,
  width,
  height = 48,
  scrollLeft,
  scale,
  timelineStart,
  showTodayMarker = true,
  showWeekends = true,
}: TimeAxisProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const devicePixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  // Render axis
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Apply scroll offset
    ctx.save();
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.translate(-scrollLeft, 0);

    // Filter visible labels
    const visibleLabels = labels.filter((label) => {
      return label.x + label.width >= scrollLeft && label.x <= scrollLeft + width;
    });

    // Render axis
    renderAxis(ctx, visibleLabels, {
      height,
      showTodayMarker,
      showWeekends,
      scale,
      devicePixelRatio,
      timelineStart,
      pixelsPerUnit: 40, // TODO: Get from scale config
    });

    ctx.restore();
  }, [
    labels,
    width,
    height,
    scrollLeft,
    scale,
    timelineStart,
    showTodayMarker,
    showWeekends,
    devicePixelRatio,
  ]);

  // Re-render on changes
  useEffect(() => {
    render();
  }, [render]);

  return (
    <div
      className="timeline-axis overflow-hidden flex-shrink-0 border-b border-ss-border bg-ss-surface-tertiary"
      style={{
        width: `${width}px`,
        height: `${height}px`,
      }}
    >
      <canvas
        ref={canvasRef}
        width={width * devicePixelRatio}
        height={height * devicePixelRatio}
        style={{
          width: `${width}px`,
          height: `${height}px`,
          display: 'block',
        }}
      />
    </div>
  );
}
