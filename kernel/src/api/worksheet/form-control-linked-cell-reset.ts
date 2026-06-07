import type { CellValuePrimitive } from '@mog-sdk/contracts/core';
import type { FormControl } from '@mog-sdk/contracts/form-controls';

export function formControlLinkedCellResetValue(
  control: FormControl,
): CellValuePrimitive | undefined {
  switch (control.type) {
    case 'checkbox':
      return false;
    case 'comboBox':
    case 'listBox':
      return '';
    case 'scrollBar':
    case 'spinner':
    case 'slider':
      return control.min ?? 0;
    case 'button':
      return undefined;
  }
}
