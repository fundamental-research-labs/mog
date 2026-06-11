/**
 * ScrollContainer Component
 *
 * Custom scrollbar implementation that reads scroll position from InputCoordinator
 * and feeds drag input back into InputCoordinator.scrollTo().
 *
 * Architecture:
 * - NO native overflow:scroll divs — eliminates DOM scroll state and re-entrancy
 * - Scrollbar position is derived from InputCoordinator (single source of truth)
 * - Thumb drag feeds back into InputCoordinator.scrollTo()
 * - Track click triggers page-sized scroll
 * - Auto-hide with fade via CSS opacity transition
 * - Split box stubs preserved for future split view feature
 * - Dynamic scroll expansion: grows range as user scrolls near edge (Excel-style)
 * - Physics bounds sync: keeps scroll physics aligned with scrollbar UI
 *
 */

import {
  DEFAULT_COL_WIDTH,
  DEFAULT_ROW_HEIGHT,
  SCROLL_BAR_WIDTH,
} from '@mog-sdk/contracts/rendering';
import { useCallback, useEffect, useRef, useState } from 'react';

import { SCROLL_BUFFER_COLS, SCROLL_BUFFER_ROWS } from '../hooks/useScrollDimensions';
import { useCoordinator } from '../../../hooks/shared/use-coordinator';

export interface ScrollContainerProps {
  workbookSettings: {
    showVerticalScrollbar: boolean;
    showHorizontalScrollbar: boolean;
    autoHideScrollBars?: boolean;
  };
  /** Total scrollable content width (px) — base used-range content size */
  scrollWidth: number;
  /** Total scrollable content height (px) — base used-range content size */
  scrollHeight: number;
}

/** Minimum thumb size in px to keep it grabbable */
const MIN_THUMB_SIZE = 24;
const EDGE_SNAP_PX = 4;
export const SCROLLBAR_TRACK_COLOR = 'var(--scrollbar-track, rgba(0, 0, 0, 0.04))';
export const SCROLLBAR_TRACK_BORDER_COLOR = 'var(--scrollbar-track-border, rgba(0, 0, 0, 0.08))';

export function getScrollbarThumbColor(isDragging: boolean): string {
  return isDragging
    ? 'var(--scrollbar-thumb-active, rgba(0, 0, 0, 0.5))'
    : 'var(--scrollbar-thumb, rgba(0, 0, 0, 0.3))';
}

/** Excel maximum dimensions */
const MAX_HEIGHT = 1_048_576 * DEFAULT_ROW_HEIGHT;
const MAX_WIDTH = 16_384 * DEFAULT_COL_WIDTH;

/** Buffer in pixels to keep ahead of scroll position during expansion */
const SCROLL_HEADROOM_Y = SCROLL_BUFFER_ROWS * DEFAULT_ROW_HEIGHT;
const SCROLL_HEADROOM_X = SCROLL_BUFFER_COLS * DEFAULT_COL_WIDTH;

/**
 * Compute continuously expanded content dimensions.
 *
 * Instead of threshold-triggered discrete expansion, this function ensures
 * the expanded range always extends beyond the current scroll position by
 * at least viewport + headroom. As scrollY increases by 1px, expandedHeight
 * increases by 1px — yielding a smooth, continuous thumb position.
 *
 * Expansion is bidirectional: it grows when scrolling down and contracts
 * when scrolling back up. The formula scrollY/(scrollY+headroom) is smooth
 * and continuous in both directions, so no high-water mark is needed.
 *
 * @returns New expanded dimensions (always >= base, <= MAX)
 */
export function computeContinuousExpansion(
  baseWidth: number,
  baseHeight: number,
  scrollX: number,
  scrollY: number,
  viewportWidth: number,
  viewportHeight: number,
): { width: number; height: number } {
  // Height: max of base and scroll position + headroom
  const neededHeight = scrollY + viewportHeight + SCROLL_HEADROOM_Y;
  const height = Math.min(MAX_HEIGHT, Math.max(baseHeight, neededHeight));

  // Width: same continuous logic
  const neededWidth = scrollX + viewportWidth + SCROLL_HEADROOM_X;
  const width = Math.min(MAX_WIDTH, Math.max(baseWidth, neededWidth));

  return { width, height };
}

