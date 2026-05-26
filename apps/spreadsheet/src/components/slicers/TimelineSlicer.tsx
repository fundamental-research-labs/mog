/**
 * Timeline Slicer Component
 *
 * Slicers Implementation
 *
 * Renders a timeline slicer with:
 * - Horizontal timeline bar with period markers
 * - Drag-to-select date range interaction
 * - Level selector (years, quarters, months, days)
 * - Visual selection range highlighting
 * - Scroll/zoom behavior
 *
 * Architecture:
 * - Renders as absolute-positioned React element over canvas
 * - Selection delegates to parent handlers (single source of truth: filter state)
 * - Uses CSS custom properties for theming
 *
 * @module components/slicers/TimelineSlicer
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';

import type {
  SlicerStylePreset,
  TimelineLevel,
  TimelinePeriod,
  TimelineSlicerConfig,
} from '@mog-sdk/contracts/slicers';
// =============================================================================
// Types
// =============================================================================

export interface TimelineSlicerProps {
  /** Timeline slicer configuration */
  config: TimelineSlicerConfig;
  /** Computed periods with states */
  periods: TimelinePeriod[];
  /** Whether the slicer is connected to its data source */
  isConnected: boolean;
  /** Whether any filter is active (date range selected) */
  hasActiveFilter: boolean;
  /** Whether this slicer is selected (for UI focus) */
  isSelected: boolean;
  /** Handle date range selection */
  onRangeSelect: (startDate: number, endDate: number) => void;
  /** Handle clear selection */
  onClearAll: () => void;
  /** Handle slicer selection (UI focus) */
  onSelect: () => void;
  /** Handle level change */
  onLevelChange: (level: TimelineLevel) => void;
  /** Handle position change (drag/resize) */
  onPositionChange?: (position: Partial<TimelineSlicerConfig['position']>) => void;
  /** Handle delete */
  onDelete?: () => void;
}

// =============================================================================
// Style Presets
// =============================================================================

const STYLE_PRESETS: Record<
  SlicerStylePreset,
  {
    header: { bg: string; text: string };
    selected: { bg: string; text: string };
    available: { bg: string; text: string };
    unavailable: { bg: string; text: string };
    border: string;
    borderWidth: number;
    track: { bg: string };
    thumb: { bg: string };
  }
