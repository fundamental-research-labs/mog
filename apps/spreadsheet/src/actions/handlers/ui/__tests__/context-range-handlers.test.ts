import { describe, expect, jest, test } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';

import {
  CANCEL_RANGE_SELECTION,
  COMPLETE_RANGE_SELECTION,
  START_RANGE_SELECTION_MODE,
  UPDATE_RANGE_SELECTION,
} from '../context-range-handlers';

function createDeps() {
  const uiState = {
    startRangeSelectionMode: jest.fn(),
    updateRangeSelection: jest.fn(),
    completeRangeSelection: jest.fn(),
    cancelRangeSelection: jest.fn(),
  };

  const deps = {
    uiStore: {
      getState: () => uiState,
    },
  } as unknown as ActionDependencies;

  return { deps, uiState };
}

describe('context range handlers', () => {
  test('START_RANGE_SELECTION_MODE forwards callbacks through the action path', () => {
    const { deps, uiState } = createDeps();
    const onComplete = jest.fn();
    const onCancel = jest.fn();

    const result = START_RANGE_SELECTION_MODE(deps, {
      dialogId: 'create-pivot-dialog',
      inputId: 'source-range',
      initialRange: 'Data!A1:B5',
      allowMultipleRanges: true,
      inputMode: 'single-cell',
      onComplete,
      onCancel,
    });

    expect(result).toEqual({ handled: true });
    expect(uiState.startRangeSelectionMode).toHaveBeenCalledWith(
      'create-pivot-dialog',
      'source-range',
      'Data!A1:B5',
      {
        allowMultipleRanges: true,
        inputMode: 'single-cell',
        onComplete,
        onCancel,
      },
    );
  });

  test('range selection update/complete/cancel actions call UI store operations', () => {
    const { deps, uiState } = createDeps();

    expect(UPDATE_RANGE_SELECTION(deps, { range: 'A1:C3' })).toEqual({ handled: true });
    expect(COMPLETE_RANGE_SELECTION(deps)).toEqual({ handled: true });
    expect(CANCEL_RANGE_SELECTION(deps)).toEqual({ handled: true });

    expect(uiState.updateRangeSelection).toHaveBeenCalledWith('A1:C3');
    expect(uiState.completeRangeSelection).toHaveBeenCalledTimes(1);
    expect(uiState.cancelRangeSelection).toHaveBeenCalledTimes(1);
  });

  test('START_RANGE_SELECTION_MODE rejects missing dialog/input identity', () => {
    const { deps, uiState } = createDeps();

    expect(
      START_RANGE_SELECTION_MODE(deps, { dialogId: '', inputId: 'source', initialRange: '' }),
    ).toEqual({
      handled: false,
      reason: 'disabled',
    });
    expect(uiState.startRangeSelectionMode).not.toHaveBeenCalled();
  });
});
