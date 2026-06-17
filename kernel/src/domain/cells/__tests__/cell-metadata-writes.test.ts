import { jest } from '@jest/globals';
import { sheetId } from '@mog-sdk/contracts/core';

import type { DocumentContext } from '../../../context/types';
import { writeMetadataViaFormatChannel } from '../cell-metadata-writes';

type Bridge = DocumentContext['computeBridge'];

function buildCtx(bridge: Partial<Bridge>): DocumentContext {
  return {
    computeBridge: bridge,
  } as unknown as DocumentContext;
}

describe('writeMetadataViaFormatChannel', () => {
  it('routes validation-origin metadata through the UI-state format command', () => {
    const setFormatForRanges = jest.fn();
    const setFormatForRangesUiState = jest.fn();
    const ctx = buildCtx({
      setFormatForRanges,
      setFormatForRangesUiState,
    } as unknown as Partial<Bridge>);

    writeMetadataViaFormatChannel(
      ctx,
      sheetId('S1'),
      [[2, 1, 2, 1]],
      { validationErrors: [] },
      'validation',
    );

    expect(setFormatForRanges).not.toHaveBeenCalled();
    expect(setFormatForRangesUiState).toHaveBeenCalledWith(sheetId('S1'), [[2, 1, 2, 1]], {
      validationErrors: [],
    });
  });

  it('keeps user-origin metadata on the undo-tracked format command', () => {
    const setFormatForRanges = jest.fn();
    const setFormatForRangesUiState = jest.fn();
    const ctx = buildCtx({
      setFormatForRanges,
      setFormatForRangesUiState,
    } as unknown as Partial<Bridge>);

    writeMetadataViaFormatChannel(
      ctx,
      sheetId('S1'),
      [[2, 1, 2, 1]],
      { validationErrors: [] },
      'user',
    );

    expect(setFormatForRangesUiState).not.toHaveBeenCalled();
    expect(setFormatForRanges).toHaveBeenCalledWith(sheetId('S1'), [[2, 1, 2, 1]], {
      validationErrors: [],
    });
  });
});
