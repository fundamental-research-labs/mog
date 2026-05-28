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

import { memo, useCallback, useState } from 'react';

import type { InteractiveElementInfo } from '@mog-sdk/sheet-view';
import { FilterDropdownContent } from '../filter/FilterDropdownContent';
import { Popover, PopoverContent, PopoverTrigger } from '@mog/shell/components/ui';

type FilterButtonElement = Extract<InteractiveElementInfo, { type: 'filter-button' }>;

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

  // Controlled popover state - we manage open/close to pass onClose to content
  const [isOpen, setIsOpen] = useState(false);

  // Close handler passed to FilterDropdownContent
  const handleClose = useCallback(() => {
    setIsOpen(false);
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
          type="button"
          style={{
            position: 'absolute',
            left: x,
            top: y,
            width: width,
            height: height,
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
          data-testid={columnIndex !== null ? `column-filter-${columnIndex}` : undefined}
          className="focus:outline focus:outline-2 focus:outline-ss-primary focus:outline-offset-1"
        />
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={4}
        className="p-0 overflow-x-hidden overflow-y-auto"
        style={{
          width: '280px',
          maxHeight: 'min(450px, var(--radix-popper-available-height, calc(100vh - 24px)))',
        }}
        data-testid="filter-dropdown-popover"
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') {
            event.stopPropagation();
          }
        }}
      >
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
