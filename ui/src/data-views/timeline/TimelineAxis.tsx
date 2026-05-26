/**
 * TimelineAxis Component
 *
 * Renders the time axis header showing dates, weeks, months, etc.
 * Kernel-agnostic component.
 */

import React from 'react';
import type { TimelineAxisLabel, TimelineScale } from './types';
import { dateToPixels, getToday } from './utils';

/**
 * Props for TimelineAxis component.
 */
export interface TimelineAxisProps {
  /** Axis labels to render */
  labels: TimelineAxisLabel[];
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
  /** Optional class name */
  className?: string;
}

/**
 * Time axis header component.
 */
export function TimelineAxis({
  labels,
  width,
  height = 48,
  scrollLeft,
  scale,
  timelineStart,
  showTodayMarker = true,
  showWeekends = true,
  className = '',
}: TimelineAxisProps): React.ReactElement {
  const today = getToday();
  const todayX = showTodayMarker ? dateToPixels(today, timelineStart, scale) : null;

  // Filter visible labels
  const visibleLabels = labels.filter((label) => {
    return label.x + label.width >= scrollLeft && label.x <= scrollLeft + width;
  });

  return (
    <div
      className={`timeline-axis relative overflow-hidden flex-shrink-0 border-b border-gray-300 bg-gray-50 ${className}`}
      style={{
        width: `${width}px`,
        height: `${height}px`,
      }}
    >
      <div
        className="absolute top-0 left-0 h-full"
        style={{
          transform: `translateX(-${scrollLeft}px)`,
          width:
            labels.length > 0
              ? `${labels[labels.length - 1].x + labels[labels.length - 1].width}px`
              : '100%',
        }}
      >
        {/* Render labels */}
        {visibleLabels.map((label, index) => (
          <div
            key={index}
            className={`absolute top-0 h-full flex items-center justify-center border-r border-gray-200 ${
              label.isMinor ? 'text-gray-400 text-xs' : 'text-gray-700 text-sm font-medium'
            } ${showWeekends && label.isMinor ? 'bg-gray-100' : ''}`}
            style={{
              left: `${label.x}px`,
              width: `${label.width}px`,
            }}
          >
            {label.label}
          </div>
        ))}

        {/* Today marker */}
        {showTodayMarker && todayX !== null && todayX >= 0 && (
          <div
            className="absolute top-0 w-0.5 h-full bg-blue-500 z-10"
            style={{
              left: `${todayX}px`,
            }}
            title="Today"
          >
            <div className="absolute -top-1 -left-1 w-2 h-2 rounded-full bg-blue-500" />
          </div>
        )}
      </div>
    </div>
  );
}
