/**
 * Pane Navigation Coordination
 *
 * Coordinates the pane focus machine with DOM elements.
 * The machine is pure (no DOM access), so all DOM operations
 * are executed here by the coordinator.
 *
 * Excel Parity Quickwin E1: F6 Pane Navigation
 *
 * Responsibilities:
 * - Tracks DOM element references for each pane
 * - Executes focus changes when machine state changes
 * - Handles focus fallbacks for missing elements
 *
 */

import type { Subscription } from 'xstate';
import type { PaneFocusActor, PaneType } from '../machines/pane-focus-machine';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Configuration for pane navigation coordination.
 */
export interface PaneNavigationCoordinationConfig {
  /** The pane focus actor to coordinate with */
  paneFocusActor: PaneFocusActor;
  /** Optional callback when pane focus changes */
  onPaneFocusChanged?: (pane: PaneType) => void;
}

/**
 * Result returned by setupPaneNavigationCoordination.
 */
export interface PaneNavigationCoordinationResult {
  /** Set the toolbar element reference */
  setToolbarElement: (el: HTMLElement | null) => void;
  /** Set the formula bar element reference */
  setFormulaBarElement: (el: HTMLElement | null) => void;
  /** Set the grid element reference */
  setGridElement: (el: HTMLElement | null) => void;
  /** Set the status bar element reference */
  setStatusBarElement: (el: HTMLElement | null) => void;
  /** Get the currently focused pane */
  getCurrentPane: () => PaneType;
  /** Dispose of subscriptions and cleanup */
  dispose: () => void;
}

// =============================================================================
// COORDINATION SETUP
// =============================================================================

/**
 * Set up pane navigation coordination.
 *
 * CRITICAL: Uses transition detection pattern - only focuses element
 * when pane actually changes, not on every subscription callback.
 *
 * @param config - Configuration including the pane focus actor
 * @returns Coordination result with element setters and cleanup
 */
export function setupPaneNavigationCoordination(
  config: PaneNavigationCoordinationConfig,
): PaneNavigationCoordinationResult {
  const { paneFocusActor, onPaneFocusChanged } = config;

  // Track DOM element references for each pane
  const paneElements: Record<PaneType, HTMLElement | null> = {
    toolbar: null,
    formulaBar: null,
    grid: null,
    statusBar: null,
  };

  // Track previous pane for transition detection
  let previousPane: PaneType | null = null;

  const subscriptions: Subscription[] = [];

  // Subscribe to pane focus changes and execute DOM focus
  const subscription = paneFocusActor.subscribe((state) => {
    const currentPane = state.context.currentPane;

    // CRITICAL: Only focus on actual transitions
    if (currentPane !== previousPane) {
      const element = paneElements[currentPane];

      if (element && document.contains(element)) {
        // Use requestAnimationFrame to ensure DOM is ready
        requestAnimationFrame(() => {
          element.focus();
        });
      } else {
        console.debug(
          `[PaneNavigationCoordination] No element for pane '${currentPane}', focus unchanged`,
        );
      }

      // Notify callback of focus change
      onPaneFocusChanged?.(currentPane);

      previousPane = currentPane;
    }
  });

  subscriptions.push(subscription);

  return {
    setToolbarElement: (el) => {
      paneElements.toolbar = el;
    },

    setFormulaBarElement: (el) => {
      paneElements.formulaBar = el;
    },

    setGridElement: (el) => {
      paneElements.grid = el;
    },

    setStatusBarElement: (el) => {
      paneElements.statusBar = el;
    },

    getCurrentPane: () => {
      return paneFocusActor.getSnapshot().context.currentPane;
    },

    dispose: () => {
      subscriptions.forEach((sub) => sub.unsubscribe());
      subscriptions.length = 0;
      paneElements.toolbar = null;
      paneElements.formulaBar = null;
      paneElements.grid = null;
      paneElements.statusBar = null;
    },
  };
}
