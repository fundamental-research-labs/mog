/**
 * Chart Clipboard Slice
 *
 * Manages ephemeral clipboard state for chart copy/cut/paste operations.
 * Chart Copy/Paste
 *
 * Architecture:
 * - UIStore holds ephemeral clipboard state (not synced to Yjs)
 * - Copied chart data is serialized for paste
 * - Cut operation stores source chart ID for deletion after paste
 *
 */

import type { StateCreator } from 'zustand';

import type { SerializedChart } from '@mog/charts';

/**
 * Serialized chart data for clipboard operations.
 * Contains all data needed to recreate the chart on paste.
 */
export interface ChartClipboardData {
  /** Serialized chart configuration (without ID - new ID generated on paste) */
  config: Omit<SerializedChart, 'id'>;
  /** Source sheet ID for cross-sheet paste */
  sourceSheetId: string;
  /** Timestamp when copied */
  copiedAt: number;
}

/**
 * Chart clipboard state
 */
export interface ChartClipboardState {
  /** Copied chart data (null if clipboard empty) */
  copiedChart: ChartClipboardData | null;
  /** Source chart ID if this was a cut operation (for deletion after paste) */
  cutChartId: string | null;
  /** Whether the clipboard contains a cut chart (vs copy) */
  isCut: boolean;
}

export interface ChartClipboardSlice {
  /** Chart clipboard state */
  chartClipboard: ChartClipboardState;

  /**
   * Copy a chart to clipboard.
   * Does not modify the source chart.
   */
  copyChartToClipboard: (chart: SerializedChart, sourceSheetId: string) => void;

  /**
   * Cut a chart to clipboard.
   * Marks the chart for deletion after paste.
   */
  cutChartToClipboard: (chart: SerializedChart, sourceSheetId: string) => void;

  /**
   * Clear the chart clipboard.
   * Called after paste (for cut) or when clipboard is cleared.
   */
  clearChartClipboard: () => void;

  /**
   * Check if chart clipboard has content.
   */
  hasChartInClipboard: () => boolean;
}

const initialChartClipboard: ChartClipboardState = {
  copiedChart: null,
  cutChartId: null,
  isCut: false,
};

export const createChartClipboardSlice: StateCreator<
  ChartClipboardSlice,
  [],
  [],
  ChartClipboardSlice
> = (set, get) => ({
  chartClipboard: initialChartClipboard,

  copyChartToClipboard: (chart: SerializedChart, sourceSheetId: string) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, ...configWithoutId } = chart;
    set({
      chartClipboard: {
        copiedChart: {
          config: configWithoutId,
          sourceSheetId,
          copiedAt: Date.now(),
        },
        cutChartId: null,
        isCut: false,
      },
    });
  },

  cutChartToClipboard: (chart: SerializedChart, sourceSheetId: string) => {
    const { id, ...configWithoutId } = chart;
    set({
      chartClipboard: {
        copiedChart: {
          config: configWithoutId,
          sourceSheetId,
          copiedAt: Date.now(),
        },
        cutChartId: id,
        isCut: true,
      },
    });
  },

  clearChartClipboard: () => {
    set({ chartClipboard: initialChartClipboard });
  },

  hasChartInClipboard: () => {
    return get().chartClipboard.copiedChart !== null;
  },
});
