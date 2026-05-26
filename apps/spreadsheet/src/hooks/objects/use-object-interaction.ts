/**
 * Object Interaction Hook
 *
 * React hook that wraps the object interaction state machine actor.
 * Provides type-safe access to floating object selection, drag, resize, and rotation state.
 *
 * Floating Objects
 *
 * Architecture: Actor Access Layer (
 * - All reactive reads use imported selectors with useSelector
 * - All writes use commands from createObjectCommands
 * - NO inline selector functions
 * - NO direct .send() calls (except for special coordinator methods)
 *
 * NOTE: Mouse move and mouse up go through coordinator methods (handleObjectMouseMove,
 * handleObjectMouseUp) rather than direct actor.send() because the coordinator handles
 * coordinate transforms, throttling, and Yjs updates.
 *
 * @see contracts/src/floating-objects.ts - Type contracts
 */

import { useSelector } from '@xstate/react';
import { useCallback, useMemo } from 'react';

import type { FloatingObjectOperation } from '@mog-sdk/contracts/actors';
import { objectSelectors } from '../../selectors';
import type { ObjectState } from '@mog-sdk/contracts/actors';
import type { ObjectHitRegion, ObjectInteractionState } from '@mog-sdk/contracts/floating-objects';
import type { Point } from '@mog-sdk/contracts/viewport';

import { createObjectCommands } from '../../coordinator/actor-access';
import { useCoordinator } from '../shared/use-coordinator';

// Type-safe selector wrapper to handle XState snapshot type compatibility

type AnySelector<T> = (state: any) => T;
const asSelector = <T>(selector: (state: ObjectState) => T): AnySelector<T> => selector;

// =============================================================================
// CURSOR HELPER
// =============================================================================

/**
 * Check if a handle is a resize handle (not body/border/rotation).
 */
function isResizeHandle(handle: ObjectHitRegion): boolean {
  return handle.startsWith('resize-');
}

/**
 * Get the appropriate resize cursor for a handle.
 */
function getResizeCursor(handle: ObjectHitRegion): string {
  switch (handle) {
    case 'resize-n':
    case 'resize-s':
      return 'ns-resize';
    case 'resize-e':
    case 'resize-w':
      return 'ew-resize';
    case 'resize-ne':
    case 'resize-sw':
      return 'nesw-resize';
    case 'resize-nw':
    case 'resize-se':
      return 'nwse-resize';
    default:
      return 'default';
  }
}

/**
 * Get the cursor style for the current interaction state.
 * This is a local helper that uses already-extracted state values
 * to avoid subscribing to the entire state object.
 */
function getCursorForCurrentState(
  isOperating: boolean,
  operation: FloatingObjectOperation | null,
  hoveredHandle: ObjectHitRegion | null,
): string {
  // If currently in an operation, show appropriate cursor based on operation type
  if (isOperating && operation) {
    switch (operation.type) {
      case 'drag':
        return 'grabbing';
      case 'rotate':
        return 'crosshair';
      case 'resize':
        if (operation.resizeHandle) {
          return getResizeCursor(`resize-${operation.resizeHandle}` as ObjectHitRegion);
        }
        return 'default';
    }
  }

  // If hovering over a handle, show handle cursor
  if (hoveredHandle) {
    if (hoveredHandle === 'rotation') return 'crosshair';
    if (hoveredHandle === 'body' || hoveredHandle === 'border') return 'grab';
    if (hoveredHandle === 'warp-adjust') return 'ns-resize';
    if (isResizeHandle(hoveredHandle)) return getResizeCursor(hoveredHandle);
  }

  // Default
  return 'default';
}

// =============================================================================
// HOOK RETURN TYPE
// =============================================================================

export interface UseObjectInteractionReturn {
  // ===========================================================================
  // STATE
  // ===========================================================================

  /** Current interaction state (idle, selected, dragging, etc.) */
  interactionState: ObjectInteractionState;

  /** Currently selected object IDs (empty if idle) */
  selectedIds: string[];

  /** Object being text-edited (if any) */
  editingObjectId: string | null;

  /** Whether currently dragging object(s) */
  isDragging: boolean;

  /** Whether currently resizing an object */
  isResizing: boolean;

  /** Whether currently rotating an object */
  isRotating: boolean;

  /** Whether editing text inside an object */
  isEditingText: boolean;

  /** Active resize/rotation handle (if any) */
  activeHandle: ObjectHitRegion | null;

  /** Drag start position (for calculating delta) */
  dragStart: Point | null;

  /** Current drag position */
  dragCurrent: Point | null;

  /** Whether shift key is held (for constrained operations) */
  shiftKey: boolean;

  /** Whether any object is selected */
  hasSelection: boolean;

  /** Whether multiple objects are selected */
  hasMultipleSelected: boolean;

  /** Whether in insert mode (drag-to-insert a new shape) */
  isInserting: boolean;

  // ===========================================================================
  // SELECTION ACTIONS
  // ===========================================================================

