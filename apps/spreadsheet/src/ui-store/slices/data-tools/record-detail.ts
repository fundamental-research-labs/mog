/**
 * Record Detail Slice
 *
 * Manages the record detail sidebar state.
 * The record detail sidebar shows detailed information about a selected
 * table row, allowing viewing and editing of all fields.
 */

import type { StateCreator } from 'zustand';

/**
 * Record detail sidebar state
 */
export interface RecordDetailState {
  /** Currently open record detail, or null if closed */
  recordDetail: {
    tableId: string;
    rowId: string;
  } | null;
}

export interface RecordDetailSlice extends RecordDetailState {
  /** Open the record detail sidebar for a specific row */
  openRecordDetail: (tableId: string, rowId: string) => void;
  /** Close the record detail sidebar */
  closeRecordDetail: () => void;
}

const initialState: RecordDetailState = {
  recordDetail: null,
};

export const createRecordDetailSlice: StateCreator<RecordDetailSlice, [], [], RecordDetailSlice> = (
  set,
) => ({
  ...initialState,

  openRecordDetail: (tableId: string, rowId: string) => {
    set({ recordDetail: { tableId, rowId } });
  },

  closeRecordDetail: () => {
    set({ recordDetail: null });
  },
});
