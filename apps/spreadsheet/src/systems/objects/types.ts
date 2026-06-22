/**
 * ObjectSystem Type Definitions
 *
 * IObjectSystem interface definition.
 * Owns floating object interactions, hit testing, and effective state during operations.
 *
 * PHILOSOPHY: No slow migrations. Build the RIGHT solution. Copy existing types — don't reinvent.
 *
 */

import type { IFloatingObjectManager } from '@mog-sdk/contracts/kernel';
import type { chartSelectors, objectSelectors, diagramSelectors } from '../../selectors';
import type {
  ChartAccessor,
  ChartCommands,
  ObjectAccessor,
  ObjectCommands,
  DiagramAccessor,
  DiagramCommands,
} from '@mog-sdk/contracts/actors';
import type { Workbook } from '@mog-sdk/contracts/api';
import type { DrawingObject } from '@mog-sdk/contracts/drawing';
import type { ObjectHitRegion } from '@mog-sdk/contracts/floating-objects';
import type {
  GridRenderer,
  GroupingData,
  HitTestService,
  OutlineHitTestResult,
} from '@mog-sdk/contracts/rendering';
import type { ISheetViewGeometry, ISheetViewObjects } from '@mog-sdk/sheet-view';
import type { Point } from '@mog-sdk/contracts/viewport';
import type { DragTerminator } from '../shared/drag-terminator';
import type { Metric } from '../shared/types';
import type { ObjectCoordinationConfig } from './coordination/object-coordination';
import type { UIState } from '../../ui-store';
import type { StoreApi } from 'zustand';

// Actor types (for useSelector hook subscriptions)
import type { ChartActor } from './machines/chart-machine';
import type { ObjectInteractionActor } from './machines/object-interaction-machine';
import type { DiagramActor } from './machines/diagram-machine';

// Re-export from existing coordinator types for convenience
export type {
  EffectiveObjectState,
  EffectiveStateService,
} from './coordination/effective-state-service';
export type { ObjectHitResult } from './coordination/object-coordination';

// Re-export DrawingObject for consumers that need it alongside EffectiveObjectState
export type { DrawingObject };

// =============================================================================
// ACTOR ACCESS LAYER
// =============================================================================

/**
 * Aggregated actor access for ObjectSystem.
 * Provides clean, opaque interface to actor state and commands.
 *
 * Architecture:
 * - ObjectSystem owns object, chart, and diagram actors
 * - Exposes readonly accessors (point-in-time reads via selectors)
 * - Exposes commands (type-safe event sending)
 * - Exposes selectors (direct selector access for advanced use)
 */
export interface ObjectActorAccess {
  /** Accessor instances for reading actor state */
  accessors: {
    object: ObjectAccessor;
    chart: ChartAccessor;
    diagram?: DiagramAccessor;
  };
  /** Command interfaces for sending events to actors */
  commands: {
    object: ObjectCommands;
    chart: ChartCommands;
    diagram?: DiagramCommands;
  };
  /** Raw selectors for advanced use cases */
  selectors: {
    object: typeof objectSelectors;
    chart: typeof chartSelectors;
    diagram: typeof diagramSelectors;
  };

  /**
   * Actor refs for useSelector hook subscriptions.
   * Use accessors/commands for programmatic reads/writes.
   * These are exposed solely for React hooks that need reactive subscriptions.
   */
  actors: {
    object: ObjectInteractionActor;
    chart: ChartActor;
    diagram: DiagramActor;
  };
}

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Configuration for creating ObjectSystem.
 *
 * Constructor-only initialization.
 * All dependencies provided at construction time.
 */
export interface ObjectSystemConfig {
  /** Floating object manager for reads and transform operations (optional - may not be available in all contexts) */
  floatingObjects?: IFloatingObjectManager;
  /** Hit test service for outline (row/column grouping) buttons */
  hitTestService: HitTestService;
  /** Workbook API for unified data access (optional - may not be available in all contexts) */
  workbook?: Workbook;
  /**
   * Active sheet ID getter.
   *
   * Chart selection sync must resolve selected IDs against the same active
   * sheet the UI/renderer uses. Falling back to workbook.activeSheet can be
   * stale during imported-document activation.
   */
  getActiveSheetId?: () => string;
  /** Per-document UI store for derived contextual-tab state */
  uiStoreApi?: StoreApi<UIState>;
  /** Function to get renderer container element (for hit testing and cursor updates) */
  getCanvas: () => HTMLElement | null;
  /** Function to get geometry capability (for coordinate conversions) */
  getGeometry: () => ISheetViewGeometry | null;
  /** Function to get floating-object scene capability */
  getObjects: () => ISheetViewObjects | null;
  /** Function to get the grid renderer for unified hit testing */
  getGridRenderer: () => GridRenderer | null;
  /** Callback for metrics/observability (optional) */
  onMetric?: (metric: Metric) => void;
  /**
   * Mutation callbacks injected from coordinator layer.
   * Passed through to ObjectCoordination.
   */
  mutations: ObjectCoordinationConfig['mutations'];
}

