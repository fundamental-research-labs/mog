/**
 * FilterButtonOverlay Component
 *
 * Renders an invisible button positioned over a canvas-rendered filter button.
 * Uses Radix Popover with a REAL DOM trigger, eliminating the need for
 * timing hacks and virtual anchors that plague the current FilterDropdown.
 *
 * This is part of the Canvas Interactive Element Layer architecture:
 * 1. Canvas renders filter buttons visually (fast, efficient)
 * 2. ISheetViewInteractiveElements capability emits element positions each frame
 * 3. This overlay provides the DOM layer for Radix Popover integration
 *
 * KEY INSIGHT: By using a real DOM trigger (not a virtual anchor), Radix's
 * click-outside detection works correctly without the justOpenedRef timing hack.
 *
 * @module @mog/spreadsheet/components/canvas-overlays
 */

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { InteractiveElementInfo } from '@mog-sdk/sheet-view';
import { FilterDropdownContent } from '../filter/FilterDropdownContent';
import { Popover, PopoverContent, PopoverTrigger } from '@mog/shell/components/ui';

type FilterButtonElement = Extract<InteractiveElementInfo, { type: 'filter-button' }>;

const FILTER_POPOVER_MAX_HEIGHT = 620;
const FILTER_POPOVER_MIN_HEIGHT = 180;
const FILTER_POPOVER_VIEWPORT_MARGIN = 8;
const FILTER_POPOVER_DEFAULT_HEIGHT = 'min(620px, calc(100vh - 24px))';

interface FilterButtonOverlayProps {
  element: FilterButtonElement;
}

/**
 * Renders an invisible button positioned over a canvas-rendered filter button.
 * Uses Radix Popover with a REAL DOM trigger, eliminating the need for
 * timing hacks and virtual anchors.
 */
