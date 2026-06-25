import { sheetId } from '@mog-sdk/contracts/core';

import {
  isActiveSheetViewSelectionChange,
  shouldRestoreImportedSelection,
} from '../useRendererViewRestore';

describe('shouldRestoreImportedSelection', () => {
  it('allows imported XLSX selection to replace untouched default A1 session state', () => {
    expect(
      shouldRestoreImportedSelection({
        sessionViewState: {
          ranges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }],
          activeCell: { row: 0, col: 0 },
        },
        restoredImportedSelection: false,
        savedSelectionIsValid: true,
      }),
    ).toBe(true);
  });

  it('keeps an established non-default session selection ahead of imported state', () => {
    expect(
      shouldRestoreImportedSelection({
        sessionViewState: {
          ranges: [{ startRow: 8, startCol: 1, endRow: 8, endCol: 1 }],
          activeCell: { row: 8, col: 1 },
        },
        restoredImportedSelection: false,
        savedSelectionIsValid: true,
      }),
    ).toBe(false);
  });

  it('does not restore invalid or already-restored imported selections', () => {
    expect(
      shouldRestoreImportedSelection({
        sessionViewState: undefined,
        restoredImportedSelection: false,
        savedSelectionIsValid: false,
      }),
    ).toBe(false);
    expect(
      shouldRestoreImportedSelection({
        sessionViewState: undefined,
        restoredImportedSelection: true,
        savedSelectionIsValid: true,
      }),
    ).toBe(false);
  });
});

describe('isActiveSheetViewSelectionChange', () => {
  it('matches only the active sheet view-selection event', () => {
    expect(isActiveSheetViewSelectionChange({ sheetId: 'sheet-2' }, sheetId('sheet-2'))).toBe(true);
    expect(isActiveSheetViewSelectionChange({ sheetId: 'sheet-1' }, sheetId('sheet-2'))).toBe(
      false,
    );
  });
});