// =============================================================================
// SNAPSHOTS
// =============================================================================

/**
 * Snapshot of object interaction state.
 * Used for debugging and testing.
 *
 * This will be imported from the machines layer
 * once snapshot accessors are fully extracted.
 */
export interface ObjectInteractionSnapshot {
  /** Current state value (idle, selected, operating, etc.) */
  state: string;
  /** Selected object IDs */
  selectedIds: string[];
  /** Whether currently operating (drag/resize/rotate) */
  isOperating: boolean;
  /** Active handle (if any) */
  activeHandle: ObjectHitRegion | null;
  /** Whether shift key is held */
  shiftKey: boolean;
  /** Start position for drag-to-insert (null when not inserting) */
  insertStartPosition: { x: number; y: number } | null;
  /** Current position for drag-to-insert (null when not inserting) */
  insertCurrentPosition: { x: number; y: number } | null;
}

/**
 * Snapshot of chart UI state.
 * Used for debugging and testing.
 *
 * This will be imported from the machines layer
 * once snapshot accessors are fully extracted.
 */
export interface ChartUISnapshot {
  /** Current state value */
  state: string;
  /** Selected chart ID (if any) */
  selectedChartId: string | null;
  /** Selected element type (if any) */
  selectedElementType: string | null;
  /** Whether in editing mode */
  isEditing: boolean;
}

// =============================================================================
// IOBJECTSYSTEM INTERFACE
// =============================================================================

/**
 * ObjectSystem interface.
 *
 * Owns:
 * - Floating object interactions (shapes, text boxes, pictures, charts, Diagram, TextEffect, equations)
 * - Hit testing for floating objects and outline buttons
 * - Effective state computation during operations (60fps rendering)
 * - Object/chart/Diagram actor lifecycle
 *
 * Architecture:
 * - Extends FloatingObjectCoordinator for compatibility with existing mutations
 * - Exposes DragTerminator for pointer-up coordination
 * - Provides actor access layer for clean state/command interface
 * - Manages effective state service for renderer use
 */
export interface IObjectSystem {
  // ===========================================================================
  // Hit Testing
  // ===========================================================================

  /**
   * Hit test a point against floating objects.
   * Returns the topmost object (by z-index) at the given viewport coordinates.
   *
   * @param sheetId - Sheet to test within
   * @param x - X coordinate in viewport pixels
   * @param y - Y coordinate in viewport pixels
   * @returns Object hit result or null if no hit
   */
  hitTestFloatingObject(
    sheetId: string,
    x: number,
    y: number,
  ): import('./coordination/object-coordination').ObjectHitResult | null;

  /**
   * Hit test a point against outline (row/column grouping) buttons.
   *
   * @param x - X coordinate in viewport pixels
   * @param y - Y coordinate in viewport pixels
   * @returns Outline hit result or null if no hit
   */
  hitTestOutline(x: number, y: number): OutlineHitTestResult | null;

  // ===========================================================================
  // Object Interaction
  // ===========================================================================

  /**
   * Handle mouse down on a floating object.
   * Starts drag/resize/rotate operations based on the hit region.
   *
   * @param objectId - ID of the object that was clicked
   * @param region - Which region of the object was clicked (body, border, handle, etc.)
   * @param pos - Mouse position in viewport coordinates
   * @param shift - Whether shift key was held
   * @param ctrl - Whether ctrl/cmd key was held
   */
  handleObjectMouseDown(
    objectId: string,
    region: ObjectHitRegion,
    pos: Point,
    shift: boolean,
    ctrl: boolean,
  ): void;

