/**
 * Validation Error Dialog Slice
 *
 * State for the data validation error dialog (strict enforcement).
 * This dialog is shown when a cell edit fails validation with 'strict' enforcement.
 *
 * Following Excel's pattern:
 * - Stop (strict): Shows error with Retry and Cancel buttons
 *
 */

import type { StateCreator } from 'zustand';

// =============================================================================
// Types
// =============================================================================

/**
 * Alert style matches the public `ValidationRule.errorStyle` vocabulary.
 * The dialog currently renders the "stop" layout only; "warning" and
 * "information" are reserved for the three-button dialog code path.
 * See app-eval scenarios which read `data-dv-alert-style` on the root
 * [role="dialog"] element to assert enforcement shape.
 */
export type ValidationAlertStyle = 'stop' | 'warning' | 'information';

export interface ValidationErrorDialogState {
  validationErrorDialog: {
    isOpen: boolean;
    title: string;
    message: string;
    /** Alert style from the rule's `errorStyle`. Defaults to 'stop'. */
    alertStyle: ValidationAlertStyle;
  };
}

export interface ValidationErrorDialogActions {
  /** Show the validation error dialog */
  showValidationError: (
    message: string,
    title: string,
    onRetry: () => void,
    onCancel: () => void,
    alertStyle?: ValidationAlertStyle,
  ) => void;
  /** Close the validation error dialog */
  closeValidationError: () => void;
  /** Get the current callbacks (for dialog to call) */
  getValidationErrorCallbacks: () => { onRetry: () => void; onCancel: () => void };
}

export type ValidationErrorDialogSlice = ValidationErrorDialogState & ValidationErrorDialogActions;

// =============================================================================
// Initial State
// =============================================================================

export const initialValidationErrorDialogState: ValidationErrorDialogState = {
  validationErrorDialog: {
    isOpen: false,
    title: '',
    message: '',
    alertStyle: 'stop',
  },
};

// =============================================================================
// Slice Creator
// =============================================================================

// Store callbacks in closure to avoid storing functions in state
let _validationErrorCallbacks = {
  onRetry: () => {},
  onCancel: () => {},
};

export const createValidationErrorDialogSlice: StateCreator<
  ValidationErrorDialogSlice,
  [],
  [],
  ValidationErrorDialogSlice
> = (set) => ({
  ...initialValidationErrorDialogState,

  showValidationError: (message, title, onRetry, onCancel, alertStyle = 'stop') => {
    _validationErrorCallbacks = { onRetry, onCancel };
    set({
      validationErrorDialog: {
        isOpen: true,
        title,
        message,
        alertStyle,
      },
    });
  },

  closeValidationError: () => {
    set({
      validationErrorDialog: {
        isOpen: false,
        title: '',
        message: '',
        alertStyle: 'stop',
      },
    });
  },

  getValidationErrorCallbacks: () => _validationErrorCallbacks,
});
