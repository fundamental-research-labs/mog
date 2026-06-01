/**
 * ButtonOverlayControl
 *
 * Interactive button form control rendered as an HTML overlay.
 * Shows the button label and triggers a click action.
 *
 * Button actions:
 * - 'setValue': Write clickValue to linked cell
 * - 'increment': Add 1 to current numeric value
 * - 'decrement': Subtract 1 from current numeric value
 * - 'toggle': Toggle boolean value
 * - No action (VBA macro): Button is displayed but disabled
 *
 * @see contracts/src/editor/form-controls.ts - ButtonControl type
 * @module components/canvas-overlays/form-controls
 */

import { memo, useCallback } from 'react';

import type { ButtonControl } from '@mog-sdk/contracts/form-controls';

// =============================================================================
// Types
// =============================================================================

export interface ButtonOverlayControlProps {
  /** The button control definition */
  control: ButtonControl;
  /** Current value from the linked cell (if any) */
  cellValue: unknown;
  /** Rendered width after resolving the anchor cell's current geometry */
  width: number;
  /** Rendered height after resolving the anchor cell's current geometry */
  height: number;
  /** Callback to write a value to the linked cell */
  onCellValueChange: (controlId: string, value: unknown) => void;
}

// =============================================================================
// Component
// =============================================================================

/**
 * Renders an interactive button styled to approximate Excel appearance.
 *
 * If the button has a linkedCellId and clickAction, clicking performs the action.
 * If the button only has an actionId (VBA macro), it renders as disabled since
 * VBA macros cannot execute in the web environment.
 */
export const ButtonOverlayControl = memo(function ButtonOverlayControl({
  control,
  cellValue,
  width,
  height,
  onCellValueChange,
}: ButtonOverlayControlProps) {
  // Button is actionable if it has a linked cell with a click action
  const hasLinkedAction = control.linkedCellId != null && control.clickAction != null;
  // Button with only actionId (VBA macro) cannot execute
  const isDisabled = !control.enabled || (!hasLinkedAction && !control.actionId);

  const handleClick = useCallback(() => {
    if (!control.enabled || !hasLinkedAction) return;

    let newValue: unknown;

    switch (control.clickAction) {
      case 'setValue':
        newValue = control.clickValue;
        break;
      case 'increment':
        newValue = (typeof cellValue === 'number' ? cellValue : 0) + 1;
        break;
      case 'decrement':
        newValue = (typeof cellValue === 'number' ? cellValue : 0) - 1;
        break;
      case 'toggle':
        newValue = !(cellValue === true || cellValue === 'TRUE' || cellValue === 1);
        break;
      default:
        return;
    }

    onCellValueChange(control.id, newValue);
  }, [
    control.id,
    control.enabled,
    control.clickAction,
    control.clickValue,
    cellValue,
    hasLinkedAction,
    onCellValueChange,
  ]);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isDisabled}
      style={{
        width,
        height,
        pointerEvents: 'auto',
        // Excel-like button styling
        backgroundColor: isDisabled ? '#f0f0f0' : '#e1e1e1',
        border: '1px solid #ababab',
        borderRadius: 2,
        fontSize: 11,
        fontFamily: 'Calibri, Arial, sans-serif',
        color: isDisabled ? '#999' : '#333',
        cursor: isDisabled ? 'default' : 'pointer',
        padding: '1px 6px',
        lineHeight: 'normal',
        textAlign: 'center',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
      onMouseDown={(e) => {
        // Prevent focus from leaving the grid
        e.preventDefault();
      }}
      data-no-grid-pointer="true"
      data-testid={`form-control-button-${control.id}`}
      aria-label={control.label}
    >
      {control.label}
    </button>
  );
});
