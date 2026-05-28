/**
 * Object Coordination Module
 *
 * Handles all floating object and outline (grouping) interaction coordination.
 * This module DELEGATES the entire concern - coordinator calls setup once.
 *
 * Responsibilities:
 * - Cross-coordination between object interaction and selection machines
 * - Floating object hit testing, mouse handling, and CRUD operations
 * - Outline (row/column grouping) hit testing
 *
 * @see COORDINATOR-MODULE-EXTRACTION.md
 */

// Note: isPointInDrawingObject from @mog/drawing-engine is referenced in TODO comments
// but not yet imported as a dependency. Import deferred until
import { isProd } from '@mog/env';
import type { IFloatingObjectManager } from '@mog-sdk/contracts/kernel';
import type {
  FloatingObjectOperation,
  ObjectAccessor,
  ObjectCommands,
  OperationObjectState,
} from '@mog-sdk/contracts/actors';
import type { Workbook } from '@mog-sdk/contracts/api';
import { type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { ObjectHitRegion, ShapeType } from '@mog-sdk/contracts/floating-objects';
import type { ViewportPoint } from '@mog-sdk/contracts/rendering/coordinates';
import type {
  GridRenderer,
  GroupingData,
  HitTestService,
  OutlineHitTestResult,
} from '@mog-sdk/contracts/rendering';
import type { ISheetViewGeometry, ISheetViewObjects } from '@mog-sdk/sheet-view';
import type { Point } from '@mog-sdk/contracts/viewport';
import type { ObjectInteractionActor, SelectionActor } from '../../shared/actor-types';
import {
  getCursorForState,
  getObjectInteractionSnapshot,
} from '../machines/object-interaction-machine';
import { createEffectiveStateService, type EffectiveStateService } from './effective-state-service';
import {
  calculateFinalStates,
  calculateStateFromOperation,
  type ObjectType,
  type ObjectState,
} from './operation-calculations';

// =============================================================================
// TYPES
// =============================================================================

// Point is imported from @mog-sdk/contracts

const MATERIAL_CHANGE_EPSILON = 1e-9;
const INSERT_MIN_SIZE = 20;
const INSERT_DEFAULT_SIZE = 200;

interface ShapeInsertBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Result of floating object hit test */
export interface ObjectHitResult {
  objectId: string;
  region: ObjectHitRegion;
  isGroup: boolean;
}

/** Configuration for object coordination setup */
export interface ObjectCoordinationConfig {
  objectInteractionActor: ObjectInteractionActor;
  selectionActor: SelectionActor;
  floatingObjects: IFloatingObjectManager | null;
  getCanvas: () => HTMLElement | null;
  getGeometry: () => ISheetViewGeometry | null;
  /**
   * Floating-object scene capability for synchronous operation bounds reads and
   * transient drag/resize/rotate scene updates.
   */
  getObjects: () => ISheetViewObjects | null;
  /** Function to get the grid renderer for unified hit testing (may return null if not initialized) */
  getGridRenderer: () => GridRenderer | null;
  /**
   * Hit test service for outline (grouping) buttons.
   *
   * Canvas-State Decoupling
   * This service replaces the direct import of hitTestOutline from canvas.
   * The coordinator creates and injects the service at construction time.
   *
   * If null, outline hit testing will be disabled (groupingDataGetter not used).
   */
  hitTestService: HitTestService | null;
  /**
   * Object accessor for point-in-time reads in handlers.
   * Actor Access Layer wiring.
   */
  accessors: ObjectAccessor;
  /**
   * Object commands for type-safe event sending.
   * Actor Access Layer wiring.
   */
  commands: ObjectCommands;
  /**
   * Function to get the Workbook for Mutations layer access.
   * Use Mutations layer for final writes.
   */
  getWorkbook: () => Workbook | null;
  /**
   * Mutation callbacks injected from coordinator layer.
   * systems/ must NOT import from coordinator/mutations/ directly.
   */
  mutations: {
    moveChart: (
      workbook: Workbook,
      sheetId: SheetId,
      chartId: string,
      dx: number,
      dy: number,
    ) => Promise<{ success: boolean }> | { success: boolean };
    resizeChart: (
      workbook: Workbook,
      sheetId: SheetId,
      chartId: string,
      size: { width: number; height: number },
    ) => Promise<{ success: boolean }> | { success: boolean };
    moveObject: (
      workbook: Workbook,
      store: IFloatingObjectManager | undefined,
      objectId: string,
      x: number,
      y: number,
    ) => Promise<{ success: boolean }> | { success: boolean };
    resizeObject: (
      workbook: Workbook,
      store: IFloatingObjectManager | undefined,
      objectId: string,
      width: number,
      height: number,
    ) => Promise<{ success: boolean }> | { success: boolean };
    rotateObject: (
      workbook: Workbook,
      store: IFloatingObjectManager | undefined,
      objectId: string,
      angle: number,
    ) => Promise<{ success: boolean }> | { success: boolean };
  };

  /**
   * Optional callback to check if ink mode is active (for input isolation).
   * When true, handleMouseDown() will skip object interaction to allow
   * ink input handler to receive pointer events on drawing objects.
   */
  isInkModeActive?: () => boolean;

  /**
   * Action dispatcher for triggering high-level actions (e.g. INSERT_SHAPE).
   * Called by coordination during insert-mode completion.
   */
  dispatch?: (action: string, payload: Record<string, unknown>) => Promise<void> | void;
}

/** Result returned by setupObjectCoordination */
export interface ObjectCoordinationResult {
  // Floating object operations
  hitTestFloatingObject: (sheetId: SheetId, x: number, y: number) => ObjectHitResult | null;
  handleMouseDown: (
    objectId: string,
    region: ObjectHitRegion,
    position: Point,
    shiftKey: boolean,
    ctrlKey: boolean,
  ) => void;
  handleMouseMove: (position: Point, shiftKey: boolean) => void;
  handleMouseUp: (position: Point) => void;
  deleteSelectedObjects: () => void;
  deselectAllObjects: () => void;

  // Outline/grouping operations
  hitTestOutline: (x: number, y: number) => OutlineHitTestResult | null;
  setGroupingDataGetter: (getter: () => GroupingData) => void;

  // Snapshot access
  getSnapshot: () => ReturnType<typeof getObjectInteractionSnapshot>;

  /**
   * Object accessor for point-in-time reads in handlers.
   * Actor Access Layer wiring.
   */
  accessors: ObjectAccessor;

  /**
   * Object commands for type-safe event sending.
   * Actor Access Layer wiring.
   */
  commands: ObjectCommands;

  /**
   * Effective state service for non-rendering consumers.
   *
   * Provides computed visual positions during operations for external consumers
   * (e.g., React overlay components, remote presence). The renderer reads
   * directly from the scene graph, which is updated through ISheetViewObjects
   * on every pointer event, so it does NOT use this service.
   *
   */
  effectiveStateService: EffectiveStateService;

  // Cleanup
  cleanup: () => void;
}

function numbersEqual(a: number | undefined, b: number | undefined): boolean {
  return Math.abs((a ?? 0) - (b ?? 0)) <= MATERIAL_CHANGE_EPSILON;
}

function operationHasMaterialChange(
  operation: FloatingObjectOperation,
  originalState: ObjectState | undefined,
  finalState: ObjectState,
): boolean {
  if (!originalState) return true;

  switch (operation.type) {
    case 'drag':
      return (
        !numbersEqual(finalState.bounds.x, originalState.bounds.x) ||
        !numbersEqual(finalState.bounds.y, originalState.bounds.y)
      );
    case 'resize':
      return (
        !numbersEqual(finalState.bounds.x, originalState.bounds.x) ||
        !numbersEqual(finalState.bounds.y, originalState.bounds.y) ||
        !numbersEqual(finalState.bounds.width, originalState.bounds.width) ||
        !numbersEqual(finalState.bounds.height, originalState.bounds.height)
      );
    case 'rotate':
      return !numbersEqual(finalState.rotation, originalState.rotation);
  }
}

// =============================================================================
// SETUP FUNCTION
// =============================================================================

/**
 * Set up object coordination.
 *
 * This function:
 * 1. Sets up cross-coordination between object interaction and selection machines
 * 2. Provides methods for hit testing, mouse handling, and object operations
 * 3. Manages the grouping data getter for outline hit testing
 *
 * @param config - Configuration with actors and managers
 * @returns Result object with methods and cleanup
 */
export function setupObjectCoordination(
  config: ObjectCoordinationConfig,
): ObjectCoordinationResult {
  const {
    objectInteractionActor,
    // NOTE: selectionActor is kept in the interface for API stability but no longer used here.
    // Selection→Object deselection is handled by selection-context-coordination.ts.
    selectionActor: _selectionActor,
    floatingObjects,
    getCanvas,
    hitTestService,
    // Actor Access Layer wiring
    accessors,
    commands,
    // Mutations layer access
    getWorkbook,
  } = config;

  // NOTE : The grouping data getter is now wired directly through
  // the HitTestService closure at coordinator construction time. The setter
  // function is kept for backward compatibility but no longer stores locally.

  // ---------------------------------------------------------------------------
  // Create effective state service
  // ---------------------------------------------------------------------------

  // Helper to get object type for constraint application
  const getObjectType = async (objectId: string): Promise<ObjectType | undefined> => {
    if (!floatingObjects) return undefined;
    const obj = await floatingObjects.getObject(objectId);
    if (!obj) return undefined;
    // Map floating object types to operation calculation types
    return obj.type === 'picture' ? 'image' : (obj.type as 'shape' | 'chart');
  };

  // Create effective state service (or null service if no manager)
  // The service provides computed visual state for the renderer during operations
  const effectiveStateService: EffectiveStateService = floatingObjects
    ? createEffectiveStateService({
        accessors,
        floatingObjects,
        getObjectType,
      })
    : // Null object pattern when floatingObjects is not available
      {
        getEffectiveState: async () => null,
        getAffectedEffectiveStates: async () => new Map(),
        isObjectInOperation: () => false,
        updateRemoteOperations: () => {},
        clearRemoteOperations: () => {},
      };

  // ---------------------------------------------------------------------------
  // Cross-coordination subscriptions
  // ---------------------------------------------------------------------------

  // Subscribe to object interaction state changes for cursor updates
  const objectSub = objectInteractionActor.subscribe((state) => {
    const snapshot = getObjectInteractionSnapshot(state);

    // Reactive: Update cursor based on object interaction state
    const canvas = getCanvas();
    if (canvas) {
      const hoveredHandle = null; // TODO: Get from hit testing
      const cursor = getCursorForState(state, hoveredHandle);
      if (snapshot.isOperating || snapshot.isInserting) {
        canvas.style.cursor = cursor;
      }
    }
  });

  // NOTE: Selection→Object deselection is now handled by selection-context-coordination.ts
  // (Cross-Machine Communication). That module provides bidirectional, transition-based
  // coordination across all three selection contexts (cells, objects, charts).

  // ---------------------------------------------------------------------------
  // Operating state transition detection and commit logic
  // ---------------------------------------------------------------------------

  // Track previous operating state for transition detection
  let wasOperating = false;
  let pendingOperation: FloatingObjectOperation | null = null;

  /**
   * Commit an operation to persistence via Mutations layer.
   * Use Mutations layer for final writes.
   *
   * Charts require special handling:
   * - Charts are stored in their own domain module (not floatingObjects Y.Map)
   * - Chart positions are stored in cell coordinates, not pixels
   * - Use moveChart/resizeChart mutations which handle the conversion
   */
  async function commitOperation(operation: FloatingObjectOperation): Promise<void> {
    const wb = getWorkbook();
    if (!wb) return;

    // Calculate final states using pure functions
    const getObjType = async (objectId: string): Promise<ObjectType | undefined> => {
      const obj = await floatingObjects?.getObject(objectId);
      if (!obj) return undefined;
      return obj.type === 'picture' ? 'image' : (obj.type as ObjectType);
    };

    const finalStates = await calculateFinalStates(operation, getObjType);

    // Apply final states via Mutations layer
    for (const [objectId, finalState] of finalStates) {
      const obj = await floatingObjects?.getObject(objectId);
      const isChart = obj?.type === 'chart';
      const originalState = operation.originalStates.get(objectId);

      if (!operationHasMaterialChange(operation, originalState, finalState)) {
        continue;
      }

      if (isChart && obj) {
        // Charts are floating objects in storage. Move/resize through the same
        // typed floating-object path as other objects so CSS-pixel interaction
        // deltas are converted to canonical EMU anchors at the kernel boundary.
        const chartSheetId = toSheetId(obj.sheetId);

        if (operation.type === 'drag') {
          const dx = finalState.bounds.x - (originalState?.bounds.x ?? 0);
          const dy = finalState.bounds.y - (originalState?.bounds.y ?? 0);
          await config.mutations.moveChart(wb, chartSheetId, objectId, dx, dy);
        } else if (operation.type === 'resize') {
          await config.mutations.resizeChart(wb, chartSheetId, objectId, {
            width: finalState.bounds.width,
            height: finalState.bounds.height,
          });
          if (
            originalState &&
            (finalState.bounds.x !== originalState.bounds.x ||
              finalState.bounds.y !== originalState.bounds.y)
          ) {
            const dx = finalState.bounds.x - originalState.bounds.x;
            const dy = finalState.bounds.y - originalState.bounds.y;
            await config.mutations.moveChart(wb, chartSheetId, objectId, dx, dy);
          }
        }
        // Note: Charts don't support rotation, skip rotate operations
      } else {
        // Non-charts: Use standard floating object mutations
        // Note: moveObject expects DELTAS (dx, dy), not absolute coordinates.
        // Compute delta from original → final position.
        if (operation.type === 'drag') {
          const dx = finalState.bounds.x - (originalState?.bounds.x ?? 0);
          const dy = finalState.bounds.y - (originalState?.bounds.y ?? 0);
          await config.mutations.moveObject(wb, floatingObjects ?? undefined, objectId, dx, dy);
        } else if (operation.type === 'resize') {
          await config.mutations.resizeObject(
            wb,
            floatingObjects ?? undefined,
            objectId,
            finalState.bounds.width,
            finalState.bounds.height,
          );
          // Also update position if anchor point moved (for n/w/nw/ne/sw handles)
          if (
            originalState &&
            (finalState.bounds.x !== originalState.bounds.x ||
              finalState.bounds.y !== originalState.bounds.y)
          ) {
            const dx = finalState.bounds.x - originalState.bounds.x;
            const dy = finalState.bounds.y - originalState.bounds.y;
            await config.mutations.moveObject(wb, floatingObjects ?? undefined, objectId, dx, dy);
          }
        } else if (operation.type === 'rotate') {
          await config.mutations.rotateObject(
            wb,
            floatingObjects ?? undefined,
            objectId,
            finalState.rotation,
          );
        }
      }
    }

    // Clear operation from state machine after commit
    config.getObjects()?.clearTransientBounds();
    commands.clearOperation();
  }

  function computeShapeInsertBounds(startPos: Point, position: Point): ShapeInsertBounds {
    let x = Math.min(startPos.x, position.x);
    let y = Math.min(startPos.y, position.y);
    let width = Math.abs(position.x - startPos.x);
    let height = Math.abs(position.y - startPos.y);

    if (width < INSERT_MIN_SIZE && height < INSERT_MIN_SIZE) {
      x = startPos.x;
      y = startPos.y;
      width = INSERT_DEFAULT_SIZE;
      height = INSERT_DEFAULT_SIZE;
    } else {
      if (width < INSERT_MIN_SIZE) width = INSERT_MIN_SIZE;
      if (height < INSERT_MIN_SIZE) height = INSERT_MIN_SIZE;
    }

    return { x, y, width, height };
  }

  function viewportBoundsToDocumentBounds(
    sheetId: SheetId,
    bounds: ShapeInsertBounds,
  ): ShapeInsertBounds {
    const gridRenderer = config.getGridRenderer();
    if (!gridRenderer) return bounds;

    const coords = gridRenderer.getCoordinateSystem();
    const topLeft = coords.viewportToDocument(sheetId, {
      x: bounds.x,
      y: bounds.y,
    } as ViewportPoint);
    const bottomRight = coords.viewportToDocument(sheetId, {
      x: bounds.x + bounds.width,
      y: bounds.y + bounds.height,
    } as ViewportPoint);

    return {
      x: Math.min(topLeft.x, bottomRight.x),
      y: Math.min(topLeft.y, bottomRight.y),
      width: Math.abs(bottomRight.x - topLeft.x),
      height: Math.abs(bottomRight.y - topLeft.y),
    };
  }

  function getDocumentInsertBounds(viewportBounds: ShapeInsertBounds): ShapeInsertBounds {
    const wb = getWorkbook();
    if (!wb) return viewportBounds;
    return viewportBoundsToDocumentBounds(toSheetId(wb.activeSheet.sheetId), viewportBounds);
  }

  async function createShapeFromDocumentBounds(
    shapeType: ShapeType,
    documentBounds: ShapeInsertBounds,
  ): Promise<void> {
    const wb = getWorkbook();
    if (!wb) return;

    const ws = wb.activeSheet;
    const maybeInternalWorkbook = wb as Workbook & {
      setPendingUndoDescription?: (description: string) => void;
    };
    maybeInternalWorkbook.setPendingUndoDescription?.('Insert shape');

    await ws.shapes.add({
      type: shapeType,
      anchorRow: 0,
      anchorCol: 0,
      pixelX: documentBounds.x,
      pixelY: documentBounds.y,
      width: documentBounds.width,
      height: documentBounds.height,
    });
  }

  // Subscribe to detect operating → selected transition
  const operationSub = objectInteractionActor.subscribe(() => {
    const isOperating = accessors.isOperating();
    const operation = accessors.getOperation();

    // Detect transition: operating → selected
    if (wasOperating && !isOperating) {
      // Operation completed - commit to persistence
      if (pendingOperation && floatingObjects) {
        void commitOperation(pendingOperation).catch((error) => {
          console.error('[object-coordination] Failed to commit object operation', error);
          commands.clearOperation();
        });
      }
      pendingOperation = null;
    }

    // Store operation while in operating state (for commit after transition)
    if (isOperating && operation) {
      pendingOperation = operation;
    }

    wasOperating = isOperating;
  });

  // ---------------------------------------------------------------------------
  // Floating object methods
  // ---------------------------------------------------------------------------

  function hitTestFloatingObject(sheetId: SheetId, x: number, y: number): ObjectHitResult | null {
    // TODO: When EffectiveObjectState.drawingObject is populated,
    // use isPointInDrawingObject() from @mog/drawing-engine for narrow-phase
    // hit testing against the pre-computed DrawingObject geometry. This will
    // enable pixel-perfect hit testing without depending on the canvas Path2D.
    // For now, we delegate to GridRenderer.hitTest() which uses the engine pipeline.

    // Use the unified GridRenderer.hitTest() which:
    // 1. Works directly with viewport coordinates (from mouse events)
    // 2. Uses Path2D-based hit testing (pixel-perfect for all shapes)
    // 3. Was built during rendering (no race condition)
    const gridRenderer = config.getGridRenderer();
    if (!gridRenderer) {
      // INVARIANT: Grid renderer must be available when hit testing is called.
      // If shapes are visible on screen, the renderer must have been initialized.
      // This indicates a timing/wiring bug that should be fixed, not silently tolerated.
      const msg =
        '[object-coordination] INVARIANT VIOLATION: Grid renderer must be available for hit testing. ' +
        'This indicates the renderer was not properly initialized before user interaction.';
      if (!isProd()) {
        throw new Error(msg);
      }
      console.error(msg);
      return null;
    }

    // Use unified hit testing - returns FloatingObjectHitResult if a shape was hit
    const result = gridRenderer.hitTest(x, y);

    // Check if result is a floating object hit
    if (result.type === 'floatingObject') {
      return {
        objectId: result.objectId,
        region: result.region,
        isGroup: result.isGroup,
      };
    }

    return null;
  }

  function handleMouseDown(
    objectId: string,
    region: ObjectHitRegion,
    position: Point,
    shiftKey: boolean,
    ctrlKey: boolean,
  ): void {
    // Skip object interaction when in ink mode
    // This allows ink input handler to receive pointer events on drawing objects
    if (config.isInkModeActive?.()) return;

    // In insert mode, pointerdown records the start position (objectId/region ignored)
    if (accessors.isInserting()) {
      commands.setInsertStart(position);
      return;
    }

    // Get the SheetView object scene capability for synchronous bounds lookup.
    // Bounds are already in JS memory (populated during render) — no async IPC needed.
    const objects = config.getObjects();

    if (region === 'body' || region === 'border') {
      // ═══════════════════════════════════════════════════════════════════════
      // Both selection AND drag setup are synchronous.
      // Bounds are read from the scene graph (populated during render).
      // ═══════════════════════════════════════════════════════════════════════

      // Get all selected objects (for multi-select drag)
      const selectedIds = accessors.getSelectedIds();

      // Select if not already selected (synchronous — always succeeds)
      if (!selectedIds.includes(objectId)) {
        commands.selectObject(objectId, shiftKey, ctrlKey);
      }

      // Drag setup: capture original states for ALL selected objects
      if (!objects) return;

      const objectIds =
        selectedIds.length > 0 && selectedIds.includes(objectId)
          ? selectedIds // Dragging one of multi-selected - move all
          : [objectId]; // Dragging unselected object - select and drag just this one

      // Build original states map — sync reads from scene graph
      const originalStates = new Map<string, OperationObjectState>();
      for (const id of objectIds) {
        const bounds = objects.getBounds(id);
        if (!bounds) continue;
        originalStates.set(id, {
          bounds,
          rotation: bounds.rotation,
        });
      }

      if (originalStates.size === 0) return;

      // Start drag operation — synchronous, within the same event handler frame
      commands.startDrag(objectIds, position, originalStates);
    } else if (region === 'rotation') {
      // Rotation handle - start rotate operation
      const bounds = objects?.getBounds(objectId);
      if (!bounds) return;

      const rotationCenter = {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
      };

      const originalStates = new Map<string, OperationObjectState>();
      originalStates.set(objectId, {
        bounds,
        rotation: bounds.rotation,
      });

      commands.startRotate([objectId], position, rotationCenter, originalStates);
    } else if (region.startsWith('resize-')) {
      // Resize handle
      const bounds = objects?.getBounds(objectId);
      if (!bounds) return;

      const handle = region.replace('resize-', '') as
        | 'n'
        | 'ne'
        | 'e'
        | 'se'
        | 's'
        | 'sw'
        | 'w'
        | 'nw';

      const originalStates = new Map<string, OperationObjectState>();
      originalStates.set(objectId, {
        bounds,
        rotation: bounds.rotation,
      });

      commands.startResize([objectId], position, handle, originalStates);
    }
  }

  function handleMouseMove(position: Point, _shiftKey: boolean): void {
    // In insert mode, update current bounds for preview rectangle
    if (accessors.isInserting() && accessors.getInsertStartPosition()) {
      commands.updateInsertBounds(position);
      return;
    }

    if (accessors.isOperating()) {
      commands.updatePosition(position);

      // Update scene graph directly — makes it single authority for object position
      // during the entire operation lifecycle. This eliminates the flash bug where
      // clearing the operation would fall back to stale scene graph position.
      const objects = config.getObjects();
      const operation = accessors.getOperation();
      if (objects && operation) {
        // CRITICAL: We pass currentPosition explicitly rather than reading from
        // operation.currentPosition. commands.updatePosition sends an async XState
        // event — operation.currentPosition won't reflect the new position until
        // the next microtask. The explicit override ensures the scene graph is
        // updated synchronously in the same frame.
        const operationWithCurrentPos = { ...operation, currentPosition: position };
        for (const objectId of operation.objectIds) {
          const state = calculateStateFromOperation(operationWithCurrentPos, objectId);
          objects.updateTransientBounds(objectId, {
            x: state.bounds.x,
            y: state.bounds.y,
            width: state.bounds.width,
            height: state.bounds.height,
            rotation: state.rotation,
          });
        }
      }
    }
  }

  function handleMouseUp(position: Point): void {
    // In insert mode, compute final bounds, dispatch INSERT_SHAPE, and complete
    if (accessors.isInserting()) {
      const shapeType = accessors.getInsertShapeType();
      const startPos = accessors.getInsertStartPosition();

      if (shapeType && startPos) {
        const bounds = getDocumentInsertBounds(computeShapeInsertBounds(startPos, position));

        if (config.dispatch) {
          config.dispatch('INSERT_SHAPE', {
            shapeType,
            position: bounds,
          });
        } else {
          void createShapeFromDocumentBounds(shapeType as ShapeType, bounds).catch((error) => {
            console.error('[object-coordination] Failed to create inserted shape', error);
          });
        }
      }

      commands.completeInsert();
      return;
    }

    // Complete the operation - subscription handles the commit
    if (accessors.isOperating()) {
      commands.completeOperation();
    }
  }

  function deleteSelectedObjects(): void {
    const snapshot = getObjectInteractionSnapshot(objectInteractionActor.getSnapshot());

    if (snapshot.selectedIds.length > 0 && floatingObjects) {
      floatingObjects.deleteObjects(snapshot.selectedIds);
      objectInteractionActor.send({ type: 'KEY_DELETE' });
    }
  }

  function deselectAllObjects(): void {
    objectInteractionActor.send({ type: 'DESELECT_ALL' });
  }

  // ---------------------------------------------------------------------------
  // Outline/grouping methods
  // ---------------------------------------------------------------------------

  function setGroupingDataGetter(_getter: () => GroupingData): void {
    // This setter is kept for backward compatibility.
    // The actual grouping data getter is now wired directly through the
    // HitTestService closure at coordinator construction time.
    // The coordinator's setGroupingDataGetter stores it and the HitTestService
    // reads it through its closure.
  }

  /**
   * Hit test outline (grouping) buttons.
   *
   * Canvas-State Decoupling
   * This function now delegates to the injected HitTestService instead of
   * directly calling the hitTestOutline function from canvas.
   *
   * The HitTestService is created by the coordinator and handles:
   * - Building the minimal render context needed for hit testing
   * - Calling the underlying hitTestOutline function in canvas
   *
   * Note: groupingDataGetter is still used internally by the HitTestService
   * but is wired through the service's getGroupingData constructor parameter.
   */
  function hitTestOutline(x: number, y: number): OutlineHitTestResult | null {
    // Delegate to injected service
    if (!hitTestService) {
      return null;
    }
    return hitTestService.hitTestOutline(x, y);
  }

  // ---------------------------------------------------------------------------
  // Snapshot access
  // ---------------------------------------------------------------------------

  function getSnapshot(): ReturnType<typeof getObjectInteractionSnapshot> {
    return getObjectInteractionSnapshot(objectInteractionActor.getSnapshot());
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  function cleanup(): void {
    objectSub.unsubscribe();
    operationSub.unsubscribe();

    // Clear state tracking
    wasOperating = false;
    pendingOperation = null;
  }

  // ---------------------------------------------------------------------------
  // Return result
  // ---------------------------------------------------------------------------

  return {
    hitTestFloatingObject,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    deleteSelectedObjects,
    deselectAllObjects,
    hitTestOutline,
    setGroupingDataGetter,
    getSnapshot,
    // Actor Access Layer wiring - expose accessors and commands
    accessors,
    commands,
    // Effective state service for non-rendering consumers (e.g., React overlays)
    effectiveStateService,
    cleanup,
  };
}
