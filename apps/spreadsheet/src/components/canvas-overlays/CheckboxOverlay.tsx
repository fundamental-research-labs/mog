/**
 * CheckboxOverlay Component
 *
 * Renders an invisible checkbox input positioned over a canvas-rendered checkbox.
 * Toggling this checkbox updates the cell value.
 *
 * This is part of the Canvas Interactive Element Layer architecture:
 * 1. Canvas renders checkboxes visually (fast, efficient)
 * 2. ISheetViewInteractiveElements capability emits element positions each frame
 * 3. This overlay provides the DOM layer for proper input handling
 *
 * @module @mog/spreadsheet/components/canvas-overlays
 */

import { memo, useCallback } from 'react';

import type { InteractiveElementInfo } from '@mog-sdk/sheet-view';
import { useCoordinator } from '../../hooks/shared/use-coordinator';

type CheckboxElement = Extract<InteractiveElementInfo, { type: 'checkbox' }>;

interface CheckboxOverlayProps {
  element: CheckboxElement;
}

/**
 * Renders an invisible checkbox input over the canvas-rendered checkbox.
 * Toggling this checkbox updates the cell value.
 */
export const CheckboxOverlay = memo(function CheckboxOverlay({ element }: CheckboxOverlayProps) {
  const { metadata } = element;
  const { x, y, width, height } = element.bounds;
  const coordinator = useCoordinator();

  const handleChange = useCallback(() => {
    coordinator.grid.toggleCheckbox({ row: metadata.row, col: metadata.col }, metadata.sheetId);
  }, [coordinator, metadata.row, metadata.col, metadata.sheetId]);

  return (
    <input
      type="checkbox"
      checked={metadata.checked}
      onChange={handleChange}
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
        // Reset any default input margins
        margin: 0,
      }}
      aria-label={`Checkbox at row ${metadata.row + 1}, column ${metadata.col + 1}${metadata.checked ? ' (checked)' : ' (unchecked)'}`}
      data-no-grid-pointer="true"
      className="focus:outline focus:outline-2 focus:outline-ss-primary"
    />
  );
});