export function computeScrollbarDragPosition(params: {
  pointerPosition: number;
  trackStart: number;
  thumbPointerOffset: number;
  scrollableTrack: number;
  maxScroll: number;
  edgeSnapPx?: number;
}): number {
  const rawThumbOffset = params.pointerPosition - params.trackStart - params.thumbPointerOffset;
  const nextThumbOffset = Math.max(0, Math.min(params.scrollableTrack, rawThumbOffset));
  const edgeSnapPx = params.edgeSnapPx ?? EDGE_SNAP_PX;
  if (nextThumbOffset <= edgeSnapPx) return 0;
  if (nextThumbOffset >= params.scrollableTrack - edgeSnapPx) return params.maxScroll;
  return params.scrollableTrack > 0
    ? (nextThumbOffset / params.scrollableTrack) * params.maxScroll
    : 0;
}

/**
 * ScrollContainer - Custom scrollbars driven by InputCoordinator state.
 *
 * No native overflow:scroll divs. No DOM scroll state. No re-entrancy.
 * Scrollbar position is a pure function of InputCoordinator scroll state.
 */
export function ScrollContainer({
  workbookSettings,
  scrollWidth: baseScrollWidth,
  scrollHeight: baseScrollHeight,
}: ScrollContainerProps) {
  const coordinator = useCoordinator();
  const inputCoordinator = coordinator.input.inputCoordinator;

  // Current scroll position from InputCoordinator
  const [scrollX, setScrollX] = useState(0);
  const [scrollY, setScrollY] = useState(0);

  // Auto-hide state
  const [isActive, setIsActive] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const autoHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoHideEnabled = workbookSettings.autoHideScrollBars ?? false;

  // Subscribe to scroll changes from InputCoordinator
  useEffect(() => {
    const unsubscribe = inputCoordinator.onScrollChange((state) => {
      setScrollX(state.x);
      setScrollY(state.y);

      // Show scrollbar on any scroll activity
      if (autoHideEnabled) {
        setIsActive(true);
        if (autoHideTimeoutRef.current) clearTimeout(autoHideTimeoutRef.current);
        autoHideTimeoutRef.current = setTimeout(() => setIsActive(false), 1000);
      }
    });

    // Read initial position
    const initial = inputCoordinator.getScrollState();
    setScrollX(initial.x);
    setScrollY(initial.y);

    return () => {
      unsubscribe();
      if (autoHideTimeoutRef.current) clearTimeout(autoHideTimeoutRef.current);
    };
  }, [inputCoordinator, autoHideEnabled]);

  // Get viewport dimensions for thumb size calculation
  const viewportCapability = coordinator.renderer.getViewport();
  const viewportBounds = viewportCapability?.getViewportBounds();
  const viewportWidth = viewportBounds?.width ?? 0;
  const viewportHeight = viewportBounds?.height ?? 0;

  // Continuous expansion — grow/shrink content area smoothly as user scrolls
  const { width: scrollWidth, height: scrollHeight } = computeContinuousExpansion(
    baseScrollWidth,
    baseScrollHeight,
    scrollX,
    scrollY,
    viewportWidth,
    viewportHeight,
  );

  // Compute scroll bounds for thumb positioning
  const maxScrollX = Math.max(0, scrollWidth - viewportWidth);
  const maxScrollY = Math.max(0, scrollHeight - viewportHeight);

  // Sync physics bounds with scrollbar UI
  // This ensures InputCoordinator's scroll physics uses the same bounds
  // as the scrollbar, preventing thumb drift.
  useEffect(() => {
    inputCoordinator.setContentScrollBounds(maxScrollX, maxScrollY);
  }, [inputCoordinator, maxScrollX, maxScrollY]);

  // Scrollbar visibility (auto-hide: visible if scrolling, hovered, or not auto-hide)
  const isVisible = !autoHideEnabled || isActive || isHovered;

  return (
    <>
      {/* Vertical scrollbar */}
      {workbookSettings.showVerticalScrollbar && maxScrollY > 0 && (
        <ScrollbarTrack
          orientation="vertical"
          scrollPosition={scrollY}
          maxScroll={maxScrollY}
          viewportSize={viewportHeight}
          contentSize={scrollHeight}
          isVisible={isVisible}
          onScroll={(position) => inputCoordinator.scrollTo(scrollX, position)}
          onHoverChange={setIsHovered}
        />
      )}

      {/* Split Box - Vertical (placeholder for future split view) */}
      {workbookSettings.showVerticalScrollbar && (
        <div
          className="split-box-vertical absolute pointer-events-auto"
          style={{
            top: 0,
            right: 0,
            width: SCROLL_BAR_WIDTH,
            height: 8,
            cursor: 'row-resize',
            backgroundColor: 'var(--surface-secondary, #e0e0e0)',
            borderBottom: '1px solid var(--border, #ccc)',
            zIndex: 10,
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            console.log('[SpreadsheetGrid] Split view not yet implemented (vertical split box)');
          }}
          title="Split view coming soon"
        />
      )}

      {/* Horizontal scrollbar */}
      {workbookSettings.showHorizontalScrollbar && maxScrollX > 0 && (
        <ScrollbarTrack
          orientation="horizontal"
          scrollPosition={scrollX}
          maxScroll={maxScrollX}
          viewportSize={viewportWidth}
          contentSize={scrollWidth}
          isVisible={isVisible}
          onScroll={(position) => inputCoordinator.scrollTo(position, scrollY)}
          onHoverChange={setIsHovered}
        />
      )}

      {/* Split Box - Horizontal (placeholder for future split view) */}
      {workbookSettings.showHorizontalScrollbar && (
        <div
          className="split-box-horizontal absolute pointer-events-auto"
          style={{
            bottom: 0,
            left: 0,
            width: 8,
            height: SCROLL_BAR_WIDTH,
            cursor: 'col-resize',
            backgroundColor: 'var(--surface-secondary, #e0e0e0)',
            borderRight: '1px solid var(--border, #ccc)',
            zIndex: 10,
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            console.log('[SpreadsheetGrid] Split view not yet implemented (horizontal split box)');
          }}
          title="Split view coming soon"
        />
      )}
    </>
  );
}

