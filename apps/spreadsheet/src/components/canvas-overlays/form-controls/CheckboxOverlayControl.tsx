/**
 * CheckboxOverlayControl
 *
 * Interactive checkbox form control rendered as an HTML overlay.
 * Reads checked state from the linked cell and writes on toggle.
 *
 * The linked cell is the SINGLE SOURCE OF TRUTH:
 * - Render: checked = cell value is truthy (TRUE, true, 1)
 * - Toggle: write !checked to linked cell via computeBridge
 *
 * @see contracts/src/editor/form-controls.ts - CheckboxControl type
 * @module components/canvas-overlays/form-controls
 */

import { memo, useCallback } from 'react';

import type { CheckboxControl } from '@mog-sdk/contracts/form-controls';

// =============================================================================
// Types
// =============================================================================

export interface CheckboxOverlayControlProps {
  /** The checkbox control definition */
  control: CheckboxControl;
  /** Current value from the linked cell */
  cellValue: unknown;
  /** Rendered width after resolving the anchor cell's current geometry */
  width: number;
  /** Rendered height after resolving the anchor cell's current geometry */
  height: number;
  /** Callback to write a value to the linked cell */
  onCellValueChange: (controlId: string, value: unknown) => void;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Determine checked state from cell value.
 * Matches Excel behavior: TRUE, true, 1 -> checked; everything else -> unchecked.
 */
function isChecked(value: unknown): boolean {
  if (value === true) return true;
  if (value === 'TRUE' || value === 'true') return true;
  if (value === 1) return true;
  return false;
}

// =============================================================================
// Component
// =============================================================================

/**
 * Renders an interactive checkbox styled to approximate Excel appearance.
 *
 * On toggle, writes the opposite boolean value to the linked cell.
 * Uses checkedValue/uncheckedValue if specified on the control,
 * otherwise defaults to true/false.
 */
export const CheckboxOverlayControl = memo(function CheckboxOverlayControl({
  control,
  cellValue,
  width,
  height,
  onCellValueChange,
}: CheckboxOverlayControlProps) {
  const checked = isChecked(cellValue);

  const handleChange = useCallback(() => {
    if (!control.enabled) return;

    const newValue = checked ? (control.uncheckedValue ?? false) : (control.checkedValue ?? true);

    onCellValueChange(control.id, newValue);
  }, [
    control.id,
    control.enabled,
    control.checkedValue,
    control.uncheckedValue,
    checked,
    onCellValueChange,
  ]);

  return (
    <div
      className="flex items-center gap-1"
      style={{
        width,
        height,
        pointerEvents: 'auto',
        justifyContent: control.label ? 'flex-start' : 'center',
        overflow: 'hidden',
      }}
      data-testid={`form-control-checkbox-${control.id}`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={handleChange}
        disabled={!control.enabled}
        style={{
          width: 14,
          height: 14,
          margin: 0,
          cursor: control.enabled ? 'pointer' : 'default',
          accentColor: '#217346', // Excel green
        }}
        aria-label={
          control.label
            ? `${control.label}${checked ? ' (checked)' : ' (unchecked)'}`
            : `Checkbox${checked ? ' (checked)' : ' (unchecked)'}`
        }
      />
      {control.label && (
        <span
          className="text-xs select-none truncate"
          style={{
            color: control.enabled ? '#333' : '#999',
            lineHeight: `${height}px`,
          }}
        >
          {control.label}
        </span>
      )}
    </div>
  );
});