> = {
  // Slicer theme presets - intentional hex values for predefined themes
  light1: {
    header: { bg: '#4472c4', text: '#ffffff' },
    selected: { bg: '#4472c4', text: '#ffffff' },
    available: { bg: '#e2e8f0', text: '#1e293b' },
    unavailable: { bg: '#f1f5f9', text: '#94a3b8' },
    border: '#cbd5e1',
    borderWidth: 1,
    track: { bg: '#f1f5f9' },
    thumb: { bg: '#4472c4' },
  },
  light2: {
    header: { bg: '#ed7d31', text: '#ffffff' },
    selected: { bg: '#ed7d31', text: '#ffffff' },
    available: { bg: '#fee2e2', text: '#1e293b' },
    unavailable: { bg: '#f1f5f9', text: '#94a3b8' },
    border: '#cbd5e1',
    borderWidth: 1,
    track: { bg: '#f1f5f9' },
    thumb: { bg: '#ed7d31' },
  },
  light3: {
    header: { bg: '#a5a5a5', text: '#ffffff' },
    selected: { bg: '#a5a5a5', text: '#ffffff' },
    available: { bg: '#e5e7eb', text: '#1e293b' },
    unavailable: { bg: '#f1f5f9', text: '#94a3b8' },
    border: '#cbd5e1',
    borderWidth: 1,
    track: { bg: '#f1f5f9' },
    thumb: { bg: '#a5a5a5' },
  },
  light4: {
    header: { bg: '#ffc000', text: '#1e293b' },
    selected: { bg: '#ffc000', text: '#1e293b' },
    available: { bg: '#fef3c7', text: '#1e293b' },
    unavailable: { bg: '#f1f5f9', text: '#94a3b8' },
    border: '#cbd5e1',
    borderWidth: 1,
    track: { bg: '#f1f5f9' },
    thumb: { bg: '#ffc000' },
  },
  light5: {
    header: { bg: '#5b9bd5', text: '#ffffff' },
    selected: { bg: '#5b9bd5', text: '#ffffff' },
    available: { bg: '#dbeafe', text: '#1e293b' },
    unavailable: { bg: '#f1f5f9', text: '#94a3b8' },
    border: '#cbd5e1',
    borderWidth: 1,
    track: { bg: '#f1f5f9' },
    thumb: { bg: '#5b9bd5' },
  },
  light6: {
    header: { bg: '#70ad47', text: '#ffffff' },
    selected: { bg: '#70ad47', text: '#ffffff' },
    available: { bg: '#dcfce7', text: '#1e293b' },
    unavailable: { bg: '#f1f5f9', text: '#94a3b8' },
    border: '#cbd5e1',
    borderWidth: 1,
    track: { bg: '#f1f5f9' },
    thumb: { bg: '#70ad47' },
  },
  dark1: {
    header: { bg: '#1e3a5f', text: '#ffffff' },
    selected: { bg: '#4472c4', text: '#ffffff' },
    available: { bg: '#374151', text: '#e2e8f0' },
    unavailable: { bg: '#1f2937', text: '#6b7280' },
    border: '#475569',
    borderWidth: 1,
    track: { bg: '#1f2937' },
    thumb: { bg: '#4472c4' },
  },
  dark2: {
    header: { bg: '#7c2d12', text: '#ffffff' },
    selected: { bg: '#ed7d31', text: '#ffffff' },
    available: { bg: '#374151', text: '#e2e8f0' },
    unavailable: { bg: '#1f2937', text: '#6b7280' },
    border: '#475569',
    borderWidth: 1,
    track: { bg: '#1f2937' },
    thumb: { bg: '#ed7d31' },
  },
  dark3: {
    header: { bg: '#374151', text: '#ffffff' },
    selected: { bg: '#6b7280', text: '#ffffff' },
    available: { bg: '#374151', text: '#e2e8f0' },
    unavailable: { bg: '#1f2937', text: '#6b7280' },
    border: '#475569',
    borderWidth: 1,
    track: { bg: '#1f2937' },
    thumb: { bg: '#6b7280' },
  },
  dark4: {
    header: { bg: '#854d0e', text: '#ffffff' },
    selected: { bg: '#ffc000', text: '#1e293b' },
    available: { bg: '#374151', text: '#e2e8f0' },
    unavailable: { bg: '#1f2937', text: '#6b7280' },
    border: '#475569',
    borderWidth: 1,
    track: { bg: '#1f2937' },
    thumb: { bg: '#ffc000' },
  },
  dark5: {
    header: { bg: '#1e40af', text: '#ffffff' },
    selected: { bg: '#5b9bd5', text: '#ffffff' },
    available: { bg: '#374151', text: '#e2e8f0' },
    unavailable: { bg: '#1f2937', text: '#6b7280' },
    border: '#475569',
    borderWidth: 1,
    track: { bg: '#1f2937' },
    thumb: { bg: '#5b9bd5' },
  },
  dark6: {
    header: { bg: '#166534', text: '#ffffff' },
    selected: { bg: '#70ad47', text: '#ffffff' },
    available: { bg: '#374151', text: '#e2e8f0' },
    unavailable: { bg: '#1f2937', text: '#6b7280' },
    border: '#475569',
    borderWidth: 1,
    track: { bg: '#1f2937' },
    thumb: { bg: '#70ad47' },
  },
  other1: {
    header: { bg: '#7c3aed', text: '#ffffff' },
    selected: { bg: '#7c3aed', text: '#ffffff' },
    available: { bg: '#ede9fe', text: '#1e293b' },
    unavailable: { bg: '#f1f5f9', text: '#94a3b8' },
    border: '#cbd5e1',
    borderWidth: 1,
    track: { bg: '#f1f5f9' },
    thumb: { bg: '#7c3aed' },
  },
  other2: {
    header: { bg: '#db2777', text: '#ffffff' },
    selected: { bg: '#db2777', text: '#ffffff' },
    available: { bg: '#fce7f3', text: '#1e293b' },
    unavailable: { bg: '#f1f5f9', text: '#94a3b8' },
    border: '#cbd5e1',
    borderWidth: 1,
    track: { bg: '#f1f5f9' },
    thumb: { bg: '#db2777' },
  },
};

// =============================================================================
// Constants
// =============================================================================

