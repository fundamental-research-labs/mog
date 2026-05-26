/**
 * Timeline Component
 *
 * Main kernel-agnostic timeline component.
 * Renders a Gantt-style timeline with horizontal bars.
 * Takes data and state as props, no kernel dependencies.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { TimelineAxis } from './TimelineAxis';
import { TimelineBar } from './TimelineBar';
import type {
  PositionedTimelineBar,
  TimelineBar as TimelineBarData,
  TimelineConfig,
  TimelineProps,
} from './types';
import { dateToPixels, generateAxisLabels, pixelsToDate, snapToUnit } from './utils';

/**
 * Default configuration values.
 */
const DEFAULT_CONFIG: TimelineConfig = {
  rowHeight: 40,
  barPadding: 4,
  groupHeaderHeight: 32,
  labelColumnWidth: 200,
  showTodayMarker: true,
  showWeekends: true,
  minBarWidth: 4,
};

/**
 * Timeline component - renders a Gantt-style timeline view.
 */
export function Timeline({
  bars,
  groups = [],
  state,
  config: configOverrides,
  handlers = {},
  className = '',
  style = {},
}: TimelineProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Merge config with defaults
  const config = { ...DEFAULT_CONFIG, ...configOverrides };

  // Generate axis labels
  const axisLabels = useMemo(() => {
    return generateAxisLabels(
      state.viewport.viewportStart,
      state.viewport.viewportEnd,
      state.viewport.scale,
      state.viewport.viewportStart,
    );
  }, [state.viewport.viewportStart, state.viewport.viewportEnd, state.viewport.scale]);

  // Calculate content width from axis labels
  const contentWidth = useMemo(() => {
    if (axisLabels.length === 0) return 1000;
    const lastLabel = axisLabels[axisLabels.length - 1];
    return lastLabel.x + lastLabel.width;
  }, [axisLabels]);

  // Group bars by groupId
  const groupedBars = useMemo(() => {
    const grouped = new Map<string, TimelineBarData[]>();
    const ungrouped: TimelineBarData[] = [];

    for (const bar of bars) {
      if (bar.groupId) {
        const groupBars = grouped.get(bar.groupId) || [];
        groupBars.push(bar);
        grouped.set(bar.groupId, groupBars);
      } else {
        ungrouped.push(bar);
      }
    }

    return { grouped, ungrouped };
  }, [bars]);

  // Calculate positioned bars with layout
  const positionedBars = useMemo(() => {
    const positioned: PositionedTimelineBar[] = [];
    let currentY = 0;

    // Process groups
    for (const group of groups) {
      const isCollapsed = state.collapsedGroups.has(group.id);

      // Add group header height
      currentY += config.groupHeaderHeight;

      if (!isCollapsed) {
        const groupBars = groupedBars.grouped.get(group.id) || [];

        for (const bar of groupBars) {
          const x = dateToPixels(bar.startDate, state.viewport.viewportStart, state.viewport.scale);
          const endX = dateToPixels(
            bar.endDate,
            state.viewport.viewportStart,
            state.viewport.scale,
          );
          const width = bar.isMilestone ? 0 : Math.max(endX - x, config.minBarWidth);

          positioned.push({
            ...bar,
            x,
            y: currentY + config.barPadding,
            width,
            height: config.rowHeight - config.barPadding * 2,
          });

          currentY += config.rowHeight;
        }
      }
    }

    // Process ungrouped bars
    for (const bar of groupedBars.ungrouped) {
      const x = dateToPixels(bar.startDate, state.viewport.viewportStart, state.viewport.scale);
      const endX = dateToPixels(bar.endDate, state.viewport.viewportStart, state.viewport.scale);
      const width = bar.isMilestone ? 0 : Math.max(endX - x, config.minBarWidth);

      positioned.push({
        ...bar,
        x,
        y: currentY + config.barPadding,
        width,
        height: config.rowHeight - config.barPadding * 2,
      });

      currentY += config.rowHeight;
    }

    return { bars: positioned, totalHeight: currentY };
  }, [
    bars,
    groups,
    groupedBars,
    state.collapsedGroups,
    state.viewport.viewportStart,
    state.viewport.scale,
    config,
  ]);

  // Handle bar click
  const handleBarClick = useCallback(
    (barId: string, event: React.MouseEvent) => {
      handlers.onBarClick?.(barId, event);
    },
    [handlers],
  );

  // Handle bar double click
  const handleBarDoubleClick = useCallback(
    (barId: string) => {
      handlers.onBarDoubleClick?.(barId);
    },
    [handlers],
  );

  // Handle drag start
  const handleDragStart = useCallback(
    (barId: string, startX: number) => {
      setIsDragging(true);
      // Store initial position for drag calculation
      const bar = bars.find((b) => b.id === barId);
      if (bar && contentRef.current) {
        contentRef.current.dataset.dragBarId = barId;
        contentRef.current.dataset.dragStartX = startX.toString();
        contentRef.current.dataset.dragStartDate = bar.startDate.toISOString();
        contentRef.current.dataset.dragEndDate = bar.endDate.toISOString();
      }
    },
    [bars],
  );

  // Handle resize start
  const handleResizeStart = useCallback(
    (barId: string, edge: 'start' | 'end', startX: number) => {
      setIsDragging(true);
      // Store initial position for resize calculation
      const bar = bars.find((b) => b.id === barId);
      if (bar && contentRef.current) {
        contentRef.current.dataset.resizeBarId = barId;
        contentRef.current.dataset.resizeEdge = edge;
        contentRef.current.dataset.resizeStartX = startX.toString();
        contentRef.current.dataset.resizeStartDate = bar.startDate.toISOString();
        contentRef.current.dataset.resizeEndDate = bar.endDate.toISOString();
      }
    },
    [bars],
  );

  // Handle mouse move (for drag/resize)
  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      if (!contentRef.current || !isDragging) return;

      const dragBarId = contentRef.current.dataset.dragBarId;
      const resizeBarId = contentRef.current.dataset.resizeBarId;

      if (dragBarId) {
        const startX = parseInt(contentRef.current.dataset.dragStartX || '0', 10);
        const startDate = new Date(contentRef.current.dataset.dragStartDate || '');
        const endDate = new Date(contentRef.current.dataset.dragEndDate || '');

        const deltaX = event.clientX - startX;
        const deltaDays =
          pixelsToDate(deltaX, new Date(0), state.viewport.scale).getTime() / (1000 * 60 * 60 * 24);

        const newStartDate = snapToUnit(
          new Date(startDate.getTime() + deltaDays * 24 * 60 * 60 * 1000),
          state.viewport.scale,
        );
        const newEndDate = snapToUnit(
          new Date(endDate.getTime() + deltaDays * 24 * 60 * 60 * 1000),
          state.viewport.scale,
        );

        handlers.onBarDrag?.(dragBarId, newStartDate, newEndDate);
      } else if (resizeBarId) {
        const edge = contentRef.current.dataset.resizeEdge as 'start' | 'end';
        const startX = parseInt(contentRef.current.dataset.resizeStartX || '0', 10);
        const startDate = new Date(contentRef.current.dataset.resizeStartDate || '');
        const endDate = new Date(contentRef.current.dataset.resizeEndDate || '');

        const deltaX = event.clientX - startX;
        const deltaDays =
          pixelsToDate(deltaX, new Date(0), state.viewport.scale).getTime() / (1000 * 60 * 60 * 24);

        if (edge === 'start') {
          const newStartDate = snapToUnit(
            new Date(startDate.getTime() + deltaDays * 24 * 60 * 60 * 1000),
            state.viewport.scale,
          );
          if (newStartDate < endDate) {
            handlers.onBarResize?.(resizeBarId, newStartDate, endDate);
          }
        } else {
          const newEndDate = snapToUnit(
            new Date(endDate.getTime() + deltaDays * 24 * 60 * 60 * 1000),
            state.viewport.scale,
          );
          if (newEndDate > startDate) {
            handlers.onBarResize?.(resizeBarId, startDate, newEndDate);
          }
        }
      }
    },
    [isDragging, state.viewport.scale, handlers],
  );

  // Handle mouse up (end drag/resize)
  const handleMouseUp = useCallback(() => {
    if (contentRef.current) {
      delete contentRef.current.dataset.dragBarId;
      delete contentRef.current.dataset.dragStartX;
      delete contentRef.current.dataset.dragStartDate;
      delete contentRef.current.dataset.dragEndDate;
      delete contentRef.current.dataset.resizeBarId;
      delete contentRef.current.dataset.resizeEdge;
      delete contentRef.current.dataset.resizeStartX;
      delete contentRef.current.dataset.resizeStartDate;
      delete contentRef.current.dataset.resizeEndDate;
    }
    setIsDragging(false);
  }, []);

  // Add global mouse listeners for drag/resize
  React.useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Handle group toggle
  const handleGroupToggle = useCallback(
    (groupId: string) => {
      const isCollapsed = state.collapsedGroups.has(groupId);
      handlers.onGroupToggle?.(groupId, !isCollapsed);
    },
    [state.collapsedGroups, handlers],
  );

  const timelineContentHeight = Math.max(positionedBars.totalHeight, 500);

  return (
    <div
      ref={containerRef}
      className={`timeline-view flex flex-col h-full w-full overflow-hidden ${className}`}
      style={style}
    >
      {/* Header row with label column and time axis */}
      <div className="flex flex-shrink-0">
        {/* Label column header */}
        <div
          className="h-12 border-b border-r border-gray-300 bg-gray-50 flex items-center px-3 font-semibold text-gray-700"
          style={{ width: config.labelColumnWidth }}
        >
          Tasks
        </div>

        {/* Time axis */}
        <div className="flex-1 overflow-hidden">
          <TimelineAxis
            labels={axisLabels}
            width={contentWidth}
            height={48}
            scrollLeft={state.viewport.scrollLeft}
            scale={state.viewport.scale}
            timelineStart={state.viewport.viewportStart}
            showTodayMarker={config.showTodayMarker}
            showWeekends={config.showWeekends}
          />
        </div>
      </div>

      {/* Content row with label sidebar and bars */}
      <div className="flex flex-1 overflow-auto">
        {/* Label sidebar */}
        <div
          className="overflow-y-auto border-r border-gray-300 bg-white"
          style={{ width: config.labelColumnWidth }}
        >
          {/* Group headers and row labels */}
          {groups.map((group) => {
            const isCollapsed = state.collapsedGroups.has(group.id);
            const groupBars = groupedBars.grouped.get(group.id) || [];

            return (
              <div key={group.id}>
                <div
                  className="flex items-center px-3 py-2 bg-gray-100 border-b border-gray-300 cursor-pointer hover:bg-gray-200"
                  style={{ height: config.groupHeaderHeight }}
                  onClick={() => handleGroupToggle(group.id)}
                >
                  <span className="mr-2">{isCollapsed ? '▶' : '▼'}</span>
                  <span className="font-semibold text-gray-700">{group.label}</span>
                  <span className="ml-auto text-sm text-gray-500">({groupBars.length})</span>
                </div>
                {!isCollapsed &&
                  groupBars.map((bar) => (
                    <div
                      key={bar.id}
                      className="flex items-center px-3 border-b border-gray-200 hover:bg-gray-50"
                      style={{ height: config.rowHeight }}
                    >
                      <span className="text-sm text-gray-700 truncate">{bar.title}</span>
                    </div>
                  ))}
              </div>
            );
          })}

          {/* Ungrouped bars */}
          {groupedBars.ungrouped.map((bar) => (
            <div
              key={bar.id}
              className="flex items-center px-3 border-b border-gray-200 hover:bg-gray-50"
              style={{ height: config.rowHeight }}
            >
              <span className="text-sm text-gray-700 truncate">{bar.title}</span>
            </div>
          ))}
        </div>

        {/* Timeline content area */}
        <div
          ref={contentRef}
          className="flex-1 overflow-auto relative bg-white"
          style={{
            cursor: isDragging ? 'grabbing' : 'default',
          }}
        >
          {/* Content container */}
          <div
            className="relative"
            style={{
              width: contentWidth,
              height: timelineContentHeight,
            }}
          >
            {/* Grid lines (vertical) */}
            {axisLabels.map((label, index) => (
              <div
                key={index}
                className="absolute top-0 h-full border-r border-gray-200"
                style={{
                  left: label.x,
                  backgroundColor:
                    config.showWeekends && label.isMinor ? 'rgba(0, 0, 0, 0.02)' : 'transparent',
                }}
              />
            ))}

            {/* Bars */}
            {positionedBars.bars.map((bar) => (
              <TimelineBar
                key={bar.id}
                id={bar.id}
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                title={bar.title}
                color={bar.color}
                isMilestone={bar.isMilestone}
                isSelected={state.selection.selectedBarIds.has(bar.id)}
                isFocused={state.selection.focusedBarId === bar.id}
                onClick={handleBarClick}
                onDoubleClick={handleBarDoubleClick}
                onDragStart={handleDragStart}
                onResizeStart={handleResizeStart}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