// =============================================================================
// ScrollbarTrack — individual scrollbar (vertical or horizontal)
// =============================================================================

interface ScrollbarTrackProps {
  orientation: 'vertical' | 'horizontal';
  scrollPosition: number;
  maxScroll: number;
  viewportSize: number;
  contentSize: number;
  isVisible: boolean;
  onScroll: (position: number) => void;
  onHoverChange: (hovered: boolean) => void;
}

function ScrollbarTrack({
  orientation,
  scrollPosition,
  maxScroll,
  viewportSize,
  contentSize,
  isVisible,
  onScroll,
  onHoverChange,
}: ScrollbarTrackProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ thumbPointerOffset: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const isVertical = orientation === 'vertical';

  // Compute thumb geometry
  const trackLength = isVertical ? viewportHeightFn(viewportSize) : viewportWidthFn(viewportSize);
  const thumbRatio = contentSize > 0 ? viewportSize / contentSize : 1;
  const thumbSize = Math.max(MIN_THUMB_SIZE, Math.round(trackLength * thumbRatio));
  const scrollableTrack = trackLength - thumbSize;
  const rawThumbOffset =
    maxScroll > 0 ? Math.round((scrollPosition / maxScroll) * scrollableTrack) : 0;

  // Clamp thumb position — safety net so thumb never leaves the track
  const thumbOffset = Math.max(0, Math.min(rawThumbOffset, scrollableTrack));

  // Pointer drag on thumb
  const handleThumbPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      isDraggingRef.current = true;
      setIsDragging(true);
      const thumbRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      dragStartRef.current = {
        thumbPointerOffset: isVertical ? e.clientY - thumbRect.top : e.clientX - thumbRect.left,
      };
    },
    [isVertical],
  );

  const handleThumbPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDraggingRef.current) return;
      const track = trackRef.current;
      if (!track) return;
      const trackRect = track.getBoundingClientRect();
      const newPosition = computeScrollbarDragPosition({
        pointerPosition: isVertical ? e.clientY : e.clientX,
        trackStart: isVertical ? trackRect.top : trackRect.left,
        thumbPointerOffset: dragStartRef.current.thumbPointerOffset,
        scrollableTrack,
        maxScroll,
      });
      onScroll(newPosition);
    },
    [isVertical, scrollableTrack, maxScroll, onScroll],
  );

  const finishThumbDrag = useCallback((e: React.PointerEvent) => {
    isDraggingRef.current = false;
    setIsDragging(false);
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* release is best-effort */
    }
  }, []);

  // Click on track → page scroll in that direction
  const handleTrackClick = useCallback(
    (e: React.MouseEvent) => {
      const track = trackRef.current;
      if (!track) return;

      const rect = track.getBoundingClientRect();
      const clickPos = isVertical ? e.clientY - rect.top : e.clientX - rect.left;
      const thumbCenter = thumbOffset + thumbSize / 2;

      // Scroll by one viewport page in the direction of the click
      const pageSize = viewportSize * 0.9;
      const direction = clickPos < thumbCenter ? -1 : 1;
      const newPosition = Math.max(0, Math.min(maxScroll, scrollPosition + direction * pageSize));
      onScroll(newPosition);
    },
    [isVertical, thumbOffset, thumbSize, viewportSize, maxScroll, scrollPosition, onScroll],
  );

  // Track positioning styles
  const trackStyle: React.CSSProperties = isVertical
    ? {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: SCROLL_BAR_WIDTH,
        width: SCROLL_BAR_WIDTH,
        boxSizing: 'border-box',
        backgroundColor: SCROLLBAR_TRACK_COLOR,
        borderLeft: `1px solid ${SCROLLBAR_TRACK_BORDER_COLOR}`,
        opacity: isVisible ? 1 : 0,
        transition: 'opacity 0.3s ease',
      }
    : {
        position: 'absolute',
        left: 0,
        bottom: 0,
        right: SCROLL_BAR_WIDTH,
        height: SCROLL_BAR_WIDTH,
        boxSizing: 'border-box',
        backgroundColor: SCROLLBAR_TRACK_COLOR,
        borderTop: `1px solid ${SCROLLBAR_TRACK_BORDER_COLOR}`,
        opacity: isVisible ? 1 : 0,
        transition: 'opacity 0.3s ease',
      };

  // Thumb positioning styles
  const thumbStyle: React.CSSProperties = isVertical
    ? {
        position: 'absolute',
        top: thumbOffset,
        left: 2,
        right: 2,
        height: thumbSize,
        borderRadius: 4,
        backgroundColor: getScrollbarThumbColor(isDragging),
        cursor: 'pointer',
      }
    : {
        position: 'absolute',
        left: thumbOffset,
        top: 2,
        bottom: 2,
        width: thumbSize,
        borderRadius: 4,
        backgroundColor: getScrollbarThumbColor(isDragging),
        cursor: 'pointer',
      };

  return (
    <div
      ref={trackRef}
      className="pointer-events-auto"
      style={trackStyle}
      onClick={handleTrackClick}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
    >
      <div
        style={thumbStyle}
        onPointerDown={handleThumbPointerDown}
        onPointerMove={handleThumbPointerMove}
        onPointerUp={finishThumbDrag}
        onPointerCancel={finishThumbDrag}
        onClick={(e) => e.stopPropagation()} // Don't trigger track click
      />
    </div>
  );
}

// =============================================================================
// Helpers — track length accounting for scrollbar intersection area
// =============================================================================

/** Effective vertical track length (full height minus horizontal scrollbar) */
function viewportHeightFn(viewportSize: number): number {
  return Math.max(0, viewportSize - SCROLL_BAR_WIDTH);
}

/** Effective horizontal track length (full width minus vertical scrollbar) */
function viewportWidthFn(viewportSize: number): number {
  return Math.max(0, viewportSize - SCROLL_BAR_WIDTH);
}
