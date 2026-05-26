/**
 * Diagram Coordination Module
 *
 * Handles Diagram interaction coordination using XState machine pattern
 * following the architecture from chart-coordination.ts.
 *
 * Responsibilities:
 * - Create and manage Diagram XState actor
 * - Handle clicks by sending events to machine (NOT direct side effects)
 * - Subscribe to actor and detect state transitions
 * - Coordinate with external selection (cells, charts, etc.)
 * - Cursor updates via transition detection
 *
 * Architecture Pattern:
 * - Machine is PURE (no DOM access, no side effects)
 * - Coordinator subscribes to machine state transitions
 * - Side effects (cursor changes) executed by coordinator on transitions
 * - All changes flow through machine sends
 *
 * @see chart-coordination.ts for reference implementation
 * @see diagram-machine.ts for the XState machine definition
 * @see docs/ARCHITECTURE-CHECKLIST.md - Rule #4
 */

import type { Workbook } from '@mog-sdk/contracts/api';
import type { ComputedLayout, ComputedShape, NodeId } from '@mog-sdk/contracts/diagram';
import { createActor } from 'xstate';
import {
  getDiagramSnapshot,
  DiagramEvents,
  diagramMachine,
  type DiagramActor,
  type DiagramSnapshot,
} from '../machines/diagram-machine';

import type { WorksheetDiagrams } from '@mog-sdk/contracts/api';
import type { CleanupManager } from '../../shared/cleanup-manager';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Configuration for Diagram coordination setup.
 */
export interface DiagramCoordinationConfig {
  /** Diagram bridge for layout computation */
  diagramBridge: WorksheetDiagrams;

  /** Getter for the renderer container element (for cursor updates) */
  getCanvas: () => HTMLElement | null;

  /** Getter for the active sheet ID */
  getActiveSheetId: () => string;

  /** CleanupManager for registering cleanup functions */
  cleanups: CleanupManager;

  /** Unified Workbook API */
  workbook: Workbook;

  /** Callback when node selection changes */
  onNodeSelected?: (objectId: string, nodeId: NodeId | null) => void;

  /** Callback when text editing starts */
  onNodeEditStart?: (objectId: string, nodeId: NodeId) => void;

  /** Callback when text editing ends */
  onNodeEditEnd?: (objectId: string, nodeId: NodeId, committed: boolean) => void;
}

/**
 * Hit test result for Diagram interactions.
 */
export interface DiagramHitTestResult {
  /** Whether the hit was on a Diagram object */
  hit: boolean;

  /** The Diagram object ID that was hit */
  objectId: string | null;

  /** The node ID within the Diagram that was hit */
  nodeId: NodeId | null;

  /** The computed shape that was hit (for detailed position info) */
  shape: ComputedShape | null;
}

/**
 * Result returned by setupDiagramCoordination.
 */
export interface DiagramCoordinationResult {
  /**
   * The Diagram XState actor.
   * Use this to send events and subscribe to state changes.
   */
  actor: DiagramActor;

  /**
   * Get current Diagram interaction snapshot.
   */
  getSnapshot: () => DiagramSnapshot;

  /**
   * Handle click on Diagram object.
   * Sends appropriate events to the state machine based on hit testing.
   *
   * @param objectId - The Diagram object ID
   * @param x - Click X position relative to diagram origin
   * @param y - Click Y position relative to diagram origin
   * @param isMultiSelect - Whether Ctrl/Cmd is held for multi-select
   */
  handleClick: (
    objectId: string,
    x: number,
    y: number,
    isMultiSelect?: boolean,
  ) => void | Promise<void>;

  /**
   * Handle double-click on Diagram object.
   * Sends START_EDIT event to the machine if a node is hit.
   *
   * @param objectId - The Diagram object ID
   * @param x - Click X position relative to diagram origin
   * @param y - Click Y position relative to diagram origin
   */
  handleDoubleClick: (objectId: string, x: number, y: number) => void | Promise<void>;

  /**
   * Perform hit testing on a Diagram diagram.
   * Can be used by external code for custom hit detection.
   *
   * @param objectId - The Diagram object ID
   * @param x - X position relative to diagram origin
   * @param y - Y position relative to diagram origin
   * @returns Hit test result with object/node/shape info
   */
  hitTest: (
    objectId: string,
    x: number,
    y: number,
  ) => DiagramHitTestResult | Promise<DiagramHitTestResult>;

  /**
   * Send DESELECT event to clear selection.
   */
  clearSelection: () => void;

  /**
   * Commit text edit with new text.
   * Sends COMMIT_EDIT event to the machine.
   */
  commitEdit: (text: string) => void;

  /**
   * Cancel text edit.
   * Sends CANCEL_EDIT event to the machine.
   */
  cancelEdit: () => void;

