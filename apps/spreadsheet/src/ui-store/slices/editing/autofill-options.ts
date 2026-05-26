/**
 * AutoFill Options Slice
 *
 * Manages the autofill options floating button state.
 * Shows after fill operations with options to change fill type
 * (Copy Cells, Fill Series, Fill Formatting Only, etc.).
 *
 * Excel Parity AutoFill Options Button
 */

import type { StateCreator } from 'zustand';

import type { CellRange, SheetId } from '@mog-sdk/contracts/core';

import type { FillOptions, SeriesType } from '@mog-sdk/contracts/fill';

// =============================================================================
// Types
// =============================================================================

/**
 * AutoFill option types available in the dropdown.
 * These match Excel's AutoFill Options menu.
 */
export type AutoFillOptionType =
  | 'copy' // Copy Cells (duplicate source)
  | 'series' // Fill Series (linear/growth pattern)
  | 'formatting' // Fill Formatting Only
  | 'values'; // Fill Without Formatting

/**
 * Information about the last fill operation.
 * Used to re-execute fill with different options.
 */
export interface LastFillInfo {
  /** The source range that was filled from */
  sourceRange: CellRange;
  /** The target range that was filled to */
  targetRange: CellRange;
  /** Sheet where fill occurred */
  sheetId: SheetId;
  /** Original fill options used */
  originalOptions: FillOptions;
}

/**
 * AutoFill options button state
 */
export interface AutoFillOptionsState {
  /** Whether the autofill options button is visible */
  isVisible: boolean;
  /** Position of the button in cell coordinates (bottom-right of target range) */
  position: { row: number; col: number } | null;
  /** Information about the last fill operation */
  lastFillInfo: LastFillInfo | null;
}

/**
 * AutoFill Options Slice interface
 */
export interface AutoFillOptionsSlice {
  autofillOptions: AutoFillOptionsState;
  showAutofillOptionsButton: (info: LastFillInfo) => void;
  hideAutofillOptionsButton: () => void;
}

// =============================================================================
// Default State
// =============================================================================

/**
 * Default autofill options state
 */
const DEFAULT_AUTOFILL_OPTIONS: AutoFillOptionsState = {
  isVisible: false,
  position: null,
  lastFillInfo: null,
};

// =============================================================================
// Slice Creator
// =============================================================================

/**
 * Create the autofill options slice
 */
export const createAutofillOptionsSlice: StateCreator<
  AutoFillOptionsSlice,
  [],
  [],
  AutoFillOptionsSlice
> = (set) => ({
  autofillOptions: DEFAULT_AUTOFILL_OPTIONS,

  showAutofillOptionsButton: (info: LastFillInfo) => {
    // Position at bottom-right corner of target range
    const position = {
      row: Math.max(info.targetRange.startRow, info.targetRange.endRow),
      col: Math.max(info.targetRange.startCol, info.targetRange.endCol),
    };

    set({
      autofillOptions: {
        isVisible: true,
        position,
        lastFillInfo: info,
      },
    });
  },

  hideAutofillOptionsButton: () => {
    set({ autofillOptions: DEFAULT_AUTOFILL_OPTIONS });
  },
});

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Convert AutoFillOptionType to SeriesType for fill options.
 */
export function autoFillOptionToSeriesType(option: AutoFillOptionType): SeriesType {
  switch (option) {
    case 'copy':
      return 'copy';
    case 'series':
      return 'auto'; // Let pattern detection determine series type
    case 'formatting':
      return 'copy'; // Copy values, apply formatting only
    case 'values':
      return 'auto'; // Use pattern detection for values
    default:
      return 'auto';
  }
}

/**
 * Build FillOptions from AutoFillOptionType.
 * Modifies the base options to match the selected option.
 */
export function buildFillOptionsFromOption(
  baseOptions: FillOptions,
  option: AutoFillOptionType,
): FillOptions {
  switch (option) {
    case 'copy':
      return {
        ...baseOptions,
        seriesType: 'copy',
        smartFill: false,
      };
    case 'series':
      return {
        ...baseOptions,
        seriesType: 'auto',
        smartFill: true,
      };
    case 'formatting':
      return {
        ...baseOptions,
        seriesType: 'copy',
        includeFormulas: false,
        includeValues: false,
        includeFormats: true,
        smartFill: false,
      };
    case 'values':
      return {
        ...baseOptions,
        seriesType: 'auto',
        includeFormulas: true,
        includeValues: true,
        includeFormats: false,
        smartFill: true,
      };
    default:
      return baseOptions;
  }
}
