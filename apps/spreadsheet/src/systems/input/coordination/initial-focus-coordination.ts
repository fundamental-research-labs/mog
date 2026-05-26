/**
 * Initial Focus Coordination
 *
 * Establishes keyboard focus when the spreadsheet first becomes ready for input.
 * This bridges the gap between:
 * - Focus machine (tracks logical focus state)
 * - Focus coordination (executes DOM focus operations)
 * - Renderer machine (tracks rendering readiness)
 *
 * The grid is "ready for input" when:
 * 1. Grid container is registered (DOM mounted)
 * 2. Renderer is in 'ready' state (canvas operational)
 *
 * This is a one-time operation on initial load. Sheet switches and dialog
 * restoration are handled by other coordination modules.
 *
 */

import type { ActorRefFrom } from 'xstate';
import type { rendererMachine } from '../../renderer/machines/grid-renderer-machine';
import type { FocusCoordination } from './focus-coordination';

// =============================================================================
// TYPES
// =============================================================================

type RendererActor = ActorRefFrom<typeof rendererMachine>;

export interface InitialFocusCoordinationConfig {
  /** The renderer actor to watch for 'ready' state */
  rendererActor: RendererActor;
  /** The focus coordination instance for DOM operations */
  focusCoordination: FocusCoordination;
}

// =============================================================================
// INITIAL FOCUS COORDINATION
// =============================================================================

/**
 * Set up initial focus coordination.
 *
 * Watches for both renderer readiness and grid container registration.
 * When both conditions are met for the first time, focuses the grid container
 * to enable immediate keyboard input.
 *
 * Respects user intent: if something already has focus (user clicked during
 * initialization), does not steal focus.
 *
 * @param config - Configuration with renderer actor and focus coordination
 * @returns Cleanup function to unsubscribe from renderer state
 */
export function setupInitialFocusCoordination(config: InitialFocusCoordinationConfig): () => void {
  const { rendererActor, focusCoordination } = config;

  let hasInitializedFocus = false;
  let isRendererReady = false;
  let isContainerRegistered = false;

  const tryEstablishFocus = () => {
    if (hasInitializedFocus) return;
    if (!isRendererReady || !isContainerRegistered) return;

    // Only establish focus if nothing else has focus
    // (user may have clicked something during initialization)
    const activeElement = document.activeElement;
    const isBodyOrHtml =
      !activeElement ||
      activeElement === document.body ||
      activeElement === document.documentElement;

    if (!isBodyOrHtml) {
      // Something already has focus - don't steal it
      hasInitializedFocus = true;
      return;
    }

    hasInitializedFocus = true;

    // Use requestAnimationFrame to ensure DOM is settled before focus
    requestAnimationFrame(() => {
      focusCoordination.focusGridContainerElement();
    });
  };

  // Watch renderer state for 'ready' transition
  const rendererSub = rendererActor.subscribe((state) => {
    if (state.value === 'ready' && !isRendererReady) {
      isRendererReady = true;
      tryEstablishFocus();
    }
  });

  // Watch for grid container registration
  const containerUnsub = focusCoordination.onGridContainerRegistered(() => {
    isContainerRegistered = true;
    tryEstablishFocus();
  });

  // Return cleanup function
  return () => {
    rendererSub.unsubscribe();
    containerUnsub();
  };
}
