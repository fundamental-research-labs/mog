/**
 * Object Actor Access Implementation
 *
 * Implements ObjectAccessor using selectors.
 * THIS IS THE ONLY PLACE that calls actor.getSnapshot() for handlers.
 *
 * @module engine/state/coordinator/actor-access/object
 */

import { objectSelectors } from '../../../selectors';
import type { ObjectAccessor, ObjectState } from '@mog-sdk/contracts/actors';

/**
 * Minimal actor interface for object accessor.
 * Uses getSnapshot() to capture point-in-time state.
 */
type ObjectActor = { getSnapshot(): ObjectState };

/**
 * Creates an ObjectAccessor for point-in-time reads in handlers.
 *
 * Each method delegates to the corresponding selector with a fresh snapshot.
 * This ensures handlers always get current state at the moment of call.
 *
 * @param actor - The XState object interaction actor
 * @returns ObjectAccessor interface for handlers
 */
export function createObjectAccessor(actor: ObjectActor): ObjectAccessor {
  const snap = () => actor.getSnapshot();

  return {
    // ===========================================================================
    // Value Accessors (match value selectors)
    // ===========================================================================

    getSelectedIds: () => objectSelectors.selectedIds(snap()),
    getActiveHandle: () => objectSelectors.activeHandle(snap()),
    getEditingObjectId: () => objectSelectors.editingObjectId(snap()),
    getShiftKey: () => objectSelectors.shiftKey(snap()),

    // ===========================================================================
    // Derived Value Accessors
    // ===========================================================================

    hasSelection: () => objectSelectors.hasSelection(snap()),
    hasMultipleSelected: () => objectSelectors.hasMultipleSelected(snap()),
    getSelectedCount: () => objectSelectors.selectedCount(snap()),
    getFirstSelectedId: () => objectSelectors.firstSelectedId(snap()),
    isResizeHandle: () => objectSelectors.isResizeHandle(snap()),
    isRotationHandle: () => objectSelectors.isRotationHandle(snap()),

    // ===========================================================================
    // State Matching Accessors (match state selectors)
    // ===========================================================================

    isIdle: () => objectSelectors.isIdle(snap()),
    isSelected: () => objectSelectors.isSelected(snap()),
    isMultiSelected: () => objectSelectors.isMultiSelected(snap()),
    isEditingText: () => objectSelectors.isEditingText(snap()),

    // ===========================================================================
    // Compound State Checks
    // ===========================================================================

    isInAnySelectedState: () => objectSelectors.isInAnySelectedState(snap()),
    isInteracting: () => objectSelectors.isInteracting(snap()),
    getInteractionState: () => objectSelectors.interactionState(snap()),

    // ===========================================================================
    // Unified Operation Accessors
    // ===========================================================================

    getOperation: () => objectSelectors.operation(snap()),
    isOperating: () => objectSelectors.isOperating(snap()),
    getOperationType: () => objectSelectors.operationType(snap()),
    getOperationObjectIds: () => objectSelectors.operationObjectIds(snap()),
    isInteractingUnified: () => objectSelectors.isInteractingUnified(snap()),

    // ===========================================================================
    // Insert Mode Accessors
    // ===========================================================================

    isInserting: () => objectSelectors.isInserting(snap()),
    getInsertShapeType: () => objectSelectors.insertShapeType(snap()),
    getInsertStartPosition: () => objectSelectors.insertStartPosition(snap()),
    getInsertCurrentPosition: () => objectSelectors.insertCurrentPosition(snap()),

    // ===========================================================================
    // TextEffect-specific Accessors
    // ===========================================================================

    isTextEffectEditing: () => objectSelectors.isTextEffectEditing(snap()),
    isAdjustingWarp: () => objectSelectors.isAdjustingWarp(snap()),
  };
}
