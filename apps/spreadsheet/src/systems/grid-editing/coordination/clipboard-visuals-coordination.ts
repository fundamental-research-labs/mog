/**
 * Clipboard Visuals Coordination
 *
 * Coordinates clipboard visual effects with the grid renderer:
 * - G1: Marching ants animation for both Copy and Cut operations
 * - G2: Cut cell dimming (50% opacity)
 *
 * ARCHITECTURE:
 * This coordination module observes clipboard state transitions and triggers
 * the appropriate visual updates. The UILayer and CellsLayer handle the actual
 * rendering based on the ClipboardSnapshot.
 *
 * The coordination is passive - it observes state changes and invalidates
 * the renderer when needed. The actual marching ants animation is managed
 * by the UILayer itself.
 *
 * Excel Parity Quickwins G1/G2: Clipboard Visuals
 */

import type { ActorRefFrom, SnapshotFrom } from 'xstate';
import type { clipboardMachine } from '../machines/clipboard-machine';

export type ClipboardActor = ActorRefFrom<typeof clipboardMachine>;
type ClipboardState = SnapshotFrom<typeof clipboardMachine>;

/**
 * Configuration for clipboard visuals coordination.
 */
export interface ClipboardVisualsCoordinationConfig {
  /** The clipboard actor to observe */
  clipboardActor: ClipboardActor;
  /** Callback to invalidate the renderer when visual state changes */
  invalidateRenderer: () => void;
}

/**
 * Setup clipboard visuals coordination.
 *
 * This function observes the clipboard actor for state changes and invalidates
 * the renderer when clipboard visual state changes (copy/cut/clear).
 *
 * The actual animation logic is handled by:
 * - UILayer: Marching ants animation (startMarchingAntsAnimation/stopMarchingAntsAnimation)
 * - CellsLayer: Cut cell dimming (50% opacity)
 *
 * @param config - Configuration with clipboard actor and renderer callback
 * @returns Dispose function to clean up subscription
 */
export function setupClipboardVisualsCoordination(config: ClipboardVisualsCoordinationConfig): {
  dispose: () => void;
} {
  let previousHasClipboard = false;
  let previousIsCut = false;

  const subscription = config.clipboardActor.subscribe((state: ClipboardState) => {
    const hasClipboard = (state.context.sourceRanges?.length ?? 0) > 0;
    const isCut = state.context.isCut;

    // Detect transitions that require re-render
    const clipboardStateChanged = previousHasClipboard !== hasClipboard || previousIsCut !== isCut;

    if (clipboardStateChanged) {
      // Invalidate renderer to update visuals
      config.invalidateRenderer();
    }

    previousHasClipboard = hasClipboard;
    previousIsCut = isCut;
  });

  return {
    dispose: () => subscription.unsubscribe(),
  };
}
