/**
 * Transient Visual Feedback Slice Tests
 *
 * Tests for shimmer entries, auto-pruning, and configuration state.
 */

import { create } from 'zustand';
import { jest } from '@jest/globals';

import { DEFAULT_SHIMMER_CONFIG } from '@mog-sdk/contracts/rendering';

import {
  createTransientVisualFeedbackSlice,
  type TransientVisualFeedbackSlice,
} from '../view/transient-visual-feedback';

function createTestStore() {
  return create<TransientVisualFeedbackSlice>()(createTransientVisualFeedbackSlice);
}

describe('TransientVisualFeedbackSlice – shimmer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('has correct initial state', () => {
    const store = createTestStore();
    const state = store.getState();
    expect(state.shimmerEntries).toEqual([]);
    expect(state.shimmerEnabled).toBe(DEFAULT_SHIMMER_CONFIG.enabled);
    expect(state.shimmerEffect).toBe(DEFAULT_SHIMMER_CONFIG.effect);
    expect(state.shimmerDurationMs).toBe(DEFAULT_SHIMMER_CONFIG.durationMs);
  });

  it('addShimmerEntries stamps Date.now() as startTime', () => {
    const store = createTestStore();
    const now = 12345;
    jest.setSystemTime(now);

    store
      .getState()
      .addShimmerEntries([
        { range: { startRow: 0, startCol: 0, endRow: 2, endCol: 2 }, sheetId: 'sheet1' },
      ]);

    const entries = store.getState().shimmerEntries;
    expect(entries.length).toBe(1);
    expect(entries[0].startTime).toBe(now);
    expect(entries[0].sheetId).toBe('sheet1');
  });

  it('addShimmerEntries appends to existing entries', () => {
    const store = createTestStore();

    store
      .getState()
      .addShimmerEntries([
        { range: { startRow: 0, startCol: 0, endRow: 0, endCol: 0 }, sheetId: 's1' },
      ]);
    store
      .getState()
      .addShimmerEntries([
        { range: { startRow: 1, startCol: 1, endRow: 1, endCol: 1 }, sheetId: 's1' },
      ]);

    expect(store.getState().shimmerEntries.length).toBe(2);
  });

  it('clearShimmerEntries removes all entries', () => {
    const store = createTestStore();

    store
      .getState()
      .addShimmerEntries([
        { range: { startRow: 0, startCol: 0, endRow: 0, endCol: 0 }, sheetId: 's1' },
      ]);
    expect(store.getState().shimmerEntries.length).toBe(1);

    store.getState().clearShimmerEntries();
    expect(store.getState().shimmerEntries.length).toBe(0);
  });

  it('auto-prunes expired entries after durationMs', () => {
    const store = createTestStore();
    jest.setSystemTime(1000);

    store
      .getState()
      .addShimmerEntries([
        { range: { startRow: 0, startCol: 0, endRow: 0, endCol: 0 }, sheetId: 's1' },
      ]);
    expect(store.getState().shimmerEntries.length).toBe(1);

    // Advance past durationMs + buffer.
    const elapsedMs = DEFAULT_SHIMMER_CONFIG.durationMs + 100;
    jest.setSystemTime(1000 + elapsedMs);
    jest.advanceTimersByTime(elapsedMs);

    expect(store.getState().shimmerEntries.length).toBe(0);
  });

  it('setShimmerEffect updates the effect type', () => {
    const store = createTestStore();
    store.getState().setShimmerEffect('pulse');
    expect(store.getState().shimmerEffect).toBe('pulse');
  });

  it('setShimmerEnabled toggles shimmer on/off', () => {
    const store = createTestStore();
    store.getState().setShimmerEnabled(false);
    expect(store.getState().shimmerEnabled).toBe(false);
    store.getState().setShimmerEnabled(true);
    expect(store.getState().shimmerEnabled).toBe(true);
  });
});
