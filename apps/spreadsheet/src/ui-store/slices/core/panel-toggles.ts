/**
 * Panel Toggles UI Slice
 *
 * Owns the visible/hidden state for the user-closable chrome panels:
 * - formula-bar (between toolbar and grid; fx + cell address + value)
 * - status-bar (bottom strip; mode indicator + selection stats + zoom)
 * - find (Find & Replace dialog; Ctrl+F)
 * - comments (right-side comments pane; lists workbook comments)
 * - side (generic right-side panel host; chart editor / pivot / version / etc.)
 *
 * The ribbon's hidden-state lives in the RibbonSlice as `ribbonCollapsed`
 * (Ctrl+Shift+F1 / panel-ribbon-close); Excel only has one ribbon-hidden
 * state, so this slice no longer carries a parallel `ribbonVisible` flag.
 *
 * All five satisfy the chrome-symmetry contract:
 * 1. Each panel ships its own `panel-<id>-close` affordance.
 * 2. Each panel is hidden when its toggle is `false`.
 * 3. The View ribbon "Show" section carries `panel-<id>-reopen`
 * buttons (also tagged `[data-action="open-panel-<id>"]`) so the
 * user is never stranded with no way back.
 *
 * The `find` and `side` panels are special:
 * - `find` visibility is owned by the find-replace XState machine
 * (so Ctrl+F + Escape continue to be the keyboard-first contract).
 * The reopen affordance dispatches `OPEN_FIND_DIALOG`.
 * - `side` is a host that wraps the chart-editor, pivot-field,
 * accessibility-checker, and extension panels. The `sideClosed`
 * flag suppresses the host wrapper. The reopen affordance defaults
 * to opening the accessibility checker (which works without
 * selecting a chart/pivot first).
 */

import type { StateCreator } from 'zustand';

export interface PanelTogglesSlice {
  /** Whether the formula bar (fx + cell address) is visible. */
  formulaBarVisible: boolean;
  /** Whether the status bar (mode, stats, zoom) is visible. */
  statusBarVisible: boolean;
  /** Whether the comments pane is visible. */
  commentsPanelVisible: boolean;
  /** Whether the side panel host (charts/pivot/accessibility) is visible. */
  sidePanelVisible: boolean;
  /** Which side-panel surface should be shown by the generic host. */
  sidePanelContent: SidePanelContent;

  setFormulaBarVisible: (visible: boolean) => void;
  toggleFormulaBarVisible: () => void;

  setStatusBarVisible: (visible: boolean) => void;
  toggleStatusBarVisible: () => void;

  setCommentsPanelVisible: (visible: boolean) => void;
  toggleCommentsPanelVisible: () => void;

  setSidePanelVisible: (visible: boolean) => void;
  toggleSidePanelVisible: () => void;
  setSidePanelContent: (content: SidePanelContent) => void;
}

export type SidePanelContent = 'index' | 'formula-references' | 'version-history';

export const createPanelTogglesSlice: StateCreator<PanelTogglesSlice, [], [], PanelTogglesSlice> = (
  set,
) => ({
  formulaBarVisible: true,
  statusBarVisible: true,
  commentsPanelVisible: false,
  sidePanelVisible: false,
  sidePanelContent: 'index',

  setFormulaBarVisible: (visible) => set({ formulaBarVisible: visible }),
  toggleFormulaBarVisible: () => set((s) => ({ formulaBarVisible: !s.formulaBarVisible })),

  setStatusBarVisible: (visible) => set({ statusBarVisible: visible }),
  toggleStatusBarVisible: () => set((s) => ({ statusBarVisible: !s.statusBarVisible })),

  setCommentsPanelVisible: (visible) => set({ commentsPanelVisible: visible }),
  toggleCommentsPanelVisible: () => set((s) => ({ commentsPanelVisible: !s.commentsPanelVisible })),

  setSidePanelVisible: (visible) => set({ sidePanelVisible: visible }),
  toggleSidePanelVisible: () => set((s) => ({ sidePanelVisible: !s.sidePanelVisible })),
  setSidePanelContent: (content) => set({ sidePanelContent: content }),
});
