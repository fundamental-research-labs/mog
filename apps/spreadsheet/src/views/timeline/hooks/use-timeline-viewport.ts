/**
 * useTimelineViewport Hook
 *
 * Manages viewport state for the timeline view including:
 * - Pan (horizontal scrolling)
 * - Zoom (scale changes)
 * - Scroll synchronization with canvas
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TimelineScale } from '../config';
import { dateToPixels, pixelsToDate } from '../utils/date-utils';

/**
 * Viewport state for the timeline.
 */
export interface TimelineViewportState {
  /** Horizontal scroll position in pixels */
  scrollLeft: number;
  /** Vertical scroll position in pixels */
  scrollTop: number;
  /** Current time scale */
  scale: TimelineScale;
  /** Start date of the visible viewport */
  viewportStart: Date;
  /** Viewport width in pixels */
  viewportWidth: number;
  /** Viewport height in pixels */
  viewportHeight: number;
}

/**
 * Options for the useTimelineViewport hook.
 */
export interface UseTimelineViewportOptions {
  /** Initial scale */
  initialScale?: TimelineScale;
  /** Initial viewport start date */
  initialStartDate?: Date;
  /** Minimum scroll position */
  minScrollLeft?: number;
  /** Maximum scroll position (content width) */
  maxScrollLeft?: number;
  /** Callback when viewport changes */
  onViewportChange?: (state: TimelineViewportState) => void;
}

/**
 * Result of the useTimelineViewport hook.
 */
export interface UseTimelineViewportResult {
  /** Current viewport state */
  state: TimelineViewportState;
  /** Set scroll position */
  setScroll: (scrollLeft: number, scrollTop: number) => void;
  /** Set scale (zoom level) */
  setScale: (scale: TimelineScale) => void;
  /** Pan by a delta in pixels */
  pan: (deltaX: number) => void;
  /** Zoom in or out */
  zoom: (direction: 'in' | 'out', centerX?: number) => void;
  /** Scroll to a specific date */
  scrollToDate: (date: Date, alignment?: 'start' | 'center' | 'end') => void;
  /** Set viewport dimensions (call on resize) */
  setViewportDimensions: (width: number, height: number) => void;
  /** Handle mouse wheel for zoom/pan */
  handleWheel: (event: WheelEvent) => void;
  /** Start a pan gesture */
  startPan: (x: number) => { move: (x: number) => void; end: () => void };
}

const SCALE_ORDER: TimelineScale[] = ['day', 'week', 'month', 'quarter', 'year'];

/**
 * Hook for managing timeline viewport state.
 */
