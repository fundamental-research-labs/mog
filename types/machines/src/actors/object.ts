// TODO: Migrate ObjectState/ObjectAccessor to use containerId-aware canvas object types.

/**
 * Object Actor Access (Floating Objects - Images, Shapes, Text Boxes)
 *
 * Selectors (the primitive) + Accessor interface (the contract for handlers).
 * Co-located to prevent drift.
 *
 * States:
 * - idle: No object selected, clicks go to cells
 * - selected: Single object selected, showing handles
 * - multiSelected: Multiple objects selected
 * - operating: Unified operation state for drag/resize/rotate
 * - editingText: Editing text inside textbox/shape
 *
 * @see state-machines/src/object-interaction-machine.ts
 */

import type {
  ObjectHitRegion,
  ObjectInteractionState,
} from '@mog/types-objects/objects/floating-objects';
import type { FloatingObjectOperation } from './object-interaction';

// =============================================================================
// TYPES (from object-interaction-machine.ts)
// =============================================================================

/**
 * Point type for drag/resize operations.
 */
export interface Point {
  x: number;
  y: number;
}

// =============================================================================
// STATE TYPE (matches XState snapshot shape)
// =============================================================================

/**
 * Minimal state type for selectors - matches XState snapshot shape.
 */
export interface ObjectState {
  context: {
    /** Currently selected object IDs (empty if idle) */
    selectedIds: string[];
    /** Active resize/rotation handle (if applicable) */
    activeHandle: ObjectHitRegion | null;
    /** Object being edited (for text editing state) */
    editingObjectId: string | null;
    /** Whether shift key was held (for constrained resize) */
    shiftKey: boolean;
    /**
     * Current unified operation (null when not operating).
     * Contains all information for drag/resize/rotate operations.
     * @see FloatingObjectOperation
     */
    operation?: FloatingObjectOperation | null;
  };
  // Use `any` for state parameter to be compatible with XState's specific union type
  matches(state: any): boolean;
  value: string;
}

// =============================================================================
// SELECTORS - Moved to @mog-sdk/kernel/selectors
// Import from '@mog-sdk/kernel/selectors' instead.
// =============================================================================

// =============================================================================
// ACCESSOR INTERFACE (mirrors selectors 1:1 for handlers)
// =============================================================================

export interface ObjectAccessor {
  // Value accessors (match selectors)
  getSelectedIds(): string[];
  getActiveHandle(): ObjectHitRegion | null;
  getEditingObjectId(): string | null;
  getShiftKey(): boolean;

  // Derived value accessors
  hasSelection(): boolean;
  hasMultipleSelected(): boolean;
  getSelectedCount(): number;
  getFirstSelectedId(): string | null;
  isResizeHandle(): boolean;
  isRotationHandle(): boolean;

  // State matching accessors (match selectors)
  isIdle(): boolean;
  isSelected(): boolean;
  isMultiSelected(): boolean;
  isEditingText(): boolean;

  // Compound state checks
  isInAnySelectedState(): boolean;
  isInteracting(): boolean;
  getInteractionState(): ObjectInteractionState;

  // ===========================================================================
  // Unified Operation Accessors
  // ===========================================================================

  /**
   * Get the current unified operation (null when not operating).
   * @see FloatingObjectOperation
   */
  getOperation(): FloatingObjectOperation | null;

  /**
   * Check if currently in the unified operating state.
   */
  isOperating(): boolean;

  /**
   * Get the type of the current operation ('drag' | 'resize' | 'rotate' | null).
   * Returns null if not in an operation.
   */
  getOperationType(): 'drag' | 'resize' | 'rotate' | null;

  /**
   * Get the object IDs involved in the current operation.
   * Returns empty array if not operating.
   */
  getOperationObjectIds(): string[];

  /**
   * Check if currently interacting via the unified operation model.
   * This checks for the 'operating' state.
   */
  isInteractingUnified(): boolean;

  // ===========================================================================
  // Insert Mode Accessors
  // ===========================================================================

  /**
   * Check if currently in insert mode (drag-to-insert a new shape).
   */
  isInserting(): boolean;

  /**
   * Get the shape type being inserted (null when not in insert mode).
   */
  getInsertShapeType(): string | null;

  /**
   * Get the start position for drag-to-insert.
   */
  getInsertStartPosition(): { x: number; y: number } | null;

  /**
   * Get the current position during drag-to-insert.
   */
  getInsertCurrentPosition(): { x: number; y: number } | null;

  // ===========================================================================
  // TextEffect-specific Accessors
  // ===========================================================================

  /**
   * Check if currently editing TextEffect text.
   */
  isTextEffectEditing(): boolean;

  /**
   * Check if currently adjusting TextEffect warp.
   */
  isAdjustingWarp(): boolean;
}

// Re-export types for convenience
export type { ObjectHitRegion, ObjectInteractionState };

// Re-export operation types for consumers
export type { FloatingObjectOperation } from './object-interaction';
