/**
 * Test fixture: clipboard selectors
 *
 * Local copy of clipboardSelectors for contracts tests.
 * Migrated from @mog-sdk/kernel/selectors during kernel export tightening.
 */

import type { ClipboardState } from '../../src/actors/clipboard';
import { EXTERNAL_SOURCE_SHEET_ID } from '../../src/actors/clipboard';

export { EXTERNAL_SOURCE_SHEET_ID } from '../../src/actors/clipboard';

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

  hasCopyAvailable: (state: ClipboardState): boolean =>
    state.matches('hasCopy') ||
    state.matches('pasteError') ||
    state.matches('pastePreview') ||
    state.matches('pasting'),

  isExternalClipboard: (state: ClipboardState): boolean =>
    state.context.data?.sourceSheetId === EXTERNAL_SOURCE_SHEET_ID,

  cutSource: (state: ClipboardState) => {
    const isExternalData = state.context.data?.sourceSheetId === EXTERNAL_SOURCE_SHEET_ID;
    return state.context.isCut && !isExternalData ? state.context.sourceRanges : null;
  },

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

  sourceSheetId: (state: ClipboardState): string | null => {
    const isExternalData = state.context.data?.sourceSheetId === EXTERNAL_SOURCE_SHEET_ID;
    if (isExternalData || !state.context.data) return null;
    return state.context.data.sourceSheetId;
  },

  hasMarchingAnts: (state: ClipboardState, activeSheetId: string): boolean => {
    const isExternalData = state.context.data?.sourceSheetId === EXTERNAL_SOURCE_SHEET_ID;
    if (isExternalData || !state.context.data) return false;
    const sourceSheetId = state.context.data.sourceSheetId;
    if (sourceSheetId !== activeSheetId) return false;
    return clipboardSelectors.hasCopyAvailable(state) || clipboardSelectors.hasCut(state);
  },
};
