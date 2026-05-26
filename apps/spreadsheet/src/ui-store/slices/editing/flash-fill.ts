/**
 * Flash Fill Slice
 *
 * Manages the Flash Fill preview state for automatic pattern detection.
 * Shows ghosted preview values in cells below when user types patterns.
 *
 * Flash Fill detects data transformation patterns from user examples and
 * shows a preview of generated values that can be accepted or rejected.
 *
 * Flash Fill (Ctrl+E)
 */

import type { StateCreator } from 'zustand';

import type { CellValue, SheetId } from '@mog-sdk/contracts/core';

// =============================================================================
// Types
// =============================================================================

/**
 * Preview value for a single cell.
 */
export interface FlashFillPreviewValue {
  /** Row index of the cell */
  row: number;
  /** Column index of the cell */
  col: number;
  /** Preview value to display */
  value: CellValue;
}

/**
 * Flash Fill preview state.
 */
export interface FlashFillPreviewState {
  /** Whether the preview is currently showing */
  isShowingPreview: boolean;
  /** Source column index (where pattern examples are) */
  sourceColumn: number | null;
  /** Target column index (where preview values will appear) */
  targetColumn: number | null;
  /** Sheet ID where preview is active */
  sheetId: SheetId | null;
  /** Preview values to display */
  previewValues: FlashFillPreviewValue[];
  /** Description of the detected pattern */
  patternDescription: string | null;
  /** Confidence score of the pattern (0-1) */
  confidence: number;
  /** Starting row of the preview range */
  startRow: number | null;
  /** Ending row of the preview range */
  endRow: number | null;
}

/**
 * Flash Fill Slice interface.
 */
export interface FlashFillSlice {
  /** Flash Fill preview state */
  flashFillPreview: FlashFillPreviewState;

  /**
   * Show Flash Fill preview with generated values.
   */
  showFlashFillPreview: (config: {
    sheetId: SheetId;
    sourceColumn: number;
    targetColumn: number;
    previewValues: FlashFillPreviewValue[];
    patternDescription: string;
    confidence: number;
    startRow: number;
    endRow: number;
  }) => void;

  /**
   * Hide Flash Fill preview.
   */
  hideFlashFillPreview: () => void;

  /**
   * Update preview values (when pattern changes).
   */
  updateFlashFillPreviewValues: (values: FlashFillPreviewValue[]) => void;
}

// =============================================================================
// Default State
// =============================================================================

/**
 * Default Flash Fill preview state.
 */
const DEFAULT_FLASH_FILL_PREVIEW: FlashFillPreviewState = {
  isShowingPreview: false,
  sourceColumn: null,
  targetColumn: null,
  sheetId: null,
  previewValues: [],
  patternDescription: null,
  confidence: 0,
  startRow: null,
  endRow: null,
};

// =============================================================================
// Slice Creator
// =============================================================================

/**
 * Create the Flash Fill slice.
 */
export const createFlashFillSlice: StateCreator<FlashFillSlice, [], [], FlashFillSlice> = (
  set,
) => ({
  flashFillPreview: DEFAULT_FLASH_FILL_PREVIEW,

  showFlashFillPreview: (config) => {
    set({
      flashFillPreview: {
        isShowingPreview: true,
        sheetId: config.sheetId,
        sourceColumn: config.sourceColumn,
        targetColumn: config.targetColumn,
        previewValues: config.previewValues,
        patternDescription: config.patternDescription,
        confidence: config.confidence,
        startRow: config.startRow,
        endRow: config.endRow,
      },
    });
  },

  hideFlashFillPreview: () => {
    set({ flashFillPreview: DEFAULT_FLASH_FILL_PREVIEW });
  },

  updateFlashFillPreviewValues: (values) => {
    set((state) => ({
      flashFillPreview: {
        ...state.flashFillPreview,
        previewValues: values,
      },
    }));
  },
});

// =============================================================================
// Selectors
// =============================================================================

/**
 * Select whether Flash Fill preview is active.
 */
export function selectIsFlashFillPreviewActive(state: FlashFillSlice): boolean {
  return state.flashFillPreview.isShowingPreview;
}

/**
 * Select Flash Fill preview values for a specific cell.
 */
export function selectFlashFillPreviewValue(
  state: FlashFillSlice,
  row: number,
  col: number,
): CellValue | undefined {
  if (!state.flashFillPreview.isShowingPreview) return undefined;
  if (col !== state.flashFillPreview.targetColumn) return undefined;

  const preview = state.flashFillPreview.previewValues.find(
    (pv) => pv.row === row && pv.col === col,
  );
  return preview?.value;
}

/**
 * Select all Flash Fill preview values.
 */
export function selectFlashFillPreviewValues(state: FlashFillSlice): FlashFillPreviewValue[] {
  return state.flashFillPreview.previewValues;
}

/**
 * Select Flash Fill preview pattern description.
 */
export function selectFlashFillPatternDescription(state: FlashFillSlice): string | null {
  return state.flashFillPreview.patternDescription;
}
