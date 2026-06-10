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

import { memo, useCallback, type SyntheticEvent } from 'react';

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
  /** Linked cell position for DOM readbacks and app-eval probes. */
  linkedCellPosition?: { row: number; col: number };
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
  linkedCellPosition,
}: CheckboxOverlayControlProps) {
  const checked = isChecked(cellValue);
  const hasLabel = Boolean(control.label);

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

  const stopGridEventPropagation = useCallback((event: SyntheticEvent) => {
    event.stopPropagation();
  }, []);

  return (
    <div
      className={hasLabel ? 'flex items-center gap-1' : 'flex items-center justify-center'}
      style={{
        width,
        height,
        pointerEvents: 'auto',
        overflow: 'hidden',
        backgroundColor: hasLabel ? undefined : 'var(--color-ss-bg, #fff)',
      }}
      data-no-grid-pointer="true"
      data-testid={`form-control-checkbox-${control.id}`}
      data-form-control-linked-row={linkedCellPosition?.row}
      data-form-control-linked-col={linkedCellPosition?.col}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={handleChange}
        onPointerDown={stopGridEventPropagation}
        onMouseDown={stopGridEventPropagation}
        onMouseUp={stopGridEventPropagation}
        onClick={stopGridEventPropagation}
        onDoubleClick={stopGridEventPropagation}
        onKeyDown={stopGridEventPropagation}
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
      {hasLabel && (
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
