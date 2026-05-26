/**
 * Pane Focus Actor Access Implementation
 *
 * Implements PaneFocusAccessor and PaneFocusCommands using selectors.
 * THIS IS THE ONLY PLACE that calls actor.getSnapshot() and actor.send() for pane focus.
 *
 * @module engine/state/coordinator/actor-access/pane-focus
 */

import { paneFocusSelectors } from '../../../selectors';
import type {
  PaneFocusAccessor,
  PaneFocusCommands,
  PaneFocusState,
  PaneType,
} from '@mog-sdk/contracts/actors';

/**
 * Minimal actor interface for pane focus accessor.
 * Uses getSnapshot() to capture point-in-time state.
 */
type PaneFocusActor = { getSnapshot(): PaneFocusState };

/**
 * Minimal actor interface for pane focus commands.
 * Uses send() to dispatch events to state machines.
 */
type PaneFocusActorWithSend = { send(event: { type: string; [key: string]: unknown }): void };

/**
 * Creates a PaneFocusAccessor for point-in-time reads in handlers.
 *
 * Each method delegates to the corresponding selector with a fresh snapshot.
 * This ensures handlers always get current state at the moment of call.
 *
 * @param actor - The XState pane focus actor
 * @returns PaneFocusAccessor interface for handlers
 */
export function createPaneFocusAccessor(actor: PaneFocusActor): PaneFocusAccessor {
  const snap = () => actor.getSnapshot();

  return {
    // Value accessors
    getCurrentPane: () => paneFocusSelectors.currentPane(snap()),
    getPreviousPane: () => paneFocusSelectors.previousPane(snap()),

    // State matching accessors
    isToolbarFocused: () => paneFocusSelectors.isToolbarFocused(snap()),
    isFormulaBarFocused: () => paneFocusSelectors.isFormulaBarFocused(snap()),
    isGridFocused: () => paneFocusSelectors.isGridFocused(snap()),
    isStatusBarFocused: () => paneFocusSelectors.isStatusBarFocused(snap()),

    // Derived accessors
    isGrid: () => paneFocusSelectors.isGrid(snap()),
    getMachineState: () => paneFocusSelectors.machineState(snap()),
  };
}

/**
 * Creates PaneFocusCommands from a pane focus actor.
 * Wraps actor.send() with type-safe methods for pane focus events.
 *
 * @param actor - The pane focus state machine actor
 * @returns PaneFocusCommands interface implementation
 *
 * @see state-machines/src/pane-focus-machine.ts for event definitions
 */
export function createPaneFocusCommands(actor: PaneFocusActorWithSend): PaneFocusCommands {
  return {
    focusNextPane: () => actor.send({ type: 'FOCUS_NEXT_PANE' }),

    focusPreviousPane: () => actor.send({ type: 'FOCUS_PREVIOUS_PANE' }),

    focusPane: (pane: PaneType) => actor.send({ type: 'FOCUS_PANE', pane }),

    resetToGrid: () => actor.send({ type: 'RESET_TO_GRID' }),
  };
}
