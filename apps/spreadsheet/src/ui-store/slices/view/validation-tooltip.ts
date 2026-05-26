/**
 * Validation Tooltip Slice
 *
 * Input Message Tooltip
 *
 * Manages state for the input message tooltip that appears when a cell
 * with data validation input message is selected.
 *
 * Excel behavior:
 * - Input message appears as a callout/tooltip near the selected cell
 * - Shows title (bold) and message
 * - Automatically dismissed when selection changes
 * - Position adjusts to stay within viewport
 */

import type { StateCreator } from 'zustand';

// =============================================================================
// Slice State Interface
// =============================================================================

/**
 * Input message tooltip configuration.
 */
export interface InputMessageTooltipConfig {
  /** Title of the input message (shown in bold) */
  title?: string;
  /** Main message content */
  message: string;
  /** Screen position for the tooltip */
  position: {
    /** X coordinate in pixels */
    x: number;
    /** Y coordinate in pixels */
    y: number;
  };
  /** The cell that triggered this tooltip */
  anchorCell: {
    row: number;
    col: number;
  };
}

export interface ValidationTooltipSliceState {
  /**
   * Current input message tooltip state.
   * null when no tooltip is visible.
   */
  inputMessageTooltip: InputMessageTooltipConfig | null;
}

// =============================================================================
// Slice Actions Interface
// =============================================================================

export interface ValidationTooltipSliceActions {
  /**
   * Show the input message tooltip with the given configuration.
   */
  showInputMessageTooltip: (config: InputMessageTooltipConfig) => void;

  /**
   * Hide the input message tooltip.
   */
  hideInputMessageTooltip: () => void;
}

// =============================================================================
// Combined Slice Type
// =============================================================================

export type ValidationTooltipSlice = ValidationTooltipSliceState & ValidationTooltipSliceActions;

// =============================================================================
// Slice Creator
// =============================================================================

export const createValidationTooltipSlice: StateCreator<
  ValidationTooltipSlice,
  [],
  [],
  ValidationTooltipSlice
> = (set) => ({
  // Initial state - tooltip is hidden by default
  inputMessageTooltip: null,

  // Show input message tooltip
  showInputMessageTooltip: (config) => {
    set({ inputMessageTooltip: config });
  },

  // Hide input message tooltip
  hideInputMessageTooltip: () => {
    set({ inputMessageTooltip: null });
  },
});

// =============================================================================
// Selectors
// =============================================================================

/**
 * Get the current input message tooltip configuration.
 */
export function selectInputMessageTooltip(
  state: ValidationTooltipSliceState,
): InputMessageTooltipConfig | null {
  return state.inputMessageTooltip;
}

/**
 * Check if input message tooltip is visible.
 */
export function selectIsInputMessageTooltipVisible(state: ValidationTooltipSliceState): boolean {
  return state.inputMessageTooltip !== null;
}