export const FilterButtonOverlay = memo(function FilterButtonOverlay({
  element,
}: FilterButtonOverlayProps) {
  const { metadata } = element;
  const { x, y, width, height } = element.bounds;
  const triggerSize = Math.max(1, Math.min(20, width, height));
  const triggerLeft = x + Math.max(0, width - triggerSize);
  const triggerTop = y + Math.max(0, (height - triggerSize) / 2);

  // Controlled popover state - we manage open/close to pass onClose to content
  const [isOpen, setIsOpen] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [popoverHeight, setPopoverHeight] = useState<string>(FILTER_POPOVER_DEFAULT_HEIGHT);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    originX: number;
    originY: number;
    baseLeft: number;
    baseTop: number;
    width: number;
    height: number;
  } | null>(null);
  const stopDragTrackingRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setDragOffset({ x: 0, y: 0 });
      setPopoverHeight(FILTER_POPOVER_DEFAULT_HEIGHT);
      dragStateRef.current = null;
      stopDragTrackingRef.current?.();
      stopDragTrackingRef.current = null;
    }
  }, [isOpen, metadata.filterId, metadata.headerCellId, x, y]);

  useEffect(() => {
    return () => {
      stopDragTrackingRef.current?.();
    };
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;

    let disposed = false;
    let frame: number | null = null;

    const measure = () => {
      if (disposed) return;

      // Keep the fixed-height flex layout, but cap it to the visible grid viewport.
      const node = Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="filter-dropdown-popover"]'),
      ).find((candidate) => {
        const style = window.getComputedStyle(candidate);
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          candidate.getBoundingClientRect().width > 0 &&
          candidate.getBoundingClientRect().height > 0
        );
      });
      if (!node) return;

      const rect = node.getBoundingClientRect();
      const overlayBottom = triggerRef.current?.parentElement?.getBoundingClientRect().bottom;
      const boundaryBottom = Math.min(overlayBottom ?? window.innerHeight, window.innerHeight);
      const available = boundaryBottom - FILTER_POPOVER_VIEWPORT_MARGIN - rect.top;
      const nextHeight = Math.floor(
        Math.min(FILTER_POPOVER_MAX_HEIGHT, Math.max(FILTER_POPOVER_MIN_HEIGHT, available)),
      );

      setPopoverHeight((current) => {
        const next = `${nextHeight}px`;
        return current === next ? current : next;
      });
    };

    const scheduleMeasure = () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      frame = window.requestAnimationFrame(() => {
        measure();
        frame = window.requestAnimationFrame(measure);
      });
    };

    scheduleMeasure();
    window.addEventListener('resize', scheduleMeasure);

    return () => {
      disposed = true;
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      window.removeEventListener('resize', scheduleMeasure);
    };
  }, [isOpen, metadata.filterId, metadata.headerCellId, triggerLeft, triggerTop, triggerSize]);

  // Close handler passed to FilterDropdownContent
  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  const updateDragOffset = useCallback((event: Pick<PointerEvent, 'clientX' | 'clientY'>) => {
    const drag = dragStateRef.current;
    if (!drag) return;

    const margin = 8;
    const unclampedX = drag.originX + event.clientX - drag.startClientX;
    const unclampedY = drag.originY + event.clientY - drag.startClientY;
    const minX = margin - drag.baseLeft;
    const minY = margin - drag.baseTop;
    const maxX = Math.max(minX, window.innerWidth - margin - drag.baseLeft - drag.width);
    const maxY = Math.max(minY, window.innerHeight - margin - drag.baseTop - drag.height);

    setDragOffset({
      x: Math.min(Math.max(unclampedX, minX), maxX),
      y: Math.min(Math.max(unclampedY, minY), maxY),
    });
  }, []);

  const handleDragPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      stopDragTrackingRef.current?.();
      const handle = event.currentTarget;
      const root = handle.closest<HTMLElement>('[data-testid="filter-dropdown-popover"]');
      const rect = root?.getBoundingClientRect();
      const pointerId = event.pointerId;
      handle.setPointerCapture(pointerId);
      dragStateRef.current = {
        pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        originX: dragOffset.x,
        originY: dragOffset.y,
        baseLeft: rect ? rect.left - dragOffset.x : 0,
        baseTop: rect ? rect.top - dragOffset.y : 0,
        width: rect?.width ?? 0,
        height: rect?.height ?? 0,
      };

      const stopTracking = () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleEnd);
        window.removeEventListener('pointercancel', handleEnd);
        stopDragTrackingRef.current = null;
      };
      const handleMove = (moveEvent: PointerEvent) => {
        if (dragStateRef.current?.pointerId !== moveEvent.pointerId) return;
        moveEvent.preventDefault();
        updateDragOffset(moveEvent);
      };
      const handleEnd = (endEvent: PointerEvent) => {
        if (dragStateRef.current?.pointerId !== endEvent.pointerId) return;
        endEvent.preventDefault();
        dragStateRef.current = null;
        if (handle.hasPointerCapture(pointerId)) {
          handle.releasePointerCapture(pointerId);
        }
        stopTracking();
      };

      window.addEventListener('pointermove', handleMove, { passive: false });
      window.addEventListener('pointerup', handleEnd, { passive: false });
      window.addEventListener('pointercancel', handleEnd, { passive: false });
      stopDragTrackingRef.current = stopTracking;
    },
    [dragOffset.x, dragOffset.y, updateDragOffset],
  );

  const handleDragPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (dragStateRef.current?.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      updateDragOffset(event.nativeEvent);
    },
    [updateDragOffset],
  );

  const handleDragPointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    dragStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    stopDragTrackingRef.current?.();
  }, []);

  // 0-based column index is now directly provided in metadata.col.
  // Derive a column letter label for aria-label (A=0, B=1, ...).
  const columnIndex = metadata?.col ?? null;

  const columnLabel = (() => {
    if (columnIndex === null) return 'column';
    let n = columnIndex + 1;
    let label = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      label = String.fromCharCode(65 + rem) + label;
      n = Math.floor((n - 1) / 26);
    }
    return label;
  })();

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          style={{
            position: 'absolute',
            left: triggerLeft,
            top: triggerTop,
            width: triggerSize,
            height: triggerSize,
            // Invisible but clickable
            opacity: 0,
            cursor: 'pointer',
            // Enable pointer events on this element (parent has pointer-events-none)
            pointerEvents: 'auto',
            // Reset default button styles
            border: 'none',
            background: 'transparent',
            padding: 0,
            margin: 0,
          }}
          aria-label={`Filter ${columnLabel}${metadata.hasActiveFilter ? ' (filtered)' : ''}`}
          aria-haspopup="dialog"
          data-no-grid-pointer="true"
          data-testid={columnIndex !== null ? `column-filter-${columnIndex}` : undefined}
          className="focus:outline focus:outline-2 focus:outline-ss-primary focus:outline-offset-1"
        />
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={4}
        className="flex flex-col p-0 overflow-hidden"
        style={{
          width: '280px',
          height: popoverHeight,
          maxHeight: popoverHeight,
          translate: `${dragOffset.x}px ${dragOffset.y}px`,
        }}
        disableScrollConstraints
        data-no-grid-pointer="true"
        data-testid="filter-dropdown-popover"
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') {
            event.stopPropagation();
          }
        }}
      >
        <div
          data-testid="filter-popover-drag-handle"
          aria-label="Move filter popover"
          className="flex h-5 cursor-move items-center justify-center border-b border-ss-border bg-ss-surface text-ss-text-secondary"
          style={{ touchAction: 'none' }}
          onPointerDown={handleDragPointerDown}
          onPointerMove={handleDragPointerMove}
          onPointerUp={handleDragPointerEnd}
          onPointerCancel={handleDragPointerEnd}
        >
          <span aria-hidden="true" className="text-caption leading-none tracking-normal">
            ::
          </span>
        </div>
        {/*
 Real filter dropdown content with all functionality.
 The key insight: this Popover is triggered by a REAL button,
 so Radix's click-outside detection works correctly without timing hacks.
 */}
        <FilterDropdownContent
          filterId={metadata.filterId}
          headerCellId={metadata.headerCellId}
          col={metadata.col}
          hasActiveFilter={metadata.hasActiveFilter}
          onClose={handleClose}
        />
      </PopoverContent>
    </Popover>
  );
});
