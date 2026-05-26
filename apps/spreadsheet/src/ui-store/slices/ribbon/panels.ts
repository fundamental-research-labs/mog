/**
 * Panels UI Store Slice
 *
 * Manages visibility state for side panels that overlay the grid.
 * These panels include:
 * - Test panel (spreadsheet assertions/testing)
 * - Extension panel (add-in hosting)
 *
 * Architecture:
 * - Panel containers subscribe to their visibility state from this slice
 * - Visibility can be toggled via actions or set programmatically
 * - This enables panels to be self-subscribing without prop drilling
 *
 * @see apps/spreadsheet/src/layers/PanelLayer.tsx
 */

import type { StateCreator } from 'zustand';

// =============================================================================
// Types
// =============================================================================

export interface PanelsSlice {
  /** Whether the test panel is visible */
  showTestPanel: boolean;

  /** Whether the extension panel is visible */
  showExtensionPanel: boolean;

  /** Show the test panel */
  showTestPanelAction: () => void;

  /** Hide the test panel */
  hideTestPanelAction: () => void;

  /** Toggle the test panel visibility */
  toggleTestPanel: () => void;

  /** Show the extension panel */
  showExtensionPanelAction: () => void;

  /** Hide the extension panel */
  hideExtensionPanelAction: () => void;

  /** Toggle the extension panel visibility */
  toggleExtensionPanel: () => void;

  /** Set all panel visibility states at once (useful for initialization) */
  setPanelVisibility: (panels: { showTestPanel?: boolean; showExtensionPanel?: boolean }) => void;
}

// =============================================================================
// Slice Creator
// =============================================================================

/**
 * Creates the panels slice for the UI store.
 */
export const createPanelsSlice: StateCreator<PanelsSlice, [], [], PanelsSlice> = (set) => ({
  // Initial state - all panels hidden by default
  showTestPanel: false,
  showExtensionPanel: false,

  // Test panel actions
  showTestPanelAction: () => set({ showTestPanel: true }),
  hideTestPanelAction: () => set({ showTestPanel: false }),
  toggleTestPanel: () => set((state) => ({ showTestPanel: !state.showTestPanel })),

  // Extension panel actions
  showExtensionPanelAction: () => set({ showExtensionPanel: true }),
  hideExtensionPanelAction: () => set({ showExtensionPanel: false }),
  toggleExtensionPanel: () => set((state) => ({ showExtensionPanel: !state.showExtensionPanel })),

  // Batch update
  setPanelVisibility: (panels) =>
    set((state) => ({
      showTestPanel: panels.showTestPanel ?? state.showTestPanel,
      showExtensionPanel: panels.showExtensionPanel ?? state.showExtensionPanel,
    })),
});
