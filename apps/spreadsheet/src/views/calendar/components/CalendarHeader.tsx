/**
 * CalendarHeader Component
 *
 * Navigation header with:
 * - Previous/Next navigation buttons
 * - Current period title (month/week/day)
 * - Today button
 * - View mode toggle [M][W][D]
 */

import React from 'react';
import type { CalendarViewMode } from '../config';

// =============================================================================
// Types
// =============================================================================

interface CalendarHeaderProps {
  /** Current period title (e.g., "January 2024") */
  title: string;
  /** Current view mode */
  viewMode: CalendarViewMode;
  /** Is the current period showing today? */
  isShowingToday: boolean;
  /** Navigate to previous period */
  onPrevious: () => void;
  /** Navigate to next period */
  onNext: () => void;
  /** Navigate to today */
  onToday: () => void;
  /** Change view mode */
  onViewModeChange: (mode: CalendarViewMode) => void;
}

// =============================================================================
// Styles - Using Tailwind classes with design tokens
// =============================================================================

// =============================================================================
// Component
// =============================================================================

export function CalendarHeader({
  title,
  viewMode,
  isShowingToday,
  onPrevious,
  onNext,
  onToday,
  onViewModeChange,
}: CalendarHeaderProps): React.ReactElement {
  const navButtonClasses =
    'px-2.5 py-1.5 border border-ss-border rounded-ss-sm bg-ss-surface cursor-pointer text-body-sm text-ss-text transition-colors hover:bg-ss-surface-hover';
  const modeButtonClasses =
    'px-2.5 py-1.5 border rounded-ss-sm cursor-pointer text-body-sm font-medium transition-colors min-w-[32px] text-center';

  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-ss-border bg-ss-surface">
      {/* Left section: Navigation + Title */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <button
            className={navButtonClasses}
            onClick={onPrevious}
            aria-label="Previous"
            title="Previous"
          >
            &lt;
          </button>
          <button className={navButtonClasses} onClick={onNext} aria-label="Next" title="Next">
            &gt;
          </button>
        </div>

        <span className="text-subtitle font-semibold text-ss-text min-w-[200px]">{title}</span>

        <button
          className={`px-3 py-1.5 border border-ss-border rounded-ss-sm bg-ss-surface cursor-pointer text-body-sm text-ss-text transition-colors hover:bg-ss-surface-hover ${isShowingToday ? 'invisible' : ''}`}
          onClick={onToday}
          aria-label="Go to today"
        >
          Today
        </button>
      </div>

      {/* Right section: View mode toggle */}
      <div className="flex items-center gap-1">
        <button
          className={`${modeButtonClasses} ${viewMode === 'month' ? 'bg-ss-primary border-ss-primary text-ss-text-inverse' : 'bg-ss-surface border-ss-border text-ss-text hover:bg-ss-surface-hover'}`}
          onClick={() => onViewModeChange('month')}
          aria-label="Month view"
          aria-pressed={viewMode === 'month'}
          title="Month view"
        >
          M
        </button>
        <button
          className={`${modeButtonClasses} ${viewMode === 'week' ? 'bg-ss-primary border-ss-primary text-ss-text-inverse' : 'bg-ss-surface border-ss-border text-ss-text hover:bg-ss-surface-hover'}`}
          onClick={() => onViewModeChange('week')}
          aria-label="Week view"
          aria-pressed={viewMode === 'week'}
          title="Week view"
        >
          W
        </button>
        <button
          className={`${modeButtonClasses} ${viewMode === 'day' ? 'bg-ss-primary border-ss-primary text-ss-text-inverse' : 'bg-ss-surface border-ss-border text-ss-text hover:bg-ss-surface-hover'}`}
          onClick={() => onViewModeChange('day')}
          aria-label="Day view"
          aria-pressed={viewMode === 'day'}
          title="Day view"
        >
          D
        </button>
      </div>
    </div>
  );
}