  /**
   * Cleanup function - MUST be called when coordinator is disposed.
   * Unsubscribes from all actors and event bus.
   */
  cleanup: () => void;
}

// =============================================================================
// HIT TESTING
// =============================================================================

/**
 * Perform hit testing on a Diagram diagram to find which node was clicked.
 *
 * Hit testing is performed in reverse order (top-most shapes first) to handle
 * overlapping shapes correctly. Uses simple bounding box collision detection.
 *
 * @param layout - The computed layout with shape positions
 * @param x - X position relative to diagram origin
 * @param y - Y position relative to diagram origin
 * @returns The node ID of the hit shape, or null if no hit
 */
function hitTestLayout(layout: ComputedLayout, x: number, y: number): NodeId | null {
  // Check each shape in reverse order (top to bottom in z-order)
  for (let i = layout.shapes.length - 1; i >= 0; i--) {
    const shape = layout.shapes[i];

    // Simple bounding box hit test
    // Future enhancement: account for rotation, shape-specific paths
    if (x >= shape.x && x <= shape.x + shape.width && y >= shape.y && y <= shape.y + shape.height) {
      return shape.nodeId;
    }
  }

  return null;
}

/**
 * Find a shape by node ID in the computed layout.
 *
 * @param layout - The computed layout
 * @param nodeId - The node ID to find
 * @returns The computed shape, or null if not found
 */
function findShapeByNodeId(layout: ComputedLayout, nodeId: NodeId): ComputedShape | null {
  return layout.shapes.find((s) => s.nodeId === nodeId) ?? null;
}

// =============================================================================
// SETUP FUNCTION
// =============================================================================

/**
 * Set up Diagram coordination with XState actor.
 *
 * This function:
 * 1. Creates and starts the Diagram XState actor
 * 2. Subscribes to actor state transitions for cursor updates and callbacks
 * 3. Provides handler functions that send events to the machine
 * 4. Subscribes to external events (deletion, floating object selection)
 * 5. Registers cleanup with CleanupManager
 *
 * CRITICAL: Uses transition detection pattern (Architecture Checklist #4):
 * - Compare previousState vs currentState to detect transitions
 * - Execute side effects ONLY on transitions, not on every snapshot
 * - All user actions flow through machine sends, not direct mutations
 *
 * @param config - Configuration with bridges, stores, and getters
 * @returns Result object with actor, handler functions, and cleanup
 */
