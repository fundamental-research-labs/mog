import { create } from 'zustand';
import {
  createDisplayModeSlice,
  normalizeSpreadsheetDisplayMode,
  type DisplayModeSlice,
} from '../core/display-mode';

describe('display mode slice', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('falls back unknown values to light', () => {
    expect(normalizeSpreadsheetDisplayMode('sepia')).toBe('light');
    expect(normalizeSpreadsheetDisplayMode(null)).toBe('light');
  });

  it('persists app-scoped display preference without workbook state', () => {
    const store = create<DisplayModeSlice>()((...args) => createDisplayModeSlice(...args));

    expect(store.getState().spreadsheetDisplayMode).toBe('light');
    store.getState().setSpreadsheetDisplayMode('dark');

    expect(store.getState().spreadsheetDisplayMode).toBe('dark');
    expect(window.localStorage.getItem('mog-spreadsheet-display-mode')).toBe('dark');
  });
});