export function useTimelineViewport(
  options: UseTimelineViewportOptions = {},
): UseTimelineViewportResult {
  const {
    initialScale = 'day',
    initialStartDate = new Date(),
    minScrollLeft = 0,
    maxScrollLeft = 10000,
    onViewportChange,
  } = options;

  const [state, setState] = useState<TimelineViewportState>({
    scrollLeft: 0,
    scrollTop: 0,
    scale: initialScale,
    viewportStart: initialStartDate,
    viewportWidth: 0,
    viewportHeight: 0,
  });

  // Track pan gesture
  const panRef = useRef<{ startX: number; startScrollLeft: number } | null>(null);

  // Notify on viewport change
  useEffect(() => {
    onViewportChange?.(state);
  }, [state, onViewportChange]);

  // Set scroll position
  const setScroll = useCallback(
    (scrollLeft: number, scrollTop: number) => {
      setState((prev) => ({
        ...prev,
        scrollLeft: Math.max(minScrollLeft, Math.min(maxScrollLeft, scrollLeft)),
        scrollTop: Math.max(0, scrollTop),
      }));
    },
    [minScrollLeft, maxScrollLeft],
  );

  // Set scale
  const setScale = useCallback((scale: TimelineScale) => {
    setState((prev) => {
      // Adjust scroll to maintain approximate center position
      const centerDate = pixelsToDate(
        prev.scrollLeft + prev.viewportWidth / 2,
        prev.viewportStart,
        prev.scale,
      );
      const newCenterX = dateToPixels(centerDate, prev.viewportStart, scale);
      const newScrollLeft = Math.max(0, newCenterX - prev.viewportWidth / 2);

      return {
        ...prev,
        scale,
        scrollLeft: newScrollLeft,
      };
    });
  }, []);

  // Pan by delta
  const pan = useCallback(
    (deltaX: number) => {
      setState((prev) => ({
        ...prev,
        scrollLeft: Math.max(minScrollLeft, Math.min(maxScrollLeft, prev.scrollLeft + deltaX)),
      }));
    },
    [minScrollLeft, maxScrollLeft],
  );

  // Zoom in or out
  const zoom = useCallback((direction: 'in' | 'out', centerX?: number) => {
    setState((prev) => {
      const currentIndex = SCALE_ORDER.indexOf(prev.scale);
      let newIndex = currentIndex;

      if (direction === 'in' && currentIndex > 0) {
        newIndex = currentIndex - 1;
      } else if (direction === 'out' && currentIndex < SCALE_ORDER.length - 1) {
        newIndex = currentIndex + 1;
      }

      if (newIndex === currentIndex) {
        return prev;
      }

      const newScale = SCALE_ORDER[newIndex];

      // Maintain center position during zoom
      const zoomCenter = centerX ?? prev.scrollLeft + prev.viewportWidth / 2;
      const centerDate = pixelsToDate(zoomCenter, prev.viewportStart, prev.scale);
      const newCenterX = dateToPixels(centerDate, prev.viewportStart, newScale);
      const newScrollLeft = Math.max(
        0,
        newCenterX - (centerX ? centerX - prev.scrollLeft : prev.viewportWidth / 2),
      );

      return {
        ...prev,
        scale: newScale,
        scrollLeft: newScrollLeft,
      };
    });
  }, []);

  // Scroll to a specific date
  const scrollToDate = useCallback(
    (date: Date, alignment: 'start' | 'center' | 'end' = 'center') => {
      setState((prev) => {
        const dateX = dateToPixels(date, prev.viewportStart, prev.scale);
        let newScrollLeft: number;

        switch (alignment) {
          case 'start':
            newScrollLeft = dateX;
            break;
          case 'center':
            newScrollLeft = dateX - prev.viewportWidth / 2;
            break;
          case 'end':
            newScrollLeft = dateX - prev.viewportWidth;
            break;
        }

        return {
          ...prev,
          scrollLeft: Math.max(minScrollLeft, Math.min(maxScrollLeft, newScrollLeft)),
        };
      });
    },
    [minScrollLeft, maxScrollLeft],
  );

  // Set viewport dimensions
  const setViewportDimensions = useCallback((width: number, height: number) => {
    setState((prev) => ({
      ...prev,
      viewportWidth: width,
      viewportHeight: height,
    }));
  }, []);

  // Handle mouse wheel for zoom/pan
  const handleWheel = useCallback(
    (event: WheelEvent) => {
      event.preventDefault();

      if (event.ctrlKey || event.metaKey) {
        // Zoom with Ctrl+Wheel
        const direction = event.deltaY < 0 ? 'in' : 'out';
        // Get cursor position relative to viewport
        const target = event.currentTarget as HTMLElement;
        const rect = target.getBoundingClientRect();
        const centerX = event.clientX - rect.left + state.scrollLeft;
        zoom(direction, centerX);
      } else if (event.shiftKey) {
        // Horizontal scroll with Shift+Wheel
        pan(event.deltaY);
      } else {
        // Normal scroll (vertical for deltaY, horizontal for deltaX)
        setScroll(state.scrollLeft + (event.deltaX || 0), state.scrollTop + (event.deltaY || 0));
      }
    },
    [state.scrollLeft, state.scrollTop, zoom, pan, setScroll],
  );

  // Start a pan gesture
  const startPan = useCallback(
    (x: number) => {
      panRef.current = {
        startX: x,
        startScrollLeft: state.scrollLeft,
      };

      return {
        move: (newX: number) => {
          if (!panRef.current) return;
          const deltaX = panRef.current.startX - newX;
          const newScrollLeft = panRef.current.startScrollLeft + deltaX;
          setScroll(newScrollLeft, state.scrollTop);
        },
        end: () => {
          panRef.current = null;
        },
      };
    },
    [state.scrollLeft, state.scrollTop, setScroll],
  );

  return {
    state,
    setScroll,
    setScale,
    pan,
    zoom,
    scrollToDate,
    setViewportDimensions,
    handleWheel,
    startPan,
  };
}