  /** Select a single object */
  selectObject: (objectId: string, shiftKey?: boolean, ctrlKey?: boolean) => void;

  /** Select multiple objects */
  selectMultiple: (objectIds: string[]) => void;

  /** Deselect all objects */
  deselectAll: () => void;

  // ===========================================================================
  // MOUSE ACTIONS
  // ===========================================================================

  /** Handle mouse down on object body (starts drag) */
  onMouseDownBody: (
    objectId: string,
    position: Point,
    shiftKey?: boolean,
    ctrlKey?: boolean,
  ) => void;

  /** Handle mouse down on resize/rotation handle */
  onMouseDownHandle: (
    objectId: string,
    handle: ObjectHitRegion,
    position: Point,
    shiftKey?: boolean,
    ctrlKey?: boolean,
  ) => void;

  /** Handle mouse move (during drag/resize/rotate) */
  onMouseMove: (position: Point, shiftKey?: boolean) => void;

  /** Handle mouse up */
  onMouseUp: (position: Point) => void;

  // ===========================================================================
  // TEXT EDITING ACTIONS
  // ===========================================================================

  /** Enter text editing mode (double-click on textbox/shape) */
  enterTextEditing: (objectId: string) => void;

  /**
   * Enter TextEffect text editing mode (double-click on TextEffect textbox).
   * TextEffect Canvas Integration
   */
  enterTextEffectEditing: (objectId: string) => void;

  /**
   * Exit TextEffect text editing mode.
   * TextEffect Canvas Integration
   */
  exitTextEffectEditing: () => void;

  /** Commit text changes */
  commitText: (text: string) => void;

  /** Cancel text editing */
  cancelText: () => void;

  // ===========================================================================
  // KEYBOARD ACTIONS
  // ===========================================================================

  /** Handle Delete key (delete selected objects) */
  onKeyDelete: () => void;

  /** Handle Escape key (deselect or cancel operation) */
  onKeyEscape: () => void;

  /** Handle arrow keys (nudge selected objects) */
  onKeyArrow: (direction: 'up' | 'down' | 'left' | 'right', shiftKey?: boolean) => void;

  /** Handle Ctrl+D (duplicate selected objects) */
  onKeyDuplicate: () => void;

  // ===========================================================================
  // UTILITY
  // ===========================================================================

  /** Get cursor style for current state and hovered handle */
  getCursor: (hoveredHandle: ObjectHitRegion | null) => string;

  /** Reset state machine to idle */
  reset: () => void;
}

// =============================================================================
// HOOK IMPLEMENTATION
// =============================================================================

/**
 * Hook for accessing and controlling the object interaction state machine.
 *
 * @example
 * ```tsx
 * function FloatingObjectOverlay() {
 * const {
 * selectedIds,
 * isDragging,
 * isResizing,
 * selectObject,
 * onMouseDownBody,
 * onMouseMove,
 * onMouseUp,
 * getCursor,
 * } = useObjectInteraction;
 *
 * const handleCanvasMouseDown = (e: MouseEvent, hitResult: HitTestResult | null) => {
 * if (hitResult) {
 * if (hitResult.region === 'body' || hitResult.region === 'border') {
 * onMouseDownBody(hitResult.objectId, { x: e.clientX, y: e.clientY }, e.shiftKey);
 * } else {
 * onMouseDownHandle(hitResult.objectId, hitResult.region, { x: e.clientX, y: e.clientY }, e.shiftKey);
 * }
 * }
 * };
 *
 * return (
 * <canvas
 * style={{ cursor: getCursor(hoveredHandle) }}
 * onMouseDown={handleCanvasMouseDown}
 * onMouseMove={(e) => onMouseMove({ x: e.clientX, y: e.clientY }, e.shiftKey)}
 * onMouseUp={(e) => onMouseUp({ x: e.clientX, y: e.clientY })}
 * />
 * );
 * }
 * ```
 */
