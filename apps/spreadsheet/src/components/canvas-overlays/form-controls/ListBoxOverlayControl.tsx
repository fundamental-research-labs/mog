/**
 * ListBoxOverlayControl
 *
 * Visible list-box form control rendered as an HTML overlay.
 */

import { memo, useCallback, useMemo, type ChangeEvent } from 'react';

import type { ListBoxControl } from '@mog-sdk/contracts/form-controls';

export interface ListBoxOverlayControlProps {
  control: ListBoxControl;
  cellValue: unknown;
  width: number;
  height: number;
  resolvedItems: string[];
  onCellValueChange: (controlId: string, value: unknown) => void;
}

export const ListBoxOverlayControl = memo(function ListBoxOverlayControl({
  control,
  cellValue,
  width,
  height,
  resolvedItems,
  onCellValueChange,
}: ListBoxOverlayControlProps) {
  const currentValue = useMemo(() => {
    if (cellValue == null || cellValue === '') return '';
    return String(cellValue);
  }, [cellValue]);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      if (!control.enabled) return;
      onCellValueChange(control.id, event.currentTarget.value);
    },
    [control.enabled, control.id, onCellValueChange],
  );

  return (
    <select
      value={currentValue}
      size={Math.max(2, Math.min(8, resolvedItems.length || 4))}
      disabled={!control.enabled}
      onChange={handleChange}
      style={{
        width,
        height,
        pointerEvents: 'auto',
        backgroundColor: !control.enabled ? '#f0f0f0' : '#fff',
        border: '1px solid #ababab',
        borderRadius: 2,
        fontSize: 11,
        fontFamily: 'Calibri, Arial, sans-serif',
        color: !control.enabled ? '#999' : '#333',
        padding: 1,
        overflowY: 'auto',
      }}
      data-testid={`form-control-listbox-${control.id}`}
      aria-label={control.name ?? 'List box'}
    >
      {resolvedItems.map((item, index) => (
        <option key={`${item}-${index}`} value={item}>
          {item}
        </option>
      ))}
    </select>
  );
});