  /**
   * Handle mouse move during object interaction.
   * Updates the current operation position (if operating).
   *
   * @param pos - Mouse position in viewport coordinates
   * @param shiftKey - Whether shift key is held
   */
  handleObjectMouseMove(pos: Point, shiftKey: boolean): void;

  /**
   * Handle mouse up during object interaction.
   * Completes the current operation (if operating).
   *
   * @param pos - Mouse position in viewport coordinates
   */
  handleObjectMouseUp(pos: Point): void;

  /**
   * Delete currently selected objects.
   * Removes objects from Yjs and deselects.
   */
  deleteSelectedObjects(): void;

  /**
   * Deselect all objects.
   * Transitions to idle state.
   */
  deselectAllObjects(): void;

  // ===========================================================================
  // Effective State (60fps rendering during operations)
  // ===========================================================================

  /**
   * Get the effective visual state for an object.
   * Returns the visual position during operations, accounting for:
   * - Local operations (current user's drag/resize/rotate)
   * - Remote operations (other users' operations via presence)
   * - Persisted state (source of truth in Yjs)
   *
   * Priority: Local > Remote > Persisted
   *
   * @param objectId - Object to get state for
   * @returns Effective state or null if object doesn't exist
   */
  getEffectiveObjectState(
    objectId: string,
  ): Promise<import('./coordination/effective-state-service').EffectiveObjectState | null>;

  /**
   * Get effective states for all objects affected by current operations.
   * Useful for batch rendering updates.
   *
   * @returns Map of objectId -> EffectiveObjectState
   */
  getAffectedEffectiveStates(): Promise<
    Map<string, import('./coordination/effective-state-service').EffectiveObjectState>
  >;

  /**
   * Check if an object is currently being operated on (local or remote).
   *
   * @param objectId - Object to check
   * @returns True if object is in an operation
   */
  isObjectInOperation(objectId: string): boolean;

  // ===========================================================================
  // Configuration
  // ===========================================================================

  /**
   * Set the grouping data getter for outline hit testing.
   * Provides row/column grouping configuration for hit tests.
   *
   * @param getter - Function that returns current grouping data
   */
  setGroupingDataGetter(getter: () => GroupingData): void;

  // ===========================================================================
  // Snapshots (for debugging and testing)
  // ===========================================================================

  /**
   * Get a snapshot of object interaction state.
   * @returns Current object interaction state snapshot
   */
  getObjectInteractionSnapshot(): ObjectInteractionSnapshot;

  /**
   * Get a snapshot of chart UI state.
   * @returns Current chart UI state snapshot
   */
  getChartUISnapshot(): ChartUISnapshot;

  // ===========================================================================
  // Actor Access Layer (complete, opaque interface)
  // ===========================================================================

  /**
   * Actor access layer.
   * Provides clean, opaque interface to actor state and commands.
   *
   * Architecture:
   * - Accessors: Point-in-time reads via selectors
   * - Commands: Type-safe event sending
   * - Selectors: Direct selector access for advanced use
   */
  readonly access: ObjectActorAccess;

  // ===========================================================================
  // FloatingObjectCoordinator interface (inherited)
  // ===========================================================================

  /**
   * Check if ink mode is active (for input isolation).
   * @returns True if ink mode is active
   */
  isInkActive(): boolean;

  // ===========================================================================
  // Cross-System Coordination
  // ===========================================================================

  /**
   * DragTerminator for pointer-up coordination.
   * The coordinator calls dragTerminator.endDrag() on pointer-up,
   * and ObjectSystem checks its own actor states to send completion events.
   */
  readonly dragTerminator: DragTerminator;

  /**
   * Notify that an external selection is active (e.g., cell selection).
   * This will deselect all objects if any are selected.
   */
  notifyExternalSelectionActive(): void;

  /**
   * Subscribe to object selection becoming active.
   * Called when objects are selected (for cross-coordination).
   *
   * @param callback - Callback to invoke when objects are selected
   * @returns Unsubscribe function
   */
  onObjectSelectionActive(callback: () => void): () => void;

  /**
   * Subscribe to state changes.
   * Called whenever any actor state changes.
   *
   * @param callback - Callback to invoke on state change
   * @returns Unsubscribe function
   */
  onStateChange(callback: () => void): () => void;

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Start the object system.
   * Spawns actors and sets up subscriptions.
   */
  start(): void;

  /**
   * Dispose the object system.
   * Stops actors and cleans up subscriptions.
   */
  dispose(): void;
}
