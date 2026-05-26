/**
 * Transient Visual Feedback Slice
 *
 * Manages transient visual feedback UI state (e.g., red flash on blocked edit attempt,
 * shimmer on recently-changed cells).
 * This state is ephemeral and auto-clears after the visual effect completes.
 *
 * Cut Cell Edit Blocking with Visual Feedback
 */

import type { CellRange } from '@mog-sdk/contracts/core';
import { DEFAULT_SHIMMER_CONFIG, type ShimmerEffectType } from '@mog-sdk/contracts/rendering';
import type { StateCreator } from 'zustand';

/**
 * Blocked edit attempt state.
 * Used to render a red flash effect in ui-layer when editing is blocked.
 */
export interface BlockedEditAttempt {
  /** Cell ID where edit was blocked (format: "sheetId:row:col") */
  cellId: string;
  /** Timestamp of the blocked attempt (for triggering animation restart) */
  timestamp: number;
}

/** Input for addShimmerEntries — startTime is stamped automatically. */
export interface ShimmerEntryInput {
  range: CellRange;
  sheetId: string;
}

export interface TransientVisualFeedbackSlice {
  /**
   * Current blocked edit attempt (for red flash visual feedback).
   * Set when user tries to edit a cell that's in cut ranges.
   * Automatically cleared after animation duration (500ms).
   */
  blockedEditAttempt: BlockedEditAttempt | null;

  /**
   * Set a blocked edit attempt (triggers red flash on cell).
   * Pass null to clear.
   *
   * @param cellId - Cell ID where edit was blocked, or null to clear
   */
  setBlockedEditAttempt: (cellId: string | null) => void;

  /** Active shimmer entries for visual feedback on changed cells. */
  shimmerEntries: readonly { range: CellRange; startTime: number; sheetId: string }[];

  /** Add shimmer entries — startTime is stamped as Date.now(). Auto-prunes after shimmerDurationMs. */
  addShimmerEntries: (entries: ShimmerEntryInput[]) => void;

  /** Clear all shimmer entries. */
  clearShimmerEntries: () => void;

  /** Which shimmer effect to render. Default: DEFAULT_SHIMMER_CONFIG.effect. */
  shimmerEffect: ShimmerEffectType;

  /** Set the active shimmer effect type. */
  setShimmerEffect: (effect: ShimmerEffectType) => void;

  /** Whether shimmer is enabled. Default: true. */
  shimmerEnabled: boolean;

  /** Toggle shimmer on/off. */
  setShimmerEnabled: (enabled: boolean) => void;

  /** Duration of shimmer effect in ms. Default: DEFAULT_SHIMMER_CONFIG.durationMs. */
  shimmerDurationMs: number;
}

/** Default shimmer duration in ms. */
const DEFAULT_SHIMMER_DURATION_MS = DEFAULT_SHIMMER_CONFIG.durationMs;

export const createTransientVisualFeedbackSlice: StateCreator<
  TransientVisualFeedbackSlice,
  [],
  [],
  TransientVisualFeedbackSlice
> = (set, get) => ({
  blockedEditAttempt: null,

  setBlockedEditAttempt: (cellId: string | null) => {
    if (cellId === null) {
      set({ blockedEditAttempt: null });
    } else {
      set({
        blockedEditAttempt: {
          cellId,
          timestamp: Date.now(),
        },
      });

      // Auto-clear after animation duration (500ms)
      setTimeout(() => {
        set({ blockedEditAttempt: null });
      }, 500);
    }
  },

  shimmerEntries: [],
  shimmerEffect: DEFAULT_SHIMMER_CONFIG.effect,
  shimmerEnabled: DEFAULT_SHIMMER_CONFIG.enabled,
  shimmerDurationMs: DEFAULT_SHIMMER_DURATION_MS,

  addShimmerEntries: (inputs: ShimmerEntryInput[]) => {
    const now = Date.now();
    const newEntries = inputs.map((e) => ({
      range: e.range,
      startTime: now,
      sheetId: e.sheetId,
    }));
    set((state) => ({
      shimmerEntries: [...state.shimmerEntries, ...newEntries],
    }));

    // Auto-prune after duration
    const duration = get().shimmerDurationMs;
    setTimeout(() => {
      set((state) => ({
        shimmerEntries: state.shimmerEntries.filter((e) => Date.now() - e.startTime < duration),
      }));
    }, duration + 50); // Small buffer to ensure entries are fully expired
  },

  clearShimmerEntries: () => {
    set({ shimmerEntries: [] });
  },

  setShimmerEffect: (effect: ShimmerEffectType) => {
    set({ shimmerEffect: effect });
  },

  setShimmerEnabled: (enabled: boolean) => {
    set({ shimmerEnabled: enabled });
  },
});
