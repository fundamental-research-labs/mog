/**
 * XState Inspector Integration for Development
 *
 * Provides time-travel debugging and state visualization for all XState machines
 * in development mode. Connects to @stately/inspect for visualization.
 *
 * Features:
 * - Time-travel debugging
 * - State visualization
 * - Event logging
 * - State history
 *
 * Only active in development mode (isDev() from @mog/env).
 *
 * @see ARCHITECTURE.md - Full Observability section
 */

import { isMachineSnapshot, type AnyActorRef, type InspectionEvent } from 'xstate';

import { isDev } from '@mog/env';

import { getMetrics } from './metrics';
import type { InspectableCoordinator } from './types';

// =============================================================================
// Window augmentation for __XSTATE_INSPECTOR__
// =============================================================================

declare global {
  interface Window {
    __XSTATE_INSPECTOR__?: {
      getHistory: () => unknown[];
      getState: (actorId: string) => unknown;
      getCoordinator: () => InspectableCoordinator;
      printHistory: (actorId?: string) => void;
    };
  }
}

// =============================================================================
// TYPES
// =============================================================================

/**
 * Inspector configuration.
 */
export interface InspectorConfig {
  /** Whether inspector is enabled (defaults to NODE_ENV === 'development') */
  enabled?: boolean;
  /** Stately inspect URL (defaults to wss://stately.ai/inspect) */
  url?: string;
  /** Filter which actors to inspect */
  filter?: (actorId: string) => boolean;
  /** Log events to console */
  logToConsole?: boolean;
}

/**
 * Inspector instance returned by setup.
 */
export interface InspectorInstance {
  /** Cleanup function */
  dispose: () => void;
  /** Whether inspector is active */
  isActive: boolean;
}

// =============================================================================
// INSPECTOR SETUP
// =============================================================================

/**
 * Set up XState Inspector for development.
 *
 * Usage:
 * ```typescript
 * const coordinator = new SheetCoordinator({ ... });
 * const inspector = setupInspector(coordinator);
 *
 * // On cleanup
 * inspector.dispose();
 * ```
 *
 * @param coordinator - The SheetCoordinator to inspect
 * @param config - Optional inspector configuration
 * @returns Inspector instance with dispose function
 */
export function setupInspector(
  coordinator: InspectableCoordinator,
  config: InspectorConfig = {},
): InspectorInstance {
  const { enabled = isDev(), filter } = config;

  // No-op if not enabled
  if (!enabled) {
    return { dispose: () => {}, isActive: false };
  }

  const subscriptions: Array<{ unsubscribe: () => void }> = [];

  // =============================================================================
  // STATE HISTORY (for time-travel simulation)
  // =============================================================================

  interface StateHistoryEntry {
    timestamp: number;
    actorId: string;
    state: string;
    event: string;
    context: unknown;
  }

  const stateHistory: StateHistoryEntry[] = [];
  const MAX_HISTORY = 100;

  function addToHistory(entry: StateHistoryEntry): void {
    stateHistory.push(entry);
    if (stateHistory.length > MAX_HISTORY) {
      stateHistory.shift();
    }
  }

  // =============================================================================
  // ACTOR INSPECTION
  // =============================================================================

  // NOTE: _createInspectCallback is reserved for future use in advanced debugging scenarios.
  // Uncomment and wire up when per-actor inspection is needed.
  // function createInspectCallback(actorId: string) {
  // if (filter && !filter(actorId)) return undefined;
  // return (event: InspectionEvent) => {
  // if (event.type === '@xstate.snapshot') {
  // const snapshot = event.snapshot as { value: unknown; context: unknown; _event?: { type: string } };
  // const stateValue = JSON.stringify(snapshot.value);
  // const eventType = snapshot._event?.type ?? 'unknown';
  // addToHistory({ timestamp: Date.now, actorId, state: stateValue, event: eventType, context: snapshot.context });
  // if (logToConsole) { console.group(`[XState] ${actorId}`); console.log('State:', snapshot.value); console.log('Event:', eventType); console.log('Context:', snapshot.context); console.groupEnd; }
  // metrics.incrementTransition(actorId, eventType);
  // }
  // if (event.type === '@xstate.event') {
  // const xstateEvent = event.event as { type: string };
  // if (logToConsole) console.log(`[XState] ${actorId} received:`, xstateEvent.type);
  // }
  // };
  // }

  // =============================================================================
  // SUBSCRIBE TO ACTORS
  // =============================================================================

  /**
   * Subscribe to an actor's state changes.
   */
  function subscribeToActor(actor: AnyActorRef, actorId: string): void {
    if (filter && !filter(actorId)) {
      return;
    }

    const subscription = actor.subscribe((state) => {
      // Extract state value (works for both simple and nested states)
      let stateValue: string;
      if (typeof state.value === 'string') {
        stateValue = state.value;
      } else if (typeof state.value === 'object' && state.value !== null) {
        stateValue = JSON.stringify(state.value);
      } else {
        stateValue = 'unknown';
      }

      // Get the event that caused this transition
      // Note: state.event is the most recent event
      const eventType = state._event?.type ?? (state.event as { type?: string })?.type ?? 'init';

      addToHistory({
        timestamp: Date.now(),
        actorId,
        state: stateValue,
        event: eventType,
        context: state.context,
      });
    });

    subscriptions.push(subscription);
  }

  // Subscribe to all coordinator actors (via system actor access layers)
  try {
    subscribeToActor(coordinator.grid.access.actors.selection, 'selection');
    subscribeToActor(coordinator.grid.access.actors.editor, 'editor');
    subscribeToActor(coordinator.grid.access.actors.clipboard, 'clipboard');
    subscribeToActor(coordinator.renderer.access.actors.renderer, 'renderer');
  } catch (e) {
    console.warn('[XState Inspector] Failed to subscribe to actors:', e);
  }

  // =============================================================================
  // CONSOLE API (for debugging in dev tools)
  // =============================================================================

  // Expose debugging API on window in development
  if (typeof window !== 'undefined') {
    window.__XSTATE_INSPECTOR__ = {
      getHistory: () => [...stateHistory],
      getState: (actorId: string) => {
        const entries = stateHistory.filter((e) => e.actorId === actorId);
        return entries[entries.length - 1];
      },
      getCoordinator: () => coordinator,
      printHistory: (actorId?: string) => {
        const entries = actorId ? stateHistory.filter((e) => e.actorId === actorId) : stateHistory;
        console.table(
          entries.map((e) => ({
            time: new Date(e.timestamp).toISOString().split('T')[1],
            actor: e.actorId,
            state: e.state,
            event: e.event,
          })),
        );
      },
    };

    console.log(
      '%c[XState Inspector] Active - Use window.__XSTATE_INSPECTOR__ for debugging',
      'color: #4CAF50; font-weight: bold',
    );
    console.log(' .getHistory - Get full state history');
    console.log(' .getState(actorId) - Get current state for actor');
    console.log(' .printHistory(actorId?) - Print history table');
  }

  // =============================================================================
  // CLEANUP
  // =============================================================================

  function dispose(): void {
    // Unsubscribe from all actors
    subscriptions.forEach((sub) => sub.unsubscribe());
    subscriptions.length = 0;

    // Clear history
    stateHistory.length = 0;

    // Remove window API
    if (typeof window !== 'undefined') {
      delete window.__XSTATE_INSPECTOR__;
    }
  }

  return { dispose, isActive: true };
}

