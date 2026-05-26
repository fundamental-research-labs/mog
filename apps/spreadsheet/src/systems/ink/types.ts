/**
 * Ink System Types
 *
 * of Stream 1: Spreadsheet Subsystem Architecture
 *
 * The InkSystem owns the ink drawing subsystem:
 * - Ink state machine (drawing, erasing, lasso selection)
 * - Canvas rendering coordination
 * - Ink-specific input handling
 * - Modal editing lifecycle (activate/deactivate)
 *
 * @module apps/spreadsheet/src/systems/ink
 */

import type { ISheetViewGeometry } from '@mog-sdk/sheet-view';
import type { DragTerminator } from '../shared/drag-terminator';
import type { Metric } from '../shared/types';
import type { InkAccessor, InkCommands } from './actor-access';
import type { inkSelectors } from './machines';

// Actor types (for useSelector hook subscriptions)
import type { InkActor } from './machines/machine';

// =============================================================================
// ACTOR ACCESS LAYER
// =============================================================================

/**
 * Complete actor access layer for the ink system.
 *
 * Provides the full triple: accessors, commands, selectors.
 * External callers should use accessors/commands.
 * Selectors are exposed for advanced use cases (testing, debugging).
 */
export interface InkActorAccess {
  /** Read-only state access */
  accessors: {
    ink: InkAccessor;
  };
  /** Type-safe commands for sending events */
  commands: {
    ink: InkCommands;
  };
  /** Pure selector functions (exported for testing/debugging) */
  selectors: {
    ink: typeof inkSelectors;
  };

  /**
   * Actor refs for useSelector hook subscriptions.
   * Use accessors/commands for programmatic reads/writes.
   * These are exposed solely for React hooks that need reactive subscriptions.
   */
  actors: {
    ink: InkActor;
  };
}

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Configuration for creating an InkSystem.
 *
 * The ink system requires:
 * - Canvas access for rendering strokes
 * - Coordinate system for hit testing and transformations
 */
export interface InkSystemConfig {
  /** Get the renderer container element */
  getCanvas: () => HTMLElement | null;

  /** Get the geometry capability for transformations */
  getGeometry: () => ISheetViewGeometry | null;

  /**
   * Get the drawing offset (for canvas translation).
   * Used to position strokes correctly relative to the viewport.
   * Defaults to {x: 0, y: 0} if not provided.
   */
  getDrawingOffset?: () => { x: number; y: number };

  /** User ID for stroke attribution */
  userId?: string;

  /** Callback for metrics/observability */
  onMetric?: (metric: Metric) => void;
}

// =============================================================================
// SYSTEM INTERFACE
// =============================================================================

/**
 * InkSystem - Modal ink editing coordinator.
 *
 * This system owns:
 * - Ink state machine (inkMachine)
 * - Ink input handling (pointer events → machine events)
 * - Stroke rendering (canvas layer)
 * - Lasso selection coordination
 *
 * ARCHITECTURE:
 * - Modal: activate(drawingId) → edit → deactivate()
 * - Owns a single state machine (inkMachine)
 * - Delegates rendering to InkRenderer (canvas layer)
 * - Uses DragTerminator for pointer-up coordination
 */
export interface IInkSystem {
  // ===========================================================================
  // Mode Activation
  // ===========================================================================

  /**
   * Activate ink mode for a specific drawing object.
   * Transitions the ink machine from idle → drawing state.
   * Isolates input handling while active.
   *
   * @param drawingId - ID of the drawing object to edit
   */
  activate(drawingId: string): void;

  /**
   * Deactivate ink mode, returning to idle state.
   * Commits or discards the current editing session.
   */
  deactivate(): void;

  /**
   * Check if ink mode is currently active.
   * Returns true when in any state other than idle.
   */
  isActive(): boolean;

  // ===========================================================================
  // Actor Access Layer
  // ===========================================================================

  /**
   * Complete actor access layer (accessors, commands, selectors).
   *
   * This is the opaque access pattern:
   * - Accessors: read-only state queries
   * - Commands: type-safe event dispatch
   * - Selectors: pure functions for derived state
   *
   * External callers should primarily use accessors and commands.
   */
  readonly access: InkActorAccess;

  // ===========================================================================
  // Cross-System Coordination
  // ===========================================================================

  /**
   * DragTerminator for pointer-up coordination.
   * Used by coordinator to end ink drag operations (stroking, erasing, lasso).
   */
  readonly dragTerminator: DragTerminator;

  /**
   * Subscribe to ink mode activation.
   * Called when activate() is invoked.
   *
   * @param callback - Function to call on activation
   * @returns Cleanup function to unsubscribe
   */
  onActivate(callback: () => void): () => void;

  /**
   * Subscribe to ink mode deactivation.
   * Called when deactivate() is invoked.
   *
   * @param callback - Function to call on deactivation
   * @returns Cleanup function to unsubscribe
   */
  onDeactivate(callback: () => void): () => void;

  /**
   * Subscribe to ink state changes.
   * Called whenever the ink machine transitions states.
   *
   * @param callback - Function to call on state change
   * @returns Cleanup function to unsubscribe
   */
  onStateChange(callback: () => void): () => void;

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Start the ink system.
   * Initializes the ink machine and begins listening to state changes.
   * Must be called before activate().
   */
  start(): void;

  /**
   * Dispose the ink system.
   * Deactivates ink mode, stops the machine, and cleans up subscriptions.
   */
  dispose(): void;
}
