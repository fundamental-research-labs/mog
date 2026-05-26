/**
 * InkSystem - Modal ink editing coordinator.
 *
 * of Stream 1: Spreadsheet Subsystem Architecture.
 *
 * This system owns the ink drawing subsystem:
 * - Ink state machine (inkMachine) - created and managed internally
 * - Actor access layer (accessors, commands, selectors)
 * - DragTerminator for pointer-up coordination
 * - Modal lifecycle (activate/deactivate) with subscription callbacks
 *
 * ARCHITECTURE:
 * - Owns the ink actor (creates it, starts it, stops it)
 * - Builds InkActorAccess from the internal actor
 * - DragTerminator checks actor state and sends completion events
 * - Delegates coordination (input handling, persistence) to InkCoordination
 * - Activation/deactivation callbacks enable cross-system coordination
 *
 * @module apps/spreadsheet/src/systems/ink
 */

import { createActor } from 'xstate';

import type { DragTerminator } from '../shared/drag-terminator';
import { createInkAccessor } from './actor-access/accessors';
import { createInkCommands } from './actor-access/commands';
import { inkMachine, type InkActor } from './machines/machine';
import { inkSelectors } from './machines/selectors';
import type { IInkSystem, InkActorAccess, InkSystemConfig } from './types';

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * InkSystem implementation.
 *
 * Creates and owns the ink state machine actor. Provides the actor access
 * layer, drag termination, and modal lifecycle management. Subscriptions
 * allow external systems to react to ink mode changes.
 *
 * @example
 * const inkSystem = new InkSystem(config);
 * inkSystem.start();
 *
 * // Subscribe to lifecycle events
 * inkSystem.onActivate(() => console.log('Ink mode activated'));
 * inkSystem.onDeactivate(() => console.log('Ink mode deactivated'));
 *
 * // Activate ink editing for a drawing
 * inkSystem.activate('drawing-123');
 *
 * // Later...
 * inkSystem.deactivate();
 * inkSystem.dispose();
 */
export class InkSystem implements IInkSystem {
  // ===========================================================================
  // Private State
  // ===========================================================================

  /** The owned ink state machine actor */
  private readonly inkActor: InkActor;

  /** Whether the system has been started */
  private started = false;

  /** Whether the system has been disposed */
  private disposed = false;

  /** Subscription cleanup for actor state changes */
  private stateSubscription: { unsubscribe(): void } | null = null;

  /** Activation lifecycle callbacks */
  private readonly activateCallbacks = new Set<() => void>();

  /** Deactivation lifecycle callbacks */
  private readonly deactivateCallbacks = new Set<() => void>();

  /** State change callbacks */
  private readonly stateChangeCallbacks = new Set<() => void>();

  // ===========================================================================
  // Actor Access Layer (built once at construction)
  // ===========================================================================

  /**
   * Complete actor access layer for the ink system.
   * Built at construction time from the internal actor.
   */
  readonly access: InkActorAccess;

  // ===========================================================================
  // DragTerminator
  // ===========================================================================

  /**
   * DragTerminator for pointer-up coordination.
   *
   * Checks the ink actor's current state and sends appropriate
   * completion or cancellation events. The coordinator calls this
   * on pointer-up without needing to know about ink machine internals.
   *
   * Handles active states:
   * - stroking: PEN_UP to complete the stroke
   * - erasingActive: ERASER_UP to complete erasing
   * - selecting: LASSO_END to complete selection
   */
  readonly dragTerminator: DragTerminator = {
    endDrag: () => {
      const snapshot = this.inkActor.getSnapshot();

      if (snapshot.matches('stroking')) {
        this.inkActor.send({ type: 'PEN_UP' });
      } else if (snapshot.matches('erasingActive')) {
        this.inkActor.send({ type: 'ERASER_UP' });
      } else if (snapshot.matches('selecting')) {
        this.inkActor.send({ type: 'LASSO_END' });
      }
    },

    cancelDrag: () => {
      const snapshot = this.inkActor.getSnapshot();

      if (snapshot.matches('stroking')) {
        // Cancel stroke by deactivating and re-activating
        // The DEACTIVATE event from stroking resets all stroke data
        const drawingId = snapshot.context.targetDrawingId;
        this.inkActor.send({ type: 'DEACTIVATE' });
        // Re-activate if we had a drawing target (cancel the stroke, not the mode)
        if (drawingId) {
          this.inkActor.send({ type: 'ACTIVATE', drawingId });
        }
      } else if (snapshot.matches('erasingActive')) {
        // Cancel erase by sending ERASER_UP (no undo of already-erased strokes)
        this.inkActor.send({ type: 'ERASER_UP' });
      } else if (snapshot.matches('selecting')) {
        // Cancel selection by deactivating and re-activating
        const drawingId = snapshot.context.targetDrawingId;
        this.inkActor.send({ type: 'DEACTIVATE' });
        if (drawingId) {
          this.inkActor.send({ type: 'ACTIVATE', drawingId });
        }
      }
    },
  };

