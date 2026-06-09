import { describe, expect, jest, test } from '@jest/globals';
import { create } from 'zustand';

import { createDialogStackSlice, type DialogStackSlice } from '../dialogs/dialog-stack';
import {
  createRangeSelectionModeSlice,
  type RangeSelectionModeSlice,
} from './range-selection-mode';

type TestRangeSelectionStore = DialogStackSlice & RangeSelectionModeSlice;

function createTestStore() {
  return create<TestRangeSelectionStore>()((...args) => ({
    ...createDialogStackSlice(...args),
    ...createRangeSelectionModeSlice(...args),
  }));
}

describe('range selection mode', () => {
  test('single-cell inputs auto-complete selected cells and restore their dialog', () => {
    const store = createTestStore();
    const onComplete = jest.fn();

    store.getState().registerDialog('goal-seek-dialog');
    store.getState().startRangeSelectionMode('goal-seek-dialog', 'goal-seek-set-cell', '', {
      allowMultipleRanges: true,
      inputMode: 'single-cell',
      onComplete,
    });

    expect(store.getState().rangeSelectionMode).toMatchObject({
      active: true,
      allowMultipleRanges: false,
      inputMode: 'single-cell',
    });
    expect(store.getState().dialogStack['goal-seek-dialog']?.isMinimized).toBe(true);

    store.getState().updateRangeSelection('C3');

    expect(onComplete).toHaveBeenCalledWith('C3');
    expect(store.getState().rangeSelectionMode.active).toBe(false);
    expect(store.getState().dialogStack['goal-seek-dialog']?.isMinimized).toBe(false);
  });

  test('single-cell inputs ignore row, column, and multi-cell range updates', () => {
    const store = createTestStore();
    const onComplete = jest.fn();

    store.getState().registerDialog('goal-seek-dialog');
    store.getState().startRangeSelectionMode('goal-seek-dialog', 'goal-seek-by-changing', 'B1', {
      inputMode: 'single-cell',
      onComplete,
    });

    store.getState().updateRangeSelection('A1:B2');
    store.getState().updateRangeSelection('$1:$1');
    store.getState().updateRangeSelection('$A:$A');

    expect(onComplete).not.toHaveBeenCalled();
    expect(store.getState().rangeSelectionMode).toMatchObject({
      active: true,
      currentRange: 'B1',
      inputMode: 'single-cell',
    });
  });
});
