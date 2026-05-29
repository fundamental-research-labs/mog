/**
 * ComboBoxOverlayControl
 *
 * Interactive dropdown form control rendered as an HTML overlay.
 * Shows items from static list or dynamic range. On selection,
 * writes the selected item text to the linked cell.
 *
 * The linked cell is the SINGLE SOURCE OF TRUTH:
 * - Render: find selected item by matching cell value
 * - Select: write selected item text to linked cell
 *
 * @see contracts/src/editor/form-controls.ts - ComboBoxControl type
 * @module components/canvas-overlays/form-controls
 */

import { memo, useCallback, useMemo, useState } from 'react';

import type { ComboBoxControl } from '@mog-sdk/contracts/form-controls';

// =============================================================================
// Types
// =============================================================================

export interface ComboBoxOverlayControlProps {
  /** The comboBox control definition */
  control: ComboBoxControl;
  /** Current value from the linked cell */
  cellValue: unknown;
  /** Rendered width after resolving the anchor cell's current geometry */
  width: number;
  /** Rendered height after resolving the anchor cell's current geometry */
  height: number;
  /** Resolved items (from static items or dynamic range) */
  resolvedItems: string[];
  /** Callback to write a value to the linked cell */
  onCellValueChange: (controlId: string, value: unknown) => void;
}

// =============================================================================
// Component
// =============================================================================

/**
 * Renders an interactive dropdown styled to approximate Excel appearance.
 *
 * Shows the currently selected item text (matched from the linked cell value).
 * On selection, writes the selected item text to the linked cell.
 */
export const ComboBoxOverlayControl = memo(function ComboBoxOverlayControl({
  control,
  cellValue,
  width,
  height,
  resolvedItems,
  onCellValueChange,
}: ComboBoxOverlayControlProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Find the currently selected value as a string for display
  const currentValueStr = useMemo(() => {
    if (cellValue == null || cellValue === '') return '';
    return String(cellValue);
  }, [cellValue]);

  const handleSelect = useCallback(
    (item: string) => {
      if (!control.enabled) return;
      onCellValueChange(control.id, item);
      setIsOpen(false);
    },
    [control.id, control.enabled, onCellValueChange],
  );

  const handleToggle = useCallback(() => {
    if (!control.enabled) return;
    setIsOpen((prev) => !prev);
  }, [control.enabled]);

  const handleBlur = useCallback(() => {
    // Small delay to allow click on dropdown items to register
    setTimeout(() => setIsOpen(false), 150);
  }, []);

  return (
    <div
      style={{
        position: 'relative',
        width,
        height,
        pointerEvents: 'auto',
      }}
      data-testid={`form-control-combobox-${control.id}`}
      onBlur={handleBlur}
    >
      {/* Trigger button */}
      <button
        type="button"
        onClick={handleToggle}
        disabled={!control.enabled}
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: !control.enabled ? '#f0f0f0' : '#fff',
          border: '1px solid #ababab',
          borderRadius: 2,
          fontSize: 11,
          fontFamily: 'Calibri, Arial, sans-serif',
          color: !control.enabled ? '#999' : '#333',
          cursor: !control.enabled ? 'default' : 'pointer',
          padding: '1px 20px 1px 4px',
          textAlign: 'left',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          // Dropdown arrow indicator
          backgroundImage: control.enabled
            ? "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='4'%3E%3Cpath d='M0 0l4 4 4-4z' fill='%23666'/%3E%3C/svg%3E\")"
            : 'none',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 6px center',
        }}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={control.placeholder ?? 'Select an option'}
      >
        {currentValueStr || control.placeholder || ''}
      </button>

      {/* Dropdown list */}
      {isOpen && resolvedItems.length > 0 && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            width: '100%',
            maxHeight: 200,
            overflowY: 'auto',
            backgroundColor: '#fff',
            border: '1px solid #ababab',
            borderTop: 'none',
            borderRadius: '0 0 2px 2px',
            zIndex: 9999,
            boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
          }}
        >
          {resolvedItems.map((item, index) => (
            <div
              key={index}
              role="option"
              aria-selected={item === currentValueStr}
              onClick={() => handleSelect(item)}
              style={{
                padding: '2px 4px',
                fontSize: 11,
                fontFamily: 'Calibri, Arial, sans-serif',
                cursor: 'pointer',
                backgroundColor: item === currentValueStr ? '#cce5ff' : 'transparent',
                color: '#333',
              }}
              onMouseEnter={(e) => {
                if (item !== currentValueStr) {
                  (e.currentTarget as HTMLElement).style.backgroundColor = '#e8e8e8';
                }
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor =
                  item === currentValueStr ? '#cce5ff' : 'transparent';
              }}
            >
              {item}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
