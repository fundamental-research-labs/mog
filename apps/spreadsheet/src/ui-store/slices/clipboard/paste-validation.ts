/**
 * Paste Validation Summary Dialog Slice
 *
 * Manages the paste validation summary dialog state.
 * Shown when pasting values into cells with existing validation rules
 * where some pasted values don't match the validation constraints.
 *
 * Batch Paste Validation UI
 */

import type { StateCreator } from 'zustand';

import type { SheetId } from '@mog-sdk/contracts/core';

import type { PasteValidationViolation } from '@mog-sdk/contracts/actors';

// =============================================================================
// Types
// =============================================================================

/**
 * Summary of validation violations after paste operation.
 * Groups violations by enforcement level for display.
 */
export interface PasteValidationSummary {
  /** Total number of cells that were pasted */
  totalPasted: number;
  /** All validation violations */
  violations: PasteValidationViolation[];
  /** Sheet where paste occurred */
  sheetId: SheetId;
  /** Undo token to revert the paste if needed */
  undoToken?: string;
}

/**
 * Paste validation summary dialog state
 */
export interface PasteValidationDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Summary of validation violations */
  summary: PasteValidationSummary | null;
}

// =============================================================================
// Slice Interface
// =============================================================================

/**
 * Paste Validation Summary Dialog Slice interface
 */
export interface PasteValidationSlice {
  pasteValidationDialog: PasteValidationDialogState;
  /** Show the paste validation summary dialog */
  showPasteValidationSummary: (summary: PasteValidationSummary) => void;
  /** Close the paste validation summary dialog */
  closePasteValidationSummary: () => void;
  /** Get violations grouped by enforcement level */
  getViolationsByEnforcement: () => {
    strict: PasteValidationViolation[];
    warn: PasteValidationViolation[];
    info: PasteValidationViolation[];
  };
}

// =============================================================================
// Default State
// =============================================================================

const DEFAULT_PASTE_VALIDATION_DIALOG: PasteValidationDialogState = {
  isOpen: false,
  summary: null,
};

// =============================================================================
// Slice Creator
// =============================================================================

/**
 * Create the paste validation dialog slice
 */
export const createPasteValidationSlice: StateCreator<
  PasteValidationSlice,
  [],
  [],
  PasteValidationSlice
> = (set, get) => ({
  pasteValidationDialog: DEFAULT_PASTE_VALIDATION_DIALOG,

  showPasteValidationSummary: (summary: PasteValidationSummary) => {
    set({
      pasteValidationDialog: {
        isOpen: true,
        summary,
      },
    });
  },

  closePasteValidationSummary: () => {
    set({ pasteValidationDialog: DEFAULT_PASTE_VALIDATION_DIALOG });
  },

  getViolationsByEnforcement: () => {
    const state = get();
    const violations = state.pasteValidationDialog.summary?.violations ?? [];

    return {
      strict: violations.filter((v) => v.enforcement === 'strict'),
      warn: violations.filter((v) => v.enforcement === 'warn'),
      info: violations.filter((v) => v.enforcement === 'info'),
    };
  },
});

// =============================================================================
// Selectors
// =============================================================================

/**
 * Check if paste validation dialog is open.
 */
export function selectIsPasteValidationDialogOpen(state: PasteValidationSlice): boolean {
  return state.pasteValidationDialog.isOpen;
}

/**
 * Get the paste validation summary.
 */
export function selectPasteValidationSummary(
  state: PasteValidationSlice,
): PasteValidationSummary | null {
  return state.pasteValidationDialog.summary;
}

/**
 * Get count of validation failures.
 */
export function selectPasteValidationFailureCount(state: PasteValidationSlice): number {
  return state.pasteValidationDialog.summary?.violations.length ?? 0;
}

/**
 * Check if there are strict violations (which require user action).
 */
export function selectHasStrictViolations(state: PasteValidationSlice): boolean {
  return (
    state.pasteValidationDialog.summary?.violations.some((v) => v.enforcement === 'strict') ?? false
  );
}