const PERIOD_BAR_MIN_WIDTH = 28;
const HEADER_HEIGHT = 28;
const LEVEL_SELECTOR_HEIGHT = 24;
const TIMELINE_TRACK_HEIGHT = 32;
const SCROLL_TRACK_HEIGHT = 8;

const LEVEL_OPTIONS: { value: TimelineLevel; label: string }[] = [
  { value: 'years', label: 'YEARS' },
  { value: 'quarters', label: 'QUARTERS' },
  { value: 'months', label: 'MONTHS' },
  { value: 'days', label: 'DAYS' },
];

// =============================================================================
// Components
// =============================================================================

/**
 * Period bar component.
 */
interface PeriodBarProps {
  period: TimelinePeriod;
  width: number;
  style: (typeof STYLE_PRESETS)[SlicerStylePreset];
  index: number;
  onMouseDown: (index: number, e: React.MouseEvent) => void;
  onMouseEnter: (index: number) => void;
}

const PeriodBar = React.memo(function PeriodBar({
  period,
  width,
  style,
  index,
  onMouseDown,
  onMouseEnter,
}: PeriodBarProps) {
  const barStyle = period.isSelected
    ? style.selected
    : period.hasData
      ? style.available
      : style.unavailable;

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onMouseDown(index, e);
    },
    [index, onMouseDown],
  );

  const handleMouseEnter = useCallback(() => {
    onMouseEnter(index);
  }, [index, onMouseEnter]);

  return (
    <div
      className="flex flex-col items-center justify-center text-caption font-medium select-none cursor-pointer transition-colors hover:opacity-90"
      style={{
        width,
        height: TIMELINE_TRACK_HEIGHT,
        backgroundColor: barStyle.bg,
        color: barStyle.text,
        borderRight: `1px solid ${style.border}`,
        opacity: period.hasData ? 1 : 0.5,
      }}
      onMouseDown={handleMouseDown}
      onMouseEnter={handleMouseEnter}
      title={`${period.label}${period.count > 0 ? ` (${period.count})` : ''}`}
    >
      <span className="truncate px-0.5">{period.label}</span>
    </div>
  );
});

/**
 * Level selector component.
 */
interface LevelSelectorProps {
  level: TimelineLevel;
  style: (typeof STYLE_PRESETS)[SlicerStylePreset];
  onChange: (level: TimelineLevel) => void;
}

function LevelSelector({ level, style, onChange }: LevelSelectorProps) {
  return (
    <div
      className="flex items-center gap-1 px-2"
      style={{
        height: LEVEL_SELECTOR_HEIGHT,
        backgroundColor: style.header.bg,
      }}
    >
      {LEVEL_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`
 px-2 py-0.5 text-caption font-medium rounded transition-colors
 ${
   level === option.value
     ? 'bg-ss-surface/30 text-ss-text-inverse'
     : 'text-ss-text-inverse/70 hover:text-ss-text-inverse hover:bg-ss-surface/10'
 }
 `}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Disconnected state overlay.
 */
function DisconnectedOverlay() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-ss-surface-secondary z-ss-sticky">
      <div className="text-center p-4">
        <svg
          className="h-8 w-8 mx-auto mb-2 text-ss-warning"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <p className="text-body-sm font-medium text-ss-text-secondary">Timeline Disconnected</p>
        <p className="text-caption text-ss-text-tertiary mt-1">Source column was deleted</p>
      </div>
    </div>
  );
}

/**
 * Selection range label component.
 */
interface SelectionLabelProps {
  periods: TimelinePeriod[];
  style: (typeof STYLE_PRESETS)[SlicerStylePreset];
}

