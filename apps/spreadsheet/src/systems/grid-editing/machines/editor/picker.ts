/**
 * Editor Machine Picker/Dropdown Actions
 *
 * Actions for handling picker/dropdown editing mode including:
 * - Dropdown menu interaction
 * - Option selection from predefined lists
 * - Picker state management
 * - Integration with cell schema validation
 *
 * @see Issue-2-Cell-Dropdowns-InCell-Pickers.md for dropdown architecture
 * Extracted picker/dropdown actions from editor-machine.ts
 */

import type { CellEditorType } from '@mog-sdk/contracts/editor';
import { assign } from 'xstate';
import type { EditorContext, EditorEvent } from './types';

// =============================================================================
// Picker/Dropdown Actions
// =============================================================================

/**
 * Set editor type from coordinator schema lookup.
 * If pendingOpenDropdown is true and editor has a picker, open it.
 */
export const setEditorType = assign(
  ({ context, event }: { context: EditorContext; event: EditorEvent }) => {
    if (event.type !== 'SET_EDITOR_TYPE') return {};

    // Data Validation - Open picker if pending and this editor has a picker.
    const shouldOpenPicker =
      context.pendingOpenDropdown &&
      ((event.editorType === 'dropdown' && event.enumItems !== null) ||
        event.editorType === 'date');

    return {
      editorType: event.editorType,
      cellSchema: event.cellSchema,
      enumItems: event.enumItems,
      // Auto-open picker if Alt+Down initiated editing on dropdown cell
      isPickerOpen: shouldOpenPicker,
      // Clear the pending flag
      pendingOpenDropdown: false,
    };
  },
);

/** Open the picker (dropdown, date picker, etc.) */
export const openPicker = assign({
  isPickerOpen: true,
});

/** Close the picker */
export const closePicker = assign({
  isPickerOpen: false,
});

export const clearPendingPickerIntent = assign({
  pendingOpenDropdown: false,
});

/** Handle picker selection - update value and close picker */
export const handlePickerSelect = assign(({ event }: { event: EditorEvent }) => {
  if (event.type !== 'PICKER_SELECT') return {};
  // Pickers replace the value atomically — there is no live DOM caret to
  // preserve, so end-of-value is the correct cursor. This is a different
  // shape from the INPUT bug fixed in
  // a cursor mid-typing, racing the real DOM caret. Picker selection has
  // no mid-typing concept — the value is wholesale-replaced from a
  // dropdown click — so `String(event.value ?? '').length` is correct
  // here, not a copy-paste of the INPUT defect.
  return {
    value: String(event.value ?? ''),
    cursorPosition: String(event.value ?? '').length,
    isPickerOpen: false,
  };
});

/** Reset picker state */
export const resetPickerState = assign({
  editorType: 'text' as CellEditorType,
  cellSchema: null,
  enumItems: null,
  isPickerOpen: false,
  pendingOpenDropdown: false,
  datePickerCommit: null,
});

// =============================================================================
// Exported Actions Object
// =============================================================================

/**
 * All picker/dropdown actions for the editor machine.
 * Import this object to use in the machine configuration.
 */
export const pickerActions = {
  setEditorType,
  clearPendingPickerIntent,
  openPicker,
  closePicker,
  handlePickerSelect,
  resetPickerState,
};
