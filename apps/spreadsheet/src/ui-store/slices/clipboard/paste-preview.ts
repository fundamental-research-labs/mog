/**
 * Paste Preview Slice
 *
 * Manages the paste preview state for showing a live preview
 * of what a paste operation would look like before committing.
 *
 * When the paste dropdown is open and the user hovers over a paste option,
 * this slice holds the preview data that the selection layer will render
 * as a semi-transparent overlay.
 *
 * Excel Parity: Clipboard Behaviors - Paste Preview on Hover
 */

import type { StateCreator } from 'zustand';

import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type { PreviewCellData as ContractPreviewCellData } from '@mog-sdk/contracts/rendering';

import type { PasteOption } from './paste-options';

// =============================================================================
// Types - Re-exported from contracts
// =============================================================================

// PreviewCellData is defined in contracts/src/rendering/hit-test.ts.
export type PreviewCellData = ContractPreviewCellData;

/**
 * Paste preview state
 */
export interface PastePreviewState {
  /** Whether preview is currently active */
  isActive: boolean;
  /** The paste option being previewed */
  previewOption: PasteOption | null;
  /** Sheet ID where preview is shown */
  sheetId: SheetId | null;
  /** The target range for the preview */
  targetRange: CellRange | null;
  /** Preview cell data (cells that would be affected) */
  previewCells: PreviewCellData[];
}

/**
 * Paste Preview Slice interface
 */
export interface PastePreviewSlice {
  pastePreview: PastePreviewState;
  /**
   * Show paste preview for a specific option.
   * Called when hovering over a paste dropdown item.
   */
  showPastePreview: (
    option: PasteOption,
    sheetId: SheetId,
    targetRange: CellRange,
    previewCells: PreviewCellData[],
  ) => void;
  /**
   * Hide the paste preview.
   * Called when mouse leaves the paste dropdown or when paste is executed.
   */
  hidePastePreview: () => void;
  /**
   * Check if paste preview is active for a specific option.
   */
  isPastePreviewActive: (option: PasteOption) => boolean;
}

// =============================================================================
// Default State
// =============================================================================

/**
 * Default paste preview state (no preview active)
 */
const DEFAULT_PASTE_PREVIEW: PastePreviewState = {
  isActive: false,
  previewOption: null,
  sheetId: null,
  targetRange: null,
  previewCells: [],
};

// =============================================================================
// Slice Creator
// =============================================================================

/**
 * Create the paste preview slice
 */
export const createPastePreviewSlice: StateCreator<PastePreviewSlice, [], [], PastePreviewSlice> = (
  set,
  get,
) => ({
  pastePreview: DEFAULT_PASTE_PREVIEW,

  showPastePreview: (
    option: PasteOption,
    sheetId: SheetId,
    targetRange: CellRange,
    previewCells: PreviewCellData[],
  ) => {
    set({
      pastePreview: {
        isActive: true,
        previewOption: option,
        sheetId,
        targetRange,
        previewCells,
      },
    });
  },

  hidePastePreview: () => {
    set({ pastePreview: DEFAULT_PASTE_PREVIEW });
  },

  isPastePreviewActive: (option: PasteOption) => {
    const state = get();
    return state.pastePreview.isActive && state.pastePreview.previewOption === option;
  },
});

// =============================================================================
// Selectors
// =============================================================================

/**
 * Select whether paste preview is active
 */
export function selectIsPastePreviewActive(state: PastePreviewSlice): boolean {
  return state.pastePreview.isActive;
}

/**
 * Select the current preview option
 */
export function selectPastePreviewOption(state: PastePreviewSlice): PasteOption | null {
  return state.pastePreview.previewOption;
}

/**
 * Select preview cells for rendering
 */
export function selectPastePreviewCells(state: PastePreviewSlice): PreviewCellData[] {
  return state.pastePreview.previewCells;
}

/**
 * Select the preview target range
 */
export function selectPastePreviewRange(state: PastePreviewSlice): CellRange | null {
  return state.pastePreview.targetRange;
}