function SelectionLabel({ periods, style }: SelectionLabelProps) {
  const selectedPeriods = periods.filter((p) => p.isSelected);

  if (selectedPeriods.length === 0) {
    return <span className="text-caption text-ss-text-tertiary italic">All dates</span>;
  }

  const first = selectedPeriods[0];
  const last = selectedPeriods[selectedPeriods.length - 1];

  const label = first === last ? first.label : `${first.label} - ${last.label}`;

  return (
    <span
      className="text-caption font-medium px-2 py-0.5 rounded"
      style={{
        backgroundColor: style.selected.bg,
        color: style.selected.text,
      }}
    >
      {label}
    </span>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function TimelineSlicer({
  config,
  periods,
  isConnected,
  hasActiveFilter,
  isSelected,
  onRangeSelect,
  onClearAll,
  onSelect,
  onLevelChange,
}: TimelineSlicerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragEnd, setDragEnd] = useState<number | null>(null);

  // Get style configuration
  const styleConfig = useMemo(() => {
    return STYLE_PRESETS[config.style.preset ?? 'light1'];
  }, [config.style.preset]);

  // Calculate period bar width
  const periodWidth = useMemo(() => {
    const width = config.position.width ?? 300;
    const availableWidth = width - 4; // Padding
    const minWidthForAll = periods.length * PERIOD_BAR_MIN_WIDTH;

    if (periods.length === 0) return PERIOD_BAR_MIN_WIDTH;

    if (minWidthForAll <= availableWidth) {
      // All periods fit - distribute evenly
      return Math.floor(availableWidth / periods.length);
    }

    // Need scrolling - use minimum width
    return PERIOD_BAR_MIN_WIDTH;
  }, [config.position.width, periods.length]);

  // Handle mouse down on period (start drag)
  const handlePeriodMouseDown = useCallback(
    (index: number, e: React.MouseEvent) => {
      e.stopPropagation();
      setIsDragging(true);
      setDragStart(index);
      setDragEnd(index);
      onSelect();
    },
    [onSelect],
  );

  // Handle mouse enter on period (extend drag)
  const handlePeriodMouseEnter = useCallback(
    (index: number) => {
      if (isDragging) {
        setDragEnd(index);
      }
    },
    [isDragging],
  );

  // Handle mouse up (end drag, apply selection)
  const handleMouseUp = useCallback(() => {
    if (isDragging && dragStart !== null && dragEnd !== null) {
      const startIndex = Math.min(dragStart, dragEnd);
      const endIndex = Math.max(dragStart, dragEnd);

      if (periods[startIndex] && periods[endIndex]) {
        onRangeSelect(periods[startIndex].startDate, periods[endIndex].endDate);
      }
    }

    setIsDragging(false);
    setDragStart(null);
    setDragEnd(null);
  }, [isDragging, dragStart, dragEnd, periods, onRangeSelect]);

  // Global mouse up handler
  React.useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isDragging) {
        handleMouseUp();
      }
    };

    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging, handleMouseUp]);

  // Handle clear button click
  const handleClearClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClearAll();
    },
    [onClearAll],
  );

  // Handle container click (select slicer)
  const handleContainerClick = useCallback(
    (e: React.MouseEvent) => {
      if (
        e.target === e.currentTarget ||
        (e.target as HTMLElement).closest('[data-timeline-body]')
      ) {
        onSelect();
      }
    },
    [onSelect],
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (isSelected && hasActiveFilter) {
          e.preventDefault();
          onClearAll();
        }
      }
    },
    [isSelected, hasActiveFilter, onClearAll],
  );

  // Get position from config
  const { position } = config;
  const headerHeight = config.showHeader ? HEADER_HEIGHT : 0;

  // Compute drag selection overlay
  const dragSelection = useMemo(() => {
    if (!isDragging || dragStart === null || dragEnd === null) {
      return null;
    }

    const startIndex = Math.min(dragStart, dragEnd);
    const endIndex = Math.max(dragStart, dragEnd);
    const left = startIndex * periodWidth;
    const width = (endIndex - startIndex + 1) * periodWidth;

    return { left, width };
  }, [isDragging, dragStart, dragEnd, periodWidth]);

  const containerClasses = [
    'absolute flex flex-col overflow-hidden bg-ss-surface rounded shadow-ss-sm',
    'transition-shadow duration-ss',
    isSelected ? 'ring-2 ring-ss-border-focus shadow-ss-md' : '',
    isHovered && !isSelected ? 'shadow-ss-md' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={containerRef}
      className={containerClasses}
      style={{
        left: position.x,
        top: position.y,
        width: position.width,
        height: position.height,
        borderColor: styleConfig.border,
        borderWidth: styleConfig.borderWidth,
        borderStyle: 'solid',
        zIndex: config.zIndex,
      }}
      onClick={handleContainerClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="slider"
      aria-label={config.caption}
      aria-valuemin={periods[0]?.startDate}
      aria-valuemax={periods[periods.length - 1]?.endDate}
      data-timeline-slicer-id={config.id}
      data-testid={`timeline-slicer-${config.id}`}
    >
      {/* Disconnected overlay */}
      {!isConnected && <DisconnectedOverlay />}

      {/* Header */}
      {config.showHeader && (
        <div
          className="flex items-center justify-between px-2 flex-shrink-0"
          style={{
            height: headerHeight,
            backgroundColor: styleConfig.header.bg,
            color: styleConfig.header.text,
          }}
        >
          <span className="text-body-sm font-semibold truncate flex-1">{config.caption}</span>
          {hasActiveFilter && (
            <button
              type="button"
              onClick={handleClearClick}
              className="p-0.5 rounded hover:bg-ss-surface-hover transition-colors"
              title="Clear filter"
              aria-label="Clear filter"
            >
              <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
                <path d="M2.5 1a.5.5 0 0 0-.5.5v1.379L7.293 8.172a.5.5 0 0 1 .207.403v4.175l1-.5V8.575a.5.5 0 0 1 .207-.403L14 2.879V1.5a.5.5 0 0 0-.5-.5h-11zM14.5 0a1.5 1.5 0 0 1 1.5 1.5v1.879a1.5 1.5 0 0 1-.44 1.061l-5.06 5.06v3.75a1.5 1.5 0 0 1-.712 1.28l-2 1.2A1.5 1.5 0 0 1 5.5 14.25V9.5L.44 4.44A1.5 1.5 0 0 1 0 3.379V1.5A1.5 1.5 0 0 1 1.5 0h13z" />
                <path
                  d="M11.354 4.646a.5.5 0 0 1 0 .708L9.707 7l1.647 1.646a.5.5 0 0 1-.708.708L9 7.707 7.354 9.354a.5.5 0 0 1-.708-.708L8.293 7 6.646 5.354a.5.5 0 1 1 .708-.708L9 6.293l1.646-1.647a.5.5 0 0 1 .708 0z"
                  fill="currentColor"
                />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Level selector */}
      {config.showLevelSelector && (
        <LevelSelector level={config.timelineLevel} style={styleConfig} onChange={onLevelChange} />
      )}

      {/* Selection label */}
      {config.showDateRangeLabel && (
        <div
          className="flex items-center justify-center py-1 px-2 bg-ss-surface-secondary"
          style={{ borderBottom: `1px solid ${styleConfig.border}` }}
        >
          <SelectionLabel periods={periods} style={styleConfig} />
        </div>
      )}

      {/* Timeline track */}
      <div className="flex-1 overflow-hidden relative" data-timeline-body>
        <div
          ref={timelineRef}
          className="flex overflow-x-auto"
          style={{
            height: TIMELINE_TRACK_HEIGHT,
            backgroundColor: styleConfig.track.bg,
          }}
        >
          {periods.map((period, index) => (
            <PeriodBar
              key={`${period.startDate}-${index}`}
              period={period}
              width={periodWidth}
              style={styleConfig}
              index={index}
              onMouseDown={handlePeriodMouseDown}
              onMouseEnter={handlePeriodMouseEnter}
            />
          ))}

          {/* Drag selection overlay */}
          {dragSelection && (
            <div
              className="absolute top-0 pointer-events-none"
              style={{
                left: dragSelection.left,
                width: dragSelection.width,
                height: TIMELINE_TRACK_HEIGHT,
                backgroundColor: styleConfig.selected.bg,
                opacity: 0.5,
              }}
            />
          )}
        </div>

        {periods.length === 0 && isConnected && (
          <div className="flex items-center justify-center h-full text-body-sm text-ss-text-tertiary">
            No date data available
          </div>
        )}
      </div>

      {/* Scroll indicator (optional, for long timelines) */}
      {periods.length * PERIOD_BAR_MIN_WIDTH > (config.position.width ?? 300) && (
        <div
          className="flex-shrink-0"
          style={{
            height: SCROLL_TRACK_HEIGHT,
            backgroundColor: styleConfig.border,
          }}
        >
          {/* Simplified scroll indicator */}
          <div
            className="h-full rounded"
            style={{
              width: `${Math.max(20, ((config.position.width ?? 300) / (periods.length * PERIOD_BAR_MIN_WIDTH)) * 100)}%`,
              backgroundColor: styleConfig.thumb.bg,
              opacity: 0.5,
            }}
          />
        </div>
      )}
    </div>
  );
}

export default TimelineSlicer;