export function useObjectInteraction(): UseObjectInteractionReturn {
  const coordinator = useCoordinator();
  const actor = coordinator.objects.access.actors.object;

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE - Using imported selectors (Actor Access Layer pattern)
  // ═══════════════════════════════════════════════════════════════════════════

  const interactionState = useSelector(actor, asSelector(objectSelectors.interactionState));
  const selectedIds = useSelector(actor, asSelector(objectSelectors.selectedIds));
  const editingObjectId = useSelector(actor, asSelector(objectSelectors.editingObjectId));
  const isEditingText = useSelector(actor, asSelector(objectSelectors.isEditingText));
  const activeHandle = useSelector(actor, asSelector(objectSelectors.activeHandle));
  const shiftKey = useSelector(actor, asSelector(objectSelectors.shiftKey));
  const hasSelection = useSelector(actor, asSelector(objectSelectors.hasSelection));
  const hasMultipleSelected = useSelector(actor, asSelector(objectSelectors.hasMultipleSelected));
  const operation = useSelector(actor, asSelector(objectSelectors.operation));
  const isInserting = useSelector(actor, asSelector(objectSelectors.isInserting));

  // Derive convenience booleans from the unified operation
  const isDragging = operation?.type === 'drag';
  const isResizing = operation?.type === 'resize';
  const isRotating = operation?.type === 'rotate';

  // Derive drag positions from the unified operation
  const dragStart = operation?.startPosition ?? null;
  const dragCurrent = operation?.currentPosition ?? null;

  // Derive isOperating from interactionState (avoids subscribing to full state)
  const isOperating = interactionState === 'operating';

  // ═══════════════════════════════════════════════════════════════════════════
  // COMMANDS - Using createObjectCommands (Actor Access Layer pattern)
  // ═══════════════════════════════════════════════════════════════════════════

  const commands = useMemo(() => createObjectCommands(actor), [actor]);

  // ═══════════════════════════════════════════════════════════════════════════
  // WRAPPER FUNCTIONS
  // These wrap commands to handle optional parameters with defaults
  // ═══════════════════════════════════════════════════════════════════════════

  const selectObject = useCallback(
    (objectId: string, shiftKeyParam = false, ctrlKey = false) => {
      commands.selectObject(objectId, shiftKeyParam, ctrlKey);
    },
    [commands],
  );

  // CRITICAL: Mouse down must go through the coordinator, not directly to the actor!
  // The coordinator's handleMouseDown captures original bounds at drag start, which is
  // required for calculating final position on mouse up. Without this, shapes won't move.
  const onMouseDownBody = useCallback(
    (objectId: string, position: Point, shiftKeyParam = false, ctrlKeyParam = false) => {
      coordinator.objects.handleObjectMouseDown(
        objectId,
        'body',
        position,
        shiftKeyParam,
        ctrlKeyParam,
      );
    },
    [coordinator],
  );

  const onMouseDownHandle = useCallback(
    (
      objectId: string,
      handle: ObjectHitRegion,
      position: Point,
      shiftKeyParam = false,
      ctrlKeyParam = false,
    ) => {
      coordinator.objects.handleObjectMouseDown(
        objectId,
        handle,
        position,
        shiftKeyParam,
        ctrlKeyParam,
      );
    },
    [coordinator],
  );

  // CRITICAL: Mouse move and up must go through the coordinator, not directly to the actor!
  // The coordinator's handlers calculate incremental deltas, transform coordinates,
  // throttle Yjs updates, and call floatingObjectManager.moveObjectBy().
  // Sending directly to the actor only updates state machine context, not the actual object positions.
  const onMouseMove = useCallback(
    (position: Point, shiftKeyParam = false) => {
      coordinator.objects.handleObjectMouseMove(position, shiftKeyParam);
    },
    [coordinator],
  );

  const onMouseUp = useCallback(
    (position: Point) => {
      coordinator.objects.handleObjectMouseUp(position);
    },
    [coordinator],
  );

  const onKeyArrow = useCallback(
    (direction: 'up' | 'down' | 'left' | 'right', shiftKeyParam = false) => {
      commands.keyArrow(direction, shiftKeyParam);
    },
    [commands],
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITY
  // ═══════════════════════════════════════════════════════════════════════════

  const getCursor = useCallback(
    (hoveredHandle: ObjectHitRegion | null) => {
      return getCursorForCurrentState(isOperating, operation, hoveredHandle);
    },
    [isOperating, operation],
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // RETURN VALUE
  // ═══════════════════════════════════════════════════════════════════════════

  return useMemo(
    () => ({
      // State
      interactionState,
      selectedIds,
      editingObjectId,
      isDragging,
      isResizing,
      isRotating,
      isEditingText,
      activeHandle,
      dragStart,
      dragCurrent,
      shiftKey,
      hasSelection,
      hasMultipleSelected,
      isInserting,

      // Selection actions - using commands
      selectObject,
      selectMultiple: commands.selectMultiple,
      deselectAll: commands.deselectAll,

      // Mouse actions - some via coordinator, some via commands
      onMouseDownBody,
      onMouseDownHandle,
      onMouseMove,
      onMouseUp,

      // Text editing actions - using commands
      enterTextEditing: commands.doubleClick,
      enterTextEffectEditing: commands.doubleClickTextEffect,
      exitTextEffectEditing: commands.stopTextEffectEditing,
      commitText: commands.commitText,
      cancelText: commands.cancelText,

      // Keyboard actions - using commands
      onKeyDelete: commands.keyDelete,
      onKeyEscape: commands.keyEscape,
      onKeyArrow,
      onKeyDuplicate: commands.keyDuplicate,

      // Utility
      getCursor,
      reset: commands.reset,
    }),
    [
      interactionState,
      selectedIds,
      editingObjectId,
      isDragging,
      isResizing,
      isRotating,
      isEditingText,
      activeHandle,
      dragStart,
      dragCurrent,
      shiftKey,
      hasSelection,
      hasMultipleSelected,
      isInserting,
      selectObject,
      commands,
      onMouseDownBody,
      onMouseDownHandle,
      onMouseMove,
      onMouseUp,
      onKeyArrow,
      getCursor,
    ],
  );
}
