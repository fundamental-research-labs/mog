/**
 * Clipboard Selectors Tests
 *
 * Tests for clipboard selectors, specifically verifying that external clipboard data
 * (pasted from outside the app) does not show marching ants.
 *
 */

import { clipboardSelectors, EXTERNAL_SOURCE_SHEET_ID } from './fixtures/clipboard-selectors';
import type { ClipboardState } from '../src/actors/clipboard';

/**
 * Helper to create a mock ClipboardState for testing selectors.
 * Creates a minimal state shape that matches the ClipboardState type.
 */
function createClipboardState(
  context: Partial<ClipboardState['context']>,
  stateName: 'idle' | 'empty' | 'hasCopy' | 'hasCut' | 'pastePreview' | 'pasting',
): ClipboardState {
  return {
    value: stateName,
    context: {
      sourceRanges: context.sourceRanges ?? null,
      data: context.data ?? null,
      isCut: context.isCut ?? false,
      pastePreviewTarget: context.pastePreviewTarget ?? null,
      marchingAntsPhase: context.marchingAntsPhase ?? 0,
      errorMessage: context.errorMessage ?? null,
      pasteOptions: context.pasteOptions ?? null,
      skipSizeCheck: context.skipSizeCheck ?? false,
      isStale: context.isStale ?? false,
    },
    matches: (state: string) => state === stateName,
  } as ClipboardState;
}

describe('clipboardSelectors.isExternalClipboard', () => {
  it('returns true for external clipboard data', () => {
    const state = createClipboardState(
      {
        data: {
          sourceSheetId: EXTERNAL_SOURCE_SHEET_ID,
          cells: {},
          sourceRanges: [{ startRow: 0, startCol: 0, endRow: 2, endCol: 2 }],
        },
      },
      'hasCopy',
    );
    expect(clipboardSelectors.isExternalClipboard(state)).toBe(true);
  });

  it('returns false for internal clipboard data', () => {
    const state = createClipboardState(
      {
        data: {
          sourceSheetId: 'sheet-123',
          cells: {},
          sourceRanges: [{ startRow: 4, startCol: 3, endRow: 6, endCol: 5 }],
        },
      },
      'hasCopy',
    );
    expect(clipboardSelectors.isExternalClipboard(state)).toBe(false);
  });

  it('returns false when no clipboard data', () => {
    const state = createClipboardState({}, 'empty');
    expect(clipboardSelectors.isExternalClipboard(state)).toBe(false);
  });
});

describe('clipboardSelectors.copySource', () => {
  it('returns sourceRanges for internal copy', () => {
    const sourceRanges = [{ startRow: 4, startCol: 3, endRow: 6, endCol: 5 }];
    const state = createClipboardState(
      {
        sourceRanges,
        data: {
          sourceSheetId: 'sheet-123',
          cells: {},
          sourceRanges,
        },
        isCut: false,
      },
      'hasCopy',
    );
    expect(clipboardSelectors.copySource(state)).toEqual(sourceRanges);
  });

  it('returns null for external clipboard data in hasCopy state', () => {
    const state = createClipboardState(
      {
        sourceRanges: [{ startRow: 0, startCol: 0, endRow: 2, endCol: 2 }],
        data: {
          sourceSheetId: EXTERNAL_SOURCE_SHEET_ID,
          cells: {},
          sourceRanges: [{ startRow: 0, startCol: 0, endRow: 2, endCol: 2 }],
        },
        isCut: false,
      },
      'hasCopy',
    );
    expect(clipboardSelectors.copySource(state)).toBeNull();
  });

  it('returns null for external clipboard data in pastePreview state', () => {
    const state = createClipboardState(
      {
        sourceRanges: [{ startRow: 0, startCol: 0, endRow: 2, endCol: 2 }],
        data: {
          sourceSheetId: EXTERNAL_SOURCE_SHEET_ID,
          cells: {},
          sourceRanges: [{ startRow: 0, startCol: 0, endRow: 2, endCol: 2 }],
        },
        isCut: false,
      },
      'pastePreview',
    );
    expect(clipboardSelectors.copySource(state)).toBeNull();
  });

  it('returns null for external clipboard data in pasting state', () => {
    const state = createClipboardState(
      {
        sourceRanges: [{ startRow: 0, startCol: 0, endRow: 2, endCol: 2 }],
        data: {
          sourceSheetId: EXTERNAL_SOURCE_SHEET_ID,
          cells: {},
          sourceRanges: [{ startRow: 0, startCol: 0, endRow: 2, endCol: 2 }],
        },
        isCut: false,
      },
      'pasting',
    );
    expect(clipboardSelectors.copySource(state)).toBeNull();
  });

  it('returns null for cut operations', () => {
    const sourceRanges = [{ startRow: 4, startCol: 3, endRow: 6, endCol: 5 }];
    const state = createClipboardState(
      {
        sourceRanges,
        data: {
          sourceSheetId: 'sheet-123',
          cells: {},
          sourceRanges,
        },
        isCut: true,
      },
      'hasCut',
    );
    expect(clipboardSelectors.copySource(state)).toBeNull();
  });

  it('returns null when in empty state', () => {
    const state = createClipboardState({}, 'empty');
    expect(clipboardSelectors.copySource(state)).toBeNull();
  });
});

describe('clipboardSelectors.cutSource', () => {
  it('returns sourceRanges for internal cut', () => {
    const sourceRanges = [{ startRow: 4, startCol: 3, endRow: 6, endCol: 5 }];
    const state = createClipboardState(
      {
        sourceRanges,
        data: {
          sourceSheetId: 'sheet-123',
          cells: {},
          sourceRanges,
        },
        isCut: true,
      },
      'hasCut',
    );
    expect(clipboardSelectors.cutSource(state)).toEqual(sourceRanges);
  });

  it('returns null for external clipboard data (defensive check)', () => {
    // External paste always has isCut=false, but we test the defensive check
    const state = createClipboardState(
      {
        sourceRanges: [{ startRow: 0, startCol: 0, endRow: 2, endCol: 2 }],
        data: {
          sourceSheetId: EXTERNAL_SOURCE_SHEET_ID,
          cells: {},
          sourceRanges: [{ startRow: 0, startCol: 0, endRow: 2, endCol: 2 }],
        },
        isCut: true, // This wouldn't happen in practice, but tests the defensive check
      },
      'hasCut',
    );
    expect(clipboardSelectors.cutSource(state)).toBeNull();
  });

  it('returns null for copy operations', () => {
    const sourceRanges = [{ startRow: 4, startCol: 3, endRow: 6, endCol: 5 }];
    const state = createClipboardState(
      {
        sourceRanges,
        data: {
          sourceSheetId: 'sheet-123',
          cells: {},
          sourceRanges,
        },
        isCut: false,
      },
      'hasCopy',
    );
    expect(clipboardSelectors.cutSource(state)).toBeNull();
  });

  it('returns null when in empty state', () => {
    const state = createClipboardState({}, 'empty');
    expect(clipboardSelectors.cutSource(state)).toBeNull();
  });
});
