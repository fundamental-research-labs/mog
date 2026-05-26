/**
 * Pane Focus Actor Selectors
 *
 * Pure functions that extract data from pane focus state.
 * Copied from kernel/src/selectors/ during kernel export tightening.
 */

import type { PaneFocusState } from '@mog-sdk/contracts/actors/pane-focus';

export const paneFocusSelectors = {
  // ---------------------------------------------------------------------------
  // Value selectors
  // ---------------------------------------------------------------------------
  currentPane: (state: PaneFocusState) => state.context.currentPane,
  previousPane: (state: PaneFocusState) => state.context.previousPane,

  // ---------------------------------------------------------------------------
  // State matching selectors
  // ---------------------------------------------------------------------------
  isToolbarFocused: (state: PaneFocusState): boolean => state.matches('toolbar'),
  isFormulaBarFocused: (state: PaneFocusState): boolean => state.matches('formulaBar'),
  isGridFocused: (state: PaneFocusState): boolean => state.matches('grid'),
  isStatusBarFocused: (state: PaneFocusState): boolean => state.matches('statusBar'),

  // ---------------------------------------------------------------------------
  // Derived selectors
  // ---------------------------------------------------------------------------
  isGrid: (state: PaneFocusState): boolean => state.context.currentPane === 'grid',

  /** Get the current machine state value */
  machineState: (state: PaneFocusState): string => state.value,
};
