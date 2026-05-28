/**
 * Ribbon Slice (Excel Parity 06-RIBBON-UI - Ribbon Display Modes)
 *
 * Manages ribbon visibility and display mode state:
 * - Ctrl+Shift+F1: Full collapse toggle (hides entire ribbon)
 * - Ctrl+F1: Toggle between "Show Tabs and Commands" and "Show Tabs" mode
 * - Display mode dropdown: Full, Tabs-only, Auto-hide
 */

import type { StateCreator } from 'zustand';

/**
 * Ribbon display modes matching Excel behavior:
 * - 'full': Show tabs and commands (default)
 * - 'tabs-only': Show only tabs, click tab to temporarily reveal commands
 * - 'auto-hide': Hide entire ribbon, hover top edge to reveal
 */
export type RibbonDisplayMode = 'full' | 'tabs-only' | 'auto-hide';

const RIBBON_DISPLAY_MODE_KEY = 'ribbon-display-mode';

/**
 * Load saved display mode from localStorage
 */
function loadDisplayMode(): RibbonDisplayMode {
  if (typeof window === 'undefined') return 'full';
  const saved = localStorage.getItem(RIBBON_DISPLAY_MODE_KEY);
  if (saved === 'full' || saved === 'tabs-only' || saved === 'auto-hide') {
    return saved;
  }
  return 'full';
}

/**
 * Save display mode to localStorage
 */
function saveDisplayMode(mode: RibbonDisplayMode): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(RIBBON_DISPLAY_MODE_KEY, mode);
}

export interface RibbonSlice {
  /** Whether the ribbon is collapsed (hidden) - Ctrl+Shift+F1 */
  ribbonCollapsed: boolean;
  /** Current display mode: full, tabs-only, or auto-hide */
  displayMode: RibbonDisplayMode;
  /** Whether ribbon is temporarily shown (for tabs-only and auto-hide modes) */
  temporaryShow: boolean;
  /** Whether KeyTips are active (F10/Alt activation) */
  keyTipsActive: boolean;
  /** Currently active tab ID for KeyTip navigation */
  keyTipActiveTabId: string | null;

  /** Toggle ribbon visibility (Ctrl+Shift+F1) */
  toggleRibbon: () => void;
  /** Set ribbon display mode */
  setDisplayMode: (mode: RibbonDisplayMode) => void;
  /** Toggle between full and tabs-only mode (Ctrl+F1) */
  toggleTabsMode: () => void;
  /** Show ribbon temporarily (for tabs-only and auto-hide) */
  showTemporarily: () => void;
  /** Hide temporarily shown ribbon */
  hideTemporarily: () => void;
  /** Activate KeyTips mode (F10) */
  activateKeyTips: () => void;
  /** Deactivate KeyTips mode (Escape or action completion) */
  deactivateKeyTips: () => void;
  /** Set active tab for KeyTip navigation */
  setKeyTipActiveTab: (tabId: string | null) => void;
}

export const createRibbonSlice: StateCreator<RibbonSlice, [], [], RibbonSlice> = (set, get) => ({
  ribbonCollapsed: false,
  displayMode: loadDisplayMode(),
  temporaryShow: false,
  keyTipsActive: false,
  keyTipActiveTabId: null,

  toggleRibbon: () => {
    set((s) => {
      if (s.ribbonCollapsed) {
        return {
          ribbonCollapsed: false,
          temporaryShow: s.displayMode !== 'full',
        };
      }

      return {
        ribbonCollapsed: true,
        temporaryShow: false,
      };
    });
  },

  setDisplayMode: (mode: RibbonDisplayMode) => {
    saveDisplayMode(mode);
    set({ displayMode: mode, temporaryShow: false });
  },

  toggleTabsMode: () => {
    const { displayMode } = get();
    // Only toggle between 'full' and 'tabs-only', not auto-hide
    if (displayMode === 'auto-hide') return;

    const newMode: RibbonDisplayMode = displayMode === 'full' ? 'tabs-only' : 'full';
    saveDisplayMode(newMode);
    set({
      ribbonCollapsed: false,
      displayMode: newMode,
      temporaryShow: newMode !== 'full',
    });
  },

  showTemporarily: () => {
    const { displayMode } = get();
    // Only allow temporary show in tabs-only or auto-hide mode
    if (displayMode === 'full') return;
    set({ temporaryShow: true });
  },

  hideTemporarily: () => {
    set({ temporaryShow: false });
  },

  activateKeyTips: () => {
    set({ keyTipsActive: true, keyTipActiveTabId: null });
  },

  deactivateKeyTips: () => {
    set({ keyTipsActive: false, keyTipActiveTabId: null });
  },

  setKeyTipActiveTab: (tabId: string | null) => {
    set({ keyTipActiveTabId: tabId });
  },
});
