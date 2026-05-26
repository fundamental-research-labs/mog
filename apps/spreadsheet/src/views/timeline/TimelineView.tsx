/**
 * TimelineView Component
 *
 * Main React component for the Timeline view.
 * Renders records as horizontal bars on a time axis (Gantt-style).
 *
 * Features:
 * - Canvas-based rendering for performance
 * - Horizontal bars representing date ranges
 * - Time axis with day/week/month/quarter/year scales
 * - Drag to move bars (change dates)
 * - Drag edges to resize (change duration)
 * - Pan viewport left/right
 * - Zoom in/out (change scale)
 * - Row grouping with collapsible sections
 * - Click to select bars
 */

import type { Workbook } from '@mog-sdk/contracts/api';
import type { RowId } from '@mog-sdk/contracts/cell-identity';
import { KeyboardEventProcessor } from '@mog-sdk/kernel/keyboard';
import { useSelector } from '@xstate/react';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { TimeAxis, TimelineCanvas, TimelineGroupHeader, TimelineRow } from './components';
import type { TimelineScale, TimelineViewConfig } from './config';
import { DEFAULT_TIMELINE_CONFIG } from './config';
import { useTimelineData } from './hooks/use-timeline-data';
import { useTimelineViewport } from './hooks/use-timeline-viewport';
import { TimelineEvents, type KeyModifiers, type TimelineActor } from './machines';
import { detectPlatform } from '../../utils/platform';
import { hitTestBar, hitTestBarEdge, hitTestGroup } from './utils/bar-positioning';
import { generateAxisLabels } from './utils/date-utils';
/**
 * Props for TimelineView component.
 */
export interface TimelineViewProps {
  /** The state machine actor (owned by the adapter) */
  actor: TimelineActor;
  /** Workbook API for data access */
  workbook: Workbook;
  /** View configuration */
  config: TimelineViewConfig;
  /** Callback when selection changes */
  onSelectionChange?: (selectedBars: RowId[]) => void;
  /** Callback when a bar is double-clicked (open record detail) */
  onBarDoubleClick?: (rowId: RowId) => void;
  /** Callback when dates are changed (drag/resize) */
  onDatesChange?: (rowId: RowId, startDate: Date, endDate: Date) => void;
}

/**
 * Timeline view component.
 */
