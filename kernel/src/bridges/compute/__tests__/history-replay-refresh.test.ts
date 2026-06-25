import { jest } from '@jest/globals';

import { refreshViewportsAfterHistoryReplay } from '../history-replay-refresh';
import type { MutationResult } from '../compute-types.gen';

function makeResult(overrides: Partial<MutationResult>): MutationResult {
  return {
    recalc: {
      changedCells: [],
      projectionChanges: [],
      errors: [],
      validationAnnotations: [],
      metrics: {},
      oldValues: {},
    },
    ...overrides,
  } as MutationResult;
}

function makeFetchManager() {
  return {
    forceRefreshAllViewports: jest.fn(async () => undefined),
    forceRefreshSheetViewports: jest.fn(async () => undefined),
  };
}

describe('refreshViewportsAfterHistoryReplay', () => {
  it('refreshes only affected sheets for history replay dimension, merge, and visibility changes', async () => {
    const fetchManager = makeFetchManager();

    await refreshViewportsAfterHistoryReplay(
      fetchManager as never,
      makeResult({
        dimensionChanges: [{ sheetId: 'sheet-1', axis: 'col', index: 18, kind: 'Set', size: 64 }],
        mergeChanges: [
          {
            sheetId: 'sheet-1',
            kind: 'Set',
            startRow: 79,
            startCol: 18,
            endRow: 79,
            endCol: 18,
          },
        ],
        visibilityChanges: [{ sheetId: 'sheet-2', axis: 'row', index: 5, hidden: true }],
      }),
    );

    expect(fetchManager.forceRefreshAllViewports).not.toHaveBeenCalled();
    expect(fetchManager.forceRefreshSheetViewports).toHaveBeenCalledTimes(2);
    expect(fetchManager.forceRefreshSheetViewports).toHaveBeenCalledWith('sheet-1');
    expect(fetchManager.forceRefreshSheetViewports).toHaveBeenCalledWith('sheet-2');
  });

  it('keeps workbook-wide history metadata on the full viewport refresh path', async () => {
    const fetchManager = makeFetchManager();

    await refreshViewportsAfterHistoryReplay(
      fetchManager as never,
      makeResult({
        workbookSettingsChanges: [
          { kind: 'Set', changedKeys: ['date1904'], settings: { date1904: true } },
        ],
      }),
    );

    expect(fetchManager.forceRefreshAllViewports).toHaveBeenCalledTimes(1);
    expect(fetchManager.forceRefreshSheetViewports).not.toHaveBeenCalled();
  });
});
