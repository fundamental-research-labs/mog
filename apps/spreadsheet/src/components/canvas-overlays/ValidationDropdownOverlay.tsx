/**
 * ValidationDropdownOverlay Component
 *
 * Renders an invisible button positioned over a canvas-rendered validation dropdown
 * trigger. Uses Radix Popover to show the list of validation options when clicked.
 *
 * This is part of the Canvas Interactive Element Layer architecture:
 * 1. Canvas renders validation dropdown triggers visually (fast, efficient)
 * 2. ISheetViewInteractiveElements capability emits element positions each frame
 * 3. This overlay provides the DOM layer for Radix Popover integration
 *
 * @module @mog/spreadsheet/components/canvas-overlays
 */

import { memo, useCallback } from 'react';

import type { InteractiveElementInfo } from '@mog-sdk/sheet-view';
import { Popover, PopoverContent, PopoverTrigger } from '@mog/shell/components/ui';

type ValidationDropdownElement = Extract<InteractiveElementInfo, { type: 'validation-dropdown' }>;

interface ValidationDropdownOverlayProps {
  element: ValidationDropdownElement;
}

/**
 * Renders an invisible button over the validation dropdown trigger.
 * Opens a list picker popover with the validation options.
 */
export const ValidationDropdownOverlay = memo(function ValidationDropdownOverlay({
  element,
}: ValidationDropdownOverlayProps) {
  const { metadata } = element;
  const { x, y, width, height } = element.bounds;

  return (
    <Popover>
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
          aria-label={`Dropdown at row ${metadata.row + 1}, column ${metadata.col + 1}`}
          aria-haspopup="listbox"
          data-no-grid-pointer="true"
          className="focus:outline focus:outline-2 focus:outline-ss-primary focus:outline-offset-1"
        />
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={0}
        className="p-0 overflow-hidden"
        style={{ minWidth: '120px', maxHeight: '300px' }}
      >
        {/*
 For now, render a placeholder.
 Full validation dropdown will be integrated later.
 */}
        <ValidationDropdownPlaceholder
          cellId={metadata.cellId}
          options={metadata.options}
          row={metadata.row}
          col={metadata.col}
        />
      </PopoverContent>
    </Popover>
  );
});

/**
 * Temporary placeholder until full validation dropdown is integrated.
 * Shows that the overlay system is working and displays available options.
 */
function ValidationDropdownPlaceholder({
  cellId,
  options,
  row,
  col,
}: {
  cellId: string;
  options: readonly string[];
  row: number;
  col: number;
}) {
  // TODO: Wire this to actual cell mutation
  const handleSelect = useCallback(
    (option: string) => {
      console.log('[ValidationDropdownOverlay] Select option', {
        cellId,
        option,
        row,
        col,
      });
      // Future: Mutations.setCellValue(ctx, sheetId, row, col, option);
    },
    [cellId, row, col],
  );

  return (
    <div className="py-1 bg-ss-surface text-ss-text" role="listbox">
      <div className="px-3 py-1 text-caption text-ss-text-secondary border-b border-ss-border">
        Validation Options ({options.length})
      </div>
      <div className="max-h-[250px] overflow-y-auto">
        {options.slice(0, 20).map((option, i) => (
          <div
            key={i}
            role="option"
            tabIndex={0}
            className="px-3 py-1.5 text-body-sm hover:bg-ss-surface-hover cursor-pointer focus:bg-ss-surface-hover focus:outline-none"
            onClick={() => handleSelect(option)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleSelect(option);
              }
            }}
          >
            {option}
          </div>
        ))}
        {options.length > 20 && (
          <div className="px-3 py-1 text-caption text-ss-text-muted border-t border-ss-border">
            ... and {options.length - 20} more options
          </div>
        )}
      </div>
    </div>
  );
}
