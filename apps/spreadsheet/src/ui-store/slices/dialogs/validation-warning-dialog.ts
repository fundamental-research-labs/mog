/**
 * Validation Warning Dialog Slice
 *
 * State for the data validation warning/information dialog.
 * Shown when a cell edit fails validation with 'warning' or 'info' enforcement.
 *
 * Following Excel's pattern:
 * - Warning: Yellow icon, Yes / No / Cancel buttons (allows override)
 * - Information: Blue icon, OK / Cancel buttons (informational only)
 *
 * The 'stop' (strict) enforcement uses validation-error-dialog.ts instead.
 */

import type { StateCreator } from 'zustand';

// =============================================================================
// Types
// =============================================================================

export type ValidationWarningErrorStyle = 'warning' | 'information';

export interface ValidationWarningDialogState {
  validationWarningDialog: {
    isOpen: boolean;
    title: string;
    message: string;
    errorStyle: ValidationWarningErrorStyle;
  };
}

export interface ValidationWarningDialogActions {
  /** Show the validation warning dialog */
  showValidationWarning: (
    message: string,
    title: string,
    errorStyle: ValidationWarningErrorStyle,
    onProceed: () => void,
    onCancel: () => void,
    onRetry?: () => void,
  ) => void;
  /** Close the validation warning dialog */
  closeValidationWarning: () => void;
  /** Get the current callbacks (for dialog to call) */
  getValidationWarningCallbacks: () => {
    onProceed: () => void;
    onCancel: () => void;
    onRetry: () => void;
  };
}

export type ValidationWarningDialogSlice = ValidationWarningDialogState &
  ValidationWarningDialogActions;

// =============================================================================
// Initial State
// =============================================================================

export const initialValidationWarningDialogState: ValidationWarningDialogState = {
  validationWarningDialog: {
    isOpen: false,
    title: '',
    message: '',
    errorStyle: 'warning',
  },
};

// =============================================================================
// Slice Creator
// =============================================================================

// Store callbacks in closure to avoid storing functions in state
let _validationWarningCallbacks = {
  onProceed: () => {},
  onCancel: () => {},
  onRetry: () => {},
};

export const createValidationWarningDialogSlice: StateCreator<
  ValidationWarningDialogSlice,
  [],
  [],
  ValidationWarningDialogSlice
> = (set) => ({
  ...initialValidationWarningDialogState,

  showValidationWarning: (message, title, errorStyle, onProceed, onCancel, onRetry) => {
    _validationWarningCallbacks = {
      onProceed,
      onCancel,
      onRetry: onRetry ?? (() => {}),
    };
    set({
      validationWarningDialog: {
        isOpen: true,
        title,
        message,
        errorStyle,
      },
    });
  },

  closeValidationWarning: () => {
    set({
      validationWarningDialog: {
        isOpen: false,
        title: '',
        message: '',
        errorStyle: 'warning',
      },
    });
  },

  getValidationWarningCallbacks: () => _validationWarningCallbacks,
});