  // ===========================================================================
  // Constructor
  // ===========================================================================

  constructor(_config: InkSystemConfig) {
    // Create the ink actor (not started yet — start() does that)
    this.inkActor = createActor(inkMachine);

    // Build the actor access layer from the internal actor
    const accessor = createInkAccessor(this.inkActor);
    const commands = createInkCommands(this.inkActor);

    this.access = {
      accessors: { ink: accessor },
      commands: { ink: commands },
      selectors: { ink: inkSelectors },
      actors: { ink: this.inkActor },
    };
  }

  // ===========================================================================
  // Mode Activation
  // ===========================================================================

  activate(drawingId: string): void {
    if (this.disposed || !this.started) return;

    // If already active for this drawing, no-op
    const snapshot = this.inkActor.getSnapshot();
    if (!snapshot.matches('idle') && inkSelectors.targetDrawingId(snapshot) === drawingId) {
      return;
    }

    // If active for a different drawing, deactivate first
    if (!snapshot.matches('idle')) {
      this.deactivate();
    }

    // Send activation event to the machine
    this.inkActor.send({ type: 'ACTIVATE', drawingId });

    // Notify activation callbacks
    for (const callback of this.activateCallbacks) {
      callback();
    }
  }

  deactivate(): void {
    if (this.disposed) return;

    const snapshot = this.inkActor.getSnapshot();
    if (snapshot.matches('idle')) return;

    // Send deactivation event to the machine
    this.inkActor.send({ type: 'DEACTIVATE' });

    // Notify deactivation callbacks
    for (const callback of this.deactivateCallbacks) {
      callback();
    }
  }

  isActive(): boolean {
    if (this.disposed || !this.started) return false;
    return inkSelectors.isActive(this.inkActor.getSnapshot());
  }

  // ===========================================================================
  // Cross-System Coordination Subscriptions
  // ===========================================================================

  onActivate(callback: () => void): () => void {
    this.activateCallbacks.add(callback);
    return () => {
      this.activateCallbacks.delete(callback);
    };
  }

  onDeactivate(callback: () => void): () => void {
    this.deactivateCallbacks.add(callback);
    return () => {
      this.deactivateCallbacks.delete(callback);
    };
  }

  onStateChange(callback: () => void): () => void {
    this.stateChangeCallbacks.add(callback);
    return () => {
      this.stateChangeCallbacks.delete(callback);
    };
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  start(): void {
    if (this.started || this.disposed) return;

    // Start the ink actor
    this.inkActor.start();

    // Subscribe to state changes and forward to callbacks
    this.stateSubscription = this.inkActor.subscribe(() => {
      for (const callback of this.stateChangeCallbacks) {
        callback();
      }
    });

    this.started = true;
  }

  dispose(): void {
    if (this.disposed) return;

    // Deactivate if active
    if (this.started && this.isActive()) {
      this.deactivate();
    }

    // Unsubscribe from state changes
    if (this.stateSubscription) {
      this.stateSubscription.unsubscribe();
      this.stateSubscription = null;
    }

    // Stop the actor
    if (this.started) {
      this.inkActor.stop();
    }

    // Clear all callbacks
    this.activateCallbacks.clear();
    this.deactivateCallbacks.clear();
    this.stateChangeCallbacks.clear();

    this.disposed = true;
  }
}
