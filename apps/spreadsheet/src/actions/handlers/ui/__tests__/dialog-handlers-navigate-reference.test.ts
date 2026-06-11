import { describe, expect, jest, test } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';

import { NAVIGATE_TO_REFERENCE } from '../dialog-handlers';

function createDeps(reference: string) {
  const selection = {
    setSelection: jest.fn(),
  };
  const uiState = {
    goToDialog: {
      pendingGoToReference: reference,
    },
    addRecentLocation: jest.fn(),
    clearPendingGoToReference: jest.fn(),
    closeGoToDialog: jest.fn(),
  };

  const deps = {
    commands: { selection },
    uiStore: {
      getState: () => uiState,
    },
    workbook: {},
  } as unknown as ActionDependencies;

  return { deps, selection, uiState };
}

describe('NAVIGATE_TO_REFERENCE', () => {
  test('anchors range navigation at the range start so viewport-follow can reveal the far edge', async () => {
    const { deps, selection, uiState } = createDeps('AQ469:AT469');

    const result = await NAVIGATE_TO_REFERENCE(deps);

    expect(result).toEqual({ handled: true });
    expect(selection.setSelection).toHaveBeenCalledWith(
      [{ startRow: 468, startCol: 42, endRow: 468, endCol: 45 }],
      { row: 468, col: 42 },
      { row: 468, col: 42 },
    );
    expect(uiState.addRecentLocation).toHaveBeenCalledWith('AQ469:AT469', undefined);
    expect(uiState.clearPendingGoToReference).toHaveBeenCalledTimes(1);
    expect(uiState.closeGoToDialog).toHaveBeenCalledTimes(1);
  });

  test('single-cell navigation keeps a single-cell selection', async () => {
    const { deps, selection } = createDeps('K469');

    const result = await NAVIGATE_TO_REFERENCE(deps);

    expect(result).toEqual({ handled: true });
    expect(selection.setSelection).toHaveBeenCalledWith(
      [{ startRow: 468, startCol: 10, endRow: 468, endCol: 10 }],
      { row: 468, col: 10 },
    );
  });
});