export function TimelineView({
  actor,
  workbook,
  config,
  onSelectionChange,
  onBarDoubleClick,
  onDatesChange: _onDatesChange,
}: TimelineViewProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const mergedConfig = { ...DEFAULT_TIMELINE_CONFIG, ...config };

  // Use the actor passed from the adapter (single source of truth)
  const snapshot = useSelector(actor, (state) => state);
  const send = actor.send;
  const { selectedBars, focusedBar, collapsedGroups, scale, scrollLeft, scrollTop } =
    snapshot.context;

  // Viewport management
  const viewport = useTimelineViewport({
    initialScale: mergedConfig.timeScale,
    initialStartDate: mergedConfig.startDate,
    onViewportChange: useCallback(
      (viewportState: { scale: TimelineScale; scrollLeft: number; scrollTop: number }) => {
        send(TimelineEvents.setScale(viewportState.scale));
        send(TimelineEvents.scroll(viewportState.scrollLeft, viewportState.scrollTop));
      },
      [send],
    ),
  });

  // Data fetching and transformation
  const { layout, isLoading, error, refresh, allRowIds } = useTimelineData({
    workbook,
    config: mergedConfig,
    collapsedGroups,
  });

  // Calculate axis labels
  const axisLabels = useMemo(() => {
    if (!layout) return [];

    const startDate = mergedConfig.startDate || layout.minDate;
    const endDate = mergedConfig.endDate || layout.maxDate;

    return generateAxisLabels(startDate, endDate, scale as TimelineScale, startDate);
  }, [layout, mergedConfig.startDate, mergedConfig.endDate, scale]);

  // Calculate content width
  const contentWidth = useMemo(() => {
    if (axisLabels.length === 0) return 1000;
    const lastLabel = axisLabels[axisLabels.length - 1];
    return lastLabel.x + lastLabel.width;
  }, [axisLabels]);

  // Handle resize
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        viewport.setViewportDimensions(entry.contentRect.width, entry.contentRect.height);
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [viewport]);

  // Notify selection changes
  useEffect(() => {
    onSelectionChange?.(Array.from(selectedBars));
  }, [selectedBars, onSelectionChange]);

  // Handle canvas click
  const handleCanvasClick = useCallback(
    (x: number, y: number, event: React.MouseEvent) => {
      if (!layout) return;

      const modifiers: KeyModifiers = {
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
      };

      // Check for bar click
      const bar = hitTestBar(layout.bars, x, y);
      if (bar) {
        send(TimelineEvents.barClick(bar.rowId, modifiers));
        return;
      }

      // Check for group header click
      const group = hitTestGroup(layout.groups, x, y);
      if (group) {
        send(TimelineEvents.toggleGroup(group.key));
        return;
      }

      // Click on empty space clears selection
      send(TimelineEvents.canvasClick(x, y, modifiers));
    },
    [layout, send],
  );

  // Handle mouse move for cursor changes
  const handleMouseMove = useCallback(
    (x: number, y: number, _event: React.MouseEvent) => {
      if (!layout || !containerRef.current) return;

      // Check for resize handle
      const resizeHit = hitTestBarEdge(layout.bars, x, y);
      if (resizeHit) {
        containerRef.current.style.cursor = 'ew-resize';
        return;
      }

      // Check for bar (for drag cursor)
      const bar = hitTestBar(layout.bars, x, y);
      if (bar) {
        containerRef.current.style.cursor = 'grab';
        return;
      }

      containerRef.current.style.cursor = 'default';
    },
    [layout],
  );

  // Handle mouse down for drag/resize
  const handleMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (!layout || event.button !== 0) return;

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = event.clientX - rect.left + scrollLeft;
      const y = event.clientY - rect.top + scrollTop;

      // Check for resize
      const resizeHit = hitTestBarEdge(layout.bars, x, y);
      if (resizeHit) {
        send(TimelineEvents.barResizeStart(resizeHit.bar.rowId, resizeHit.edge, event.clientX));
        return;
      }

      // Check for bar drag
      const bar = hitTestBar(layout.bars, x, y);
      if (bar) {
        send(TimelineEvents.barDragStart(bar.rowId, event.clientX));
        return;
      }

      // Start pan if no bar hit
      send(TimelineEvents.panStart(event.clientX));
    },
    [layout, scrollLeft, scrollTop, send],
  );

  // Handle mouse up
  const handleMouseUp = useCallback(() => {
    if (snapshot.context.interaction.type === 'dragging-bar') {
      send(TimelineEvents.barDragEnd());
      // Date persistence is handled by the adapter via transition detection
    } else if (snapshot.context.interaction.type === 'resizing-bar') {
      send(TimelineEvents.barResizeEnd());
      // Date persistence is handled by the adapter via transition detection
    } else if (snapshot.context.interaction.type === 'panning') {
      send(TimelineEvents.panEnd());
    }
  }, [snapshot.context.interaction, send]);

  // Handle global mouse move/up for drag operations
  useEffect(() => {
    if (snapshot.context.interaction.type === 'idle') return;

    const handleGlobalMouseMove = (event: MouseEvent) => {
      if (snapshot.context.interaction.type === 'dragging-bar') {
        send(TimelineEvents.barDragMove(event.clientX));
      } else if (snapshot.context.interaction.type === 'resizing-bar') {
        send(TimelineEvents.barResizeMove(event.clientX));
      } else if (snapshot.context.interaction.type === 'panning') {
        send(TimelineEvents.panMove(event.clientX));
      }
    };

    const handleGlobalMouseUp = () => {
      handleMouseUp();
    };

    document.addEventListener('mousemove', handleGlobalMouseMove);
    document.addEventListener('mouseup', handleGlobalMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [snapshot.context.interaction.type, send, handleMouseUp]);

  // Keyboard event processor for normalization and IME safety
  const processor = useMemo(() => new KeyboardEventProcessor(detectPlatform()), []);

  // Handle keyboard
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const input = processor.process(event.nativeEvent);
      if (input.isComposing) return;

      const modifiers: KeyModifiers = {
        shiftKey: input.modifiers.shift,
        ctrlKey: input.modifiers.ctrl,
        metaKey: input.modifiers.meta,
        altKey: input.modifiers.alt,
      };

      send(TimelineEvents.keyboard(input.character, modifiers));

      // Handle specific keys
      switch (input.character) {
        case 'Escape':
          send(TimelineEvents.cancel());
          break;
        case 'Delete':
        case 'Backspace':
          // Delete selected records - handled by adapter
          break;
        case '+':
        case '=':
          if (input.modifiers.ctrl || input.modifiers.meta) {
            event.preventDefault();
            send(TimelineEvents.zoom('in'));
          }
          break;
        case '-':
          if (input.modifiers.ctrl || input.modifiers.meta) {
            event.preventDefault();
            send(TimelineEvents.zoom('out'));
          }
          break;
        case 'a':
          if (input.modifiers.ctrl || input.modifiers.meta) {
            event.preventDefault();
            send(TimelineEvents.selectBars(allRowIds, true));
          }
          break;
      }
    },
    [send, allRowIds, processor],
  );

  // Handle double click on bar
  const handleDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      if (!layout) return;

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = event.clientX - rect.left + scrollLeft;
      const y = event.clientY - rect.top + scrollTop;

      const bar = hitTestBar(layout.bars, x, y);
      if (bar) {
        send(TimelineEvents.barDoubleClick(bar.rowId));
        onBarDoubleClick?.(bar.rowId);
      }
    },
    [layout, scrollLeft, scrollTop, send, onBarDoubleClick],
  );

  // Handle wheel for zoom/scroll
  const handleWheel = useCallback(
    (event: React.WheelEvent) => {
      viewport.handleWheel(event.nativeEvent);
    },
    [viewport],
  );

  // Render loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-ss-text-secondary">
        Loading timeline...
      </div>
    );
  }

  // Render error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-ss-error">
        <div>Failed to load timeline</div>
        <div className="text-caption mt-1">{error}</div>
        <button
          onClick={refresh}
          className="mt-4 px-4 py-2 border border-ss-error rounded-ss-sm bg-transparent text-ss-error cursor-pointer hover:bg-ss-error-bg"
        >
          Retry
        </button>
      </div>
    );
  }

  const labelColumnWidth = mergedConfig.labelColumnWidth || 200;
  const timelineStart = mergedConfig.startDate || layout?.minDate || new Date();

  return (
    <div
      ref={containerRef}
      className="timeline-view flex flex-col h-full w-full overflow-hidden outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onDoubleClick={handleDoubleClick}
      onWheel={handleWheel}
    >
      {/* Header row with label column and time axis */}
      <div className="flex flex-shrink-0">
        {/* Label column header */}
        <div
          className="h-12 border-b border-r border-ss-border bg-ss-surface-tertiary flex items-center px-2 font-medium text-ss-text"
          style={{ width: labelColumnWidth }}
        >
          Tasks
        </div>

        {/* Time axis */}
        <TimeAxis
          labels={axisLabels}
          width={viewport.state.viewportWidth - labelColumnWidth}
          height={48}
          scrollLeft={scrollLeft}
          scale={scale as TimelineScale}
          timelineStart={timelineStart}
          showTodayMarker={mergedConfig.showTodayMarker}
          showWeekends={mergedConfig.showWeekends}
        />
      </div>

      {/* Content row with label sidebar and canvas */}
      <div className="flex flex-1 overflow-hidden">
        {/* Label sidebar */}
        <div
          className="overflow-auto border-r border-ss-border"
          style={{ width: labelColumnWidth }}
        >
          {layout?.groups.map((group) => (
            <React.Fragment key={group.key}>
              <TimelineGroupHeader
                groupKey={group.key}
                label={group.label}
                itemCount={group.barCount}
                isCollapsed={group.collapsed}
                onToggle={(key) => send(TimelineEvents.toggleGroup(key))}
              />
              {!group.collapsed &&
                layout.bars
                  .filter((bar) => bar.groupKey === group.key)
                  .map((bar) => (
                    <TimelineRow
                      key={bar.rowId}
                      rowId={bar.rowId}
                      label={bar.title}
                      height={mergedConfig.rowHeight}
                      isSelected={selectedBars.has(bar.rowId)}
                      isFocused={focusedBar === bar.rowId}
                      color={bar.color}
                      onClick={(rowId, event) =>
                        send(
                          TimelineEvents.barClick(rowId, {
                            shiftKey: event.shiftKey,
                            ctrlKey: event.ctrlKey,
                            metaKey: event.metaKey,
                            altKey: event.altKey,
                          }),
                        )
                      }
                      onDoubleClick={onBarDoubleClick}
                    />
                  ))}
            </React.Fragment>
          ))}

          {/* Ungrouped bars */}
          {layout?.bars
            .filter((bar) => !bar.groupKey)
            .map((bar) => (
              <TimelineRow
                key={bar.rowId}
                rowId={bar.rowId}
                label={bar.title}
                height={mergedConfig.rowHeight}
                isSelected={selectedBars.has(bar.rowId)}
                isFocused={focusedBar === bar.rowId}
                color={bar.color}
                onClick={(rowId, event) =>
                  send(
                    TimelineEvents.barClick(rowId, {
                      shiftKey: event.shiftKey,
                      ctrlKey: event.ctrlKey,
                      metaKey: event.metaKey,
                      altKey: event.altKey,
                    }),
                  )
                }
                onDoubleClick={onBarDoubleClick}
              />
            ))}
        </div>

        {/* Canvas area */}
        <div className="flex-1 overflow-auto relative" onMouseDown={handleMouseDown}>
          <TimelineCanvas
            bars={layout?.bars || []}
            groups={layout?.groups || []}
            axisLabels={axisLabels}
            width={Math.max(contentWidth, viewport.state.viewportWidth - labelColumnWidth)}
            height={Math.max(layout?.totalHeight || 0, viewport.state.viewportHeight - 48)}
            scrollLeft={scrollLeft}
            scrollTop={scrollTop}
            scale={scale as TimelineScale}
            selectedBars={selectedBars}
            focusedBar={focusedBar}
            showLabels={true}
            showWeekends={mergedConfig.showWeekends}
            rowHeight={mergedConfig.rowHeight}
            onClick={handleCanvasClick}
            onMouseMove={handleMouseMove}
          />
        </div>
      </div>
    </div>
  );
}