// =============================================================================
// INSPECTION CALLBACK FACTORY
// =============================================================================

/**
 * Create an inspection callback that integrates with metrics.
 *
 * Usage with actor creation:
 * ```typescript
 * const actor = createActor(machine, {
 * inspect: createInspectionCallback('selection', metrics),
 * });
 * ```
 */
export function createInspectionCallback(
  actorId: string,
  options: {
    logToConsole?: boolean;
    onTransition?: (from: string, to: string, event: string) => void;
  } = {},
): (event: InspectionEvent) => void {
  const { logToConsole = false, onTransition } = options;
  const metrics = getMetrics();

  let previousState: string | null = null;
  let transitionStartTime: number | null = null;

  return (event: InspectionEvent) => {
    if (event.type === '@xstate.snapshot') {
      const snap = event.snapshot;

      // Only machine snapshots have value/context — skip non-machine actors
      if (!isMachineSnapshot(snap)) return;

      // Extract state value
      const currentState = typeof snap.value === 'string' ? snap.value : JSON.stringify(snap.value);

      // Extract triggering event type from the inspection event itself
      const eventType = event.event?.type ?? 'init';

      // Record transition timing
      if (previousState !== null && previousState !== currentState) {
        if (transitionStartTime !== null) {
          const duration = performance.now() - transitionStartTime;
          metrics.recordTransition(actorId, previousState, currentState, duration);
        }
        onTransition?.(previousState, currentState, eventType);
      }

      // Log if enabled
      if (logToConsole) {
        console.log(`[${actorId}] ${previousState} → ${currentState} (${eventType})`);
      }

      // Update state tracking
      previousState = currentState;
      transitionStartTime = performance.now();

      // Count transition
      metrics.incrementTransition(actorId, eventType);
    }

    if (event.type === '@xstate.event') {
      // Record when event is received (start of potential transition)
      transitionStartTime = performance.now();
    }
  };
}

// =============================================================================
// DEVELOPMENT HELPERS
// =============================================================================

/**
 * Log a visual representation of current machine states.
 */
export function logMachineStates(coordinator: InspectableCoordinator): void {
  if (typeof console === 'undefined') return;

  try {
    const selection = coordinator.grid.access.actors.selection.getSnapshot();
    const editor = coordinator.grid.access.actors.editor.getSnapshot();
    const clipboard = coordinator.grid.access.actors.clipboard.getSnapshot();
    const renderer = coordinator.renderer.access.actors.renderer.getSnapshot();

    console.group('%c[Machine States]', 'color: #2196F3; font-weight: bold');
    console.log('Selection:', selection.value, selection.context);
    console.log('Editor:', editor.value, editor.context);
    console.log('Clipboard:', clipboard.value, clipboard.context);
    console.log('Renderer:', renderer.value, renderer.context);
    console.groupEnd();
  } catch (e) {
    console.warn('Failed to log machine states:', e);
  }
}

/**
 * Assert that a machine is in an expected state (for testing/debugging).
 */
export function assertMachineState(
  actor: AnyActorRef,
  expectedState: string,
  message?: string,
): void {
  const snapshot = actor.getSnapshot();
  const actualState =
    typeof snapshot.value === 'string' ? snapshot.value : JSON.stringify(snapshot.value);

  if (actualState !== expectedState) {
    const errorMessage = message ?? `Expected state "${expectedState}" but got "${actualState}"`;
    throw new Error(errorMessage);
  }
}
