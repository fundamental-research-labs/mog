import type { StateCreator } from 'zustand';

export type SpreadsheetDisplayMode = 'light' | 'dark' | 'system';

const DISPLAY_MODE_KEY = 'mog-spreadsheet-display-mode';
const DEFAULT_DISPLAY_MODE: SpreadsheetDisplayMode = 'light';

export function normalizeSpreadsheetDisplayMode(value: unknown): SpreadsheetDisplayMode {
  return value === 'light' || value === 'dark' || value === 'system' ? value : DEFAULT_DISPLAY_MODE;
}

function loadDisplayMode(): SpreadsheetDisplayMode {
  if (typeof window === 'undefined') return DEFAULT_DISPLAY_MODE;
  try {
    return normalizeSpreadsheetDisplayMode(window.localStorage.getItem(DISPLAY_MODE_KEY));
  } catch {
    return DEFAULT_DISPLAY_MODE;
  }
}

function saveDisplayMode(mode: SpreadsheetDisplayMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DISPLAY_MODE_KEY, mode);
  } catch {
    // Display preference persistence is best-effort and must not block the app.
  }
}

export interface DisplayModeSlice {
  spreadsheetDisplayMode: SpreadsheetDisplayMode;
  setSpreadsheetDisplayMode: (mode: SpreadsheetDisplayMode) => void;
}

export const createDisplayModeSlice: StateCreator<DisplayModeSlice, [], [], DisplayModeSlice> = (
  set,
) => ({
  spreadsheetDisplayMode: loadDisplayMode(),
  setSpreadsheetDisplayMode: (mode) => {
    const normalized = normalizeSpreadsheetDisplayMode(mode);
    saveDisplayMode(normalized);
    set({ spreadsheetDisplayMode: normalized });
  },
});
