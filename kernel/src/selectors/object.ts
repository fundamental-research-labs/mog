/**
 * Object Actor Selectors
 *
 * Pure functions that extract data from object interaction state.
 * Moved from contracts to kernel (contracts holds types only).
 *
 * @module @mog-sdk/kernel/selectors
 */

import type { ObjectState } from '@mog-sdk/contracts/actors/object';
import type { ObjectInteractionState } from '@mog-sdk/contracts/actors/object';

export { type ObjectState } from '@mog-sdk/contracts/actors/object';

export const objectSelectors = {
  // Value selectors
  selectedIds: (state: ObjectState) => state.context.selectedIds,
  activeHandle: (state: ObjectState) => state.context.activeHandle,
  editingObjectId: (state: ObjectState) => state.context.editingObjectId,
  shiftKey: (state: ObjectState): boolean => state.context.shiftKey,

  // Derived value selectors
  hasSelection: (state: ObjectState): boolean => state.context.selectedIds.length > 0,
  hasMultipleSelected: (state: ObjectState): boolean => state.context.selectedIds.length > 1,
  selectedCount: (state: ObjectState): number => state.context.selectedIds.length,
  firstSelectedId: (state: ObjectState): string | null =>
    state.context.selectedIds.length > 0 ? state.context.selectedIds[0] : null,
  isResizeHandle: (state: ObjectState): boolean => {
    const handle = state.context.activeHandle;
    return handle !== null && handle.startsWith('resize-');
  },
  isRotationHandle: (state: ObjectState): boolean => state.context.activeHandle === 'rotation',

  // State matching selectors
  isIdle: (state: ObjectState): boolean => state.matches('idle'),
  isSelected: (state: ObjectState): boolean => state.matches('selected'),
  isMultiSelected: (state: ObjectState): boolean => state.matches('multiSelected'),
  isEditingText: (state: ObjectState): boolean => state.matches('editingText'),

  // Compound state checks
  isInAnySelectedState: (state: ObjectState): boolean =>
    state.matches('selected') ||
    state.matches('multiSelected') ||
    state.matches('operating') ||
    state.matches('editingText'),

  isInteracting: (state: ObjectState): boolean => state.matches('operating'),

  // ===========================================================================
  // Unified Operation Selectors
  // ===========================================================================

  operation: (state: ObjectState) => state.context.operation ?? null,

  isOperating: (state: ObjectState): boolean => state.matches('operating'),

  operationType: (state: ObjectState): 'drag' | 'resize' | 'rotate' | null =>
    state.context.operation?.type ?? null,

  operationObjectIds: (state: ObjectState): string[] => state.context.operation?.objectIds ?? [],

  isInteractingUnified: (state: ObjectState): boolean => state.matches('operating'),

  interactionState: (state: ObjectState): ObjectInteractionState => {
    const stateValue = state.value as string;
    switch (stateValue) {
      case 'idle':
        return 'idle';
      case 'selected':
        return 'selected';
      case 'multiSelected':
        return 'multiSelected';
      case 'operating':
        return 'operating';
      case 'editingText':
        return 'editingText';
      case 'inserting':
        return 'inserting';
      case 'textEffectsEditing':
        return 'textEffectsEditing';
      case 'adjustingWarp':
        return 'adjustingWarp';
      default:
        return 'idle';
    }
  },

  // Insert mode selectors
  isInserting: (state: ObjectState): boolean => state.matches('inserting'),
  insertShapeType: (state: ObjectState): string | null =>
    (state.context as any).insertShapeType ?? null,
  insertStartPosition: (state: ObjectState): { x: number; y: number } | null =>
    (state.context as any).insertStartPosition ?? null,
  insertCurrentPosition: (state: ObjectState): { x: number; y: number } | null =>
    (state.context as any).insertCurrentPosition ?? null,

  // TextEffect-specific selectors
  isTextEffectEditing: (state: ObjectState): boolean => state.matches('textEffectsEditing'),
  isAdjustingWarp: (state: ObjectState): boolean => state.matches('adjustingWarp'),
};
