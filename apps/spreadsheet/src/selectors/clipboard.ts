/**
 * Clipboard Actor Selectors
 *
 * Pure functions that extract data from clipboard state.
 * Copied from kernel/src/selectors/ during kernel export tightening.
 */

import type { ClipboardState } from '@mog-sdk/contracts/actors/clipboard';
import { EXTERNAL_SOURCE_SHEET_ID } from '@mog-sdk/contracts/actors/clipboard';

export const clipboardSelectors = {
  // Value selectors
  sourceRanges: (state: ClipboardState) => state.context.sourceRanges,
  data: (state: ClipboardState) => state.context.data,
  isCut: (state: ClipboardState): boolean => state.context.isCut,
  pastePreviewTarget: (state: ClipboardState) => state.context.pastePreviewTarget,
  marchingAntsPhase: (state: ClipboardState): number => state.context.marchingAntsPhase,
  errorMessage: (state: ClipboardState) => state.context.errorMessage,
  pasteOptions: (state: ClipboardState) => state.context.pasteOptions,
  skipSizeCheck: (state: ClipboardState): boolean => state.context.skipSizeCheck,
  isStale: (state: ClipboardState): boolean => state.context.isStale,

  // Derived value selectors
  hasData: (state: ClipboardState): boolean => state.context.data !== null,

  // State matching selectors
  isEmpty: (state: ClipboardState): boolean => state.matches('empty'),
  hasCopy: (state: ClipboardState): boolean =>
    state.matches('hasCopy') || state.matches('pasteError'),
  hasCut: (state: ClipboardState): boolean => state.matches('hasCut'),
  isPastePreview: (state: ClipboardState): boolean => state.matches('pastePreview'),
  isPasting: (state: ClipboardState): boolean => state.matches('pasting'),
  isPasteError: (state: ClipboardState): boolean => state.matches('pasteError'),

  // =============================================================================
  // Derived selectors for snapshot (snapshot composition uses these)
  // =============================================================================

  /**
   * Check if clipboard has copy data available.
   * True when in hasCopy, pastePreview, or pasting states.
   */
  hasCopyAvailable: (state: ClipboardState): boolean =>
    state.matches('hasCopy') ||
    state.matches('pasteError') ||
    state.matches('pastePreview') ||
    state.matches('pasting'),

  /**
   * Check if clipboard data is from external source.
   * External data has sourceSheetId === EXTERNAL_SOURCE_SHEET_ID.
   */
  isExternalClipboard: (state: ClipboardState): boolean =>
    state.context.data?.sourceSheetId === EXTERNAL_SOURCE_SHEET_ID,

  /**
   * Get the cut source ranges (for marching ants on cut).
   * Returns sourceRanges only when the clipboard is from an internal cut operation.
   */
  cutSource: (state: ClipboardState) => {
    const isExternalData = state.context.data?.sourceSheetId === EXTERNAL_SOURCE_SHEET_ID;
    return state.context.isCut && !isExternalData ? state.context.sourceRanges : null;
  },

  /**
   * Get the copy source ranges (for marching ants on copy).
   * Returns sourceRanges only when the clipboard is from an internal copy operation.
   */
  copySource: (state: ClipboardState) => {
    const hasCopyAvailable =
      state.matches('hasCopy') ||
      state.matches('pasteError') ||
      state.matches('pastePreview') ||
      state.matches('pasting');
    const isExternalData = state.context.data?.sourceSheetId === EXTERNAL_SOURCE_SHEET_ID;
    return !state.context.isCut && hasCopyAvailable && !isExternalData
      ? state.context.sourceRanges
      : null;
  },

  /**
   * Get the source sheet ID from clipboard data.
   * Returns the sheet where the copy/cut originated, or null if no internal clipboard data.
   */
  sourceSheetId: (state: ClipboardState): string | null => {
    const isExternalData = state.context.data?.sourceSheetId === EXTERNAL_SOURCE_SHEET_ID;
    if (isExternalData || !state.context.data) return null;
    return state.context.data.sourceSheetId;
  },

  /**
   * Check if marching ants should be visible for the given active sheet.
   * Ants are only shown on the sheet where the copy/cut originated,
   * and only when clipboard has copy or cut data available.
   *
   * @param activeSheetId - The currently active sheet ID
   */
  hasMarchingAnts: (state: ClipboardState, activeSheetId: string): boolean => {
    const isExternalData = state.context.data?.sourceSheetId === EXTERNAL_SOURCE_SHEET_ID;
    if (isExternalData || !state.context.data) return false;
    const sourceSheetId = state.context.data.sourceSheetId;
    if (sourceSheetId !== activeSheetId) return false;
    return clipboardSelectors.hasCopyAvailable(state) || clipboardSelectors.hasCut(state);
  },
};