export function setupDiagramCoordination(
  config: DiagramCoordinationConfig,
): DiagramCoordinationResult {
  const {
    diagramBridge,
    getCanvas,
    getActiveSheetId: _getActiveSheetId,
    cleanups,
    workbook,
    onNodeSelected,
    onNodeEditStart,
    onNodeEditEnd,
  } = config;

  // Track cleanup functions for this coordination module
  const localCleanups: Array<() => void> = [];

  // ---------------------------------------------------------------------------
  // ACTOR CREATION
  // Create and start the Diagram XState actor
  // ---------------------------------------------------------------------------

  const diagramActor = createActor(diagramMachine);
  diagramActor.start();

  // ---------------------------------------------------------------------------
  // ACTOR SUBSCRIPTION - TRANSITION DETECTION PATTERN
  // Subscribe to actor and detect state transitions for side effects
  // ---------------------------------------------------------------------------

  // Track previous state for transition detection (CRITICAL - Architecture Checklist #4)
  let previousSnapshot = getDiagramSnapshot(diagramActor.getSnapshot());

  const actorSub = diagramActor.subscribe((state) => {
    const currSnapshot = getDiagramSnapshot(state);
    const canvas = getCanvas();

    // -------------------------------------------------------------------------
    // Detect transition INTO editing state
    // -------------------------------------------------------------------------
    if (!previousSnapshot.isEditing && currSnapshot.isEditing) {
      // Update cursor to text cursor
      if (canvas) {
        canvas.style.cursor = 'text';
      }

      // Emit event for text editing transition
      if (currSnapshot.selectedObjectId && currSnapshot.editingNodeId) {
        workbook.emit({
          type: 'diagram:edit-mode-changed',
          timestamp: Date.now(),
          objectId: currSnapshot.selectedObjectId,
          editingNodeId: currSnapshot.editingNodeId,
          previousEditingNodeId: null,
        });

        // Call callback if provided
        onNodeEditStart?.(currSnapshot.selectedObjectId, currSnapshot.editingNodeId);
      }
    }

    // -------------------------------------------------------------------------
    // Detect transition OUT OF editing state
    // -------------------------------------------------------------------------
    if (previousSnapshot.isEditing && !currSnapshot.isEditing) {
      // Reset cursor
      if (canvas) {
        canvas.style.cursor = currSnapshot.hasSelection ? 'pointer' : 'default';
      }

      // Emit event for edit mode exit
      if (previousSnapshot.selectedObjectId && previousSnapshot.editingNodeId) {
        workbook.emit({
          type: 'diagram:edit-mode-changed',
          timestamp: Date.now(),
          objectId: previousSnapshot.selectedObjectId,
          editingNodeId: null,
          previousEditingNodeId: previousSnapshot.editingNodeId,
        });

        // Call callback - committed = true if we were in editing and now have selection
        // (COMMIT_EDIT keeps selection), cancelled if we deselected entirely
        const committed = currSnapshot.hasSelection;
        onNodeEditEnd?.(
          previousSnapshot.selectedObjectId,
          previousSnapshot.editingNodeId,
          committed,
        );
      }
    }

    // -------------------------------------------------------------------------
    // Detect node selection changes
    // -------------------------------------------------------------------------
    const selectionChanged =
      previousSnapshot.selectedObjectId !== currSnapshot.selectedObjectId ||
      previousSnapshot.selectedNodeIds.join(',') !== currSnapshot.selectedNodeIds.join(',');

    if (selectionChanged && !currSnapshot.isEditing) {
      // Update cursor based on selection state
      if (canvas) {
        canvas.style.cursor = currSnapshot.hasSelection ? 'pointer' : 'default';
      }

      // Call callback if provided
      if (currSnapshot.selectedObjectId) {
        const selectedNode = currSnapshot.selectedNodeIds[0] ?? null;
        onNodeSelected?.(currSnapshot.selectedObjectId, selectedNode);
      } else if (previousSnapshot.selectedObjectId) {
        // Selection was cleared
        onNodeSelected?.(previousSnapshot.selectedObjectId, null);
      }

      // Emit selection changed event
      if (currSnapshot.selectedObjectId || previousSnapshot.selectedObjectId) {
        workbook.emit({
          type: 'diagram:selection-changed',
          timestamp: Date.now(),
          objectId: currSnapshot.selectedObjectId ?? previousSnapshot.selectedObjectId ?? '',
          selectedNodeIds: currSnapshot.selectedNodeIds,
          previousSelectedNodeIds: previousSnapshot.selectedNodeIds,
        });
      }
    }

    // -------------------------------------------------------------------------
    // Detect transition from nodeSelected to idle (full deselection)
    // -------------------------------------------------------------------------
    if (previousSnapshot.state !== 'idle' && currSnapshot.state === 'idle') {
      if (canvas) {
        canvas.style.cursor = 'default';
      }
    }

    previousSnapshot = currSnapshot;
  });
  localCleanups.push(() => actorSub.unsubscribe());

  // ---------------------------------------------------------------------------
  // HIT TESTING
  // ---------------------------------------------------------------------------

  /**
   * Perform hit testing on a Diagram diagram.
   */
  async function hitTest(objectId: string, x: number, y: number): Promise<DiagramHitTestResult> {
    // Get computed layout for the Diagram
    const layout = await diagramBridge.getComputedLayout(objectId);

    if (!layout) {
      return {
        hit: false,
        objectId: null,
        nodeId: null,
        shape: null,
      };
    }

    // Perform hit test
    const nodeId = hitTestLayout(layout, x, y);

    if (nodeId) {
      const shape = findShapeByNodeId(layout, nodeId);
      return {
        hit: true,
        objectId,
        nodeId,
        shape,
      };
    }

    // Hit was on the Diagram but not on a specific node
    return {
      hit: true,
      objectId,
      nodeId: null,
      shape: null,
    };
  }

  // ---------------------------------------------------------------------------
  // CLICK HANDLING - SENDS EVENTS TO MACHINE
  // ---------------------------------------------------------------------------

  /**
   * Handle click on Diagram object.
   * Sends SELECT_NODE or MULTI_SELECT_NODE or DESELECT events to the machine.
   */
  async function handleClick(
    objectId: string,
    x: number,
    y: number,
    isMultiSelect: boolean = false,
  ): Promise<void> {
    const result = await hitTest(objectId, x, y);

    if (!result.hit) {
      return;
    }

    if (result.nodeId) {
      if (isMultiSelect) {
        // Ctrl/Cmd+click: multi-select event
        diagramActor.send(DiagramEvents.multiSelectNode(objectId, result.nodeId));
      } else {
        // Normal click: single select
        diagramActor.send(DiagramEvents.selectNode(objectId, result.nodeId));
      }
    } else {
      // Clicked on Diagram background but not on a node - deselect
      diagramActor.send(DiagramEvents.deselect());
    }
  }

  // ---------------------------------------------------------------------------
  // DOUBLE-CLICK HANDLING - SENDS START_EDIT EVENT
  // ---------------------------------------------------------------------------

  /**
   * Handle double-click on Diagram object.
   * Sends START_EDIT event to the machine if a node is hit.
   */
  async function handleDoubleClick(objectId: string, x: number, y: number): Promise<void> {
    const result = await hitTest(objectId, x, y);

    if (!result.hit || !result.nodeId) {
      return;
    }

    // First ensure the node is selected
    const snapshot = getDiagramSnapshot(diagramActor.getSnapshot());
    if (
      snapshot.selectedObjectId !== objectId ||
      !snapshot.selectedNodeIds.includes(result.nodeId)
    ) {
      diagramActor.send(DiagramEvents.selectNode(objectId, result.nodeId));
    }

    // Then start editing
    diagramActor.send(DiagramEvents.startEdit(result.nodeId));
  }

  // ---------------------------------------------------------------------------
  // EDIT CONTROL METHODS
  // ---------------------------------------------------------------------------

  /**
   * Commit text edit with new text.
   */
  function commitEdit(text: string): void {
    diagramActor.send(DiagramEvents.commitEdit(text));
  }

  /**
   * Cancel text edit.
   */
  function cancelEdit(): void {
    diagramActor.send(DiagramEvents.cancelEdit());
  }

  // ---------------------------------------------------------------------------
  // SELECTION CLEARING
  // ---------------------------------------------------------------------------

  /**
   * Clear Diagram selection by sending DESELECT event.
   */
  function clearSelection(): void {
    diagramActor.send(DiagramEvents.deselect());
  }

  // ---------------------------------------------------------------------------
  // EVENT BUS SUBSCRIPTIONS
  // ---------------------------------------------------------------------------

  // Subscribe to Diagram deletion events to clear selection if needed
  const unsubDeleted = workbook.on('diagram:deleted', (event) => {
    const snapshot = getDiagramSnapshot(diagramActor.getSnapshot());
    if (snapshot.selectedObjectId === event.objectId) {
      diagramActor.send(DiagramEvents.deselect());
    }
  });
  localCleanups.push(unsubDeleted);

  // Subscribe to node removal to clear selection if the selected node is removed
  const unsubNodeRemoved = workbook.on('diagram:node-removed', (event) => {
    const snapshot = getDiagramSnapshot(diagramActor.getSnapshot());
    if (
      snapshot.selectedNodeIds.includes(event.nodeId) ||
      snapshot.editingNodeId === event.nodeId
    ) {
      // If editing the removed node, cancel edit first
      if (snapshot.editingNodeId === event.nodeId) {
        diagramActor.send(DiagramEvents.cancelEdit());
      }
      // Deselect since the node no longer exists
      diagramActor.send(DiagramEvents.deselect());
    }
  });
  localCleanups.push(unsubNodeRemoved);

  // Subscribe to external floating object selection events
  // When another floating object (chart, image, etc.) is selected, clear Diagram selection
  const unsubFloatingObjectSelected = workbook.on('floatingObject:selectionChanged', (event) => {
    // If a different floating object is selected (not our Diagram object),
    // clear Diagram node selection to avoid multiple active selections
    const snapshot = getDiagramSnapshot(diagramActor.getSnapshot());
    if (
      snapshot.hasSelection &&
      event.newSelectedIds.length > 0 &&
      !event.newSelectedIds.includes(snapshot.selectedObjectId ?? '')
    ) {
      diagramActor.send(DiagramEvents.externalSelectionActive());
    }
  });
  localCleanups.push(unsubFloatingObjectSelected);

  // Subscribe to Diagram click events from the canvas
  // This allows external components to emit click events that we handle
  const unsubDiagramClick = workbook.on('diagram:click', (event) => {
    const isMultiSelect = event.modifiers.ctrl || event.modifiers.meta;

    // Determine if this is a double-click by checking timestamp
    // (simplified - in real implementation, track last click time)
    handleClick(event.objectId, event.clickPosition.x, event.clickPosition.y, isMultiSelect);
  });
  localCleanups.push(unsubDiagramClick);

  // ---------------------------------------------------------------------------
  // CLEANUP
  // ---------------------------------------------------------------------------

  function cleanup(): void {
    // Clean up all subscriptions
    localCleanups.forEach((fn) => fn());

    // Stop the actor
    diagramActor.stop();
  }

  // Register cleanup with CleanupManager
  cleanups.register('diagramCoordination', cleanup);

  // ---------------------------------------------------------------------------
  // SNAPSHOT ACCESS
  // ---------------------------------------------------------------------------

  function getSnapshot(): DiagramSnapshot {
    return getDiagramSnapshot(diagramActor.getSnapshot());
  }

  // ---------------------------------------------------------------------------
  // RETURN RESULT
  // ---------------------------------------------------------------------------

  return {
    actor: diagramActor,
    getSnapshot,
    handleClick,
    handleDoubleClick,
    hitTest,
    clearSelection,
    commitEdit,
    cancelEdit,
    cleanup,
  };
}
