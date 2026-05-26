/**
 * Diagram Actor Access
 *
 * Selectors (the primitive) + Accessor interface (the contract for handlers).
 * Co-located to prevent drift.
 *
 * States:
 * - idle: No node selected
 * - nodeSelected: One or more nodes selected (shows selection handles)
 * - editing: In-place text editing for a node
 *
 * @see state-machines/src/diagram-machine.ts
 */

import type { NodeId } from '@mog/types-objects/diagrams/types';

// =============================================================================
// STATE TYPE (matches XState snapshot shape)
// =============================================================================

/**
 * Diagram UI states (derived from state machine).
 */
export type DiagramUIState = 'idle' | 'nodeSelected' | 'editing';

/**
 * Minimal state type for selectors - matches XState snapshot shape.
 */
export interface DiagramState {
  context: {
    /** ID of the Diagram object containing the selected nodes */
    selectedObjectId: string | null;
    /** IDs of currently selected nodes (supports multi-select) */
    selectedNodeIds: NodeId[];
    /** ID of the node currently being edited (in-place text edit) */
    editingNodeId: NodeId | null;
  };
  // Use `any` for state parameter to be compatible with XState's specific union type
  matches(state: any): boolean;
}

// =============================================================================
// SELECTORS - Moved to @mog-sdk/kernel/selectors
// Import from '@mog-sdk/kernel/selectors' instead.
// =============================================================================

// =============================================================================
// ACCESSOR INTERFACE (mirrors selectors 1:1 for handlers)
// =============================================================================

export interface DiagramAccessor {
  // Value accessors (match selectors)
  getSelectedObjectId(): string | null;
  getSelectedNodeIds(): NodeId[];
  getEditingNodeId(): NodeId | null;

  // Derived value accessors
  getSelectedNodeId(): NodeId | null;
  getSelectedCount(): number;
  hasSelection(): boolean;
  hasMultipleSelected(): boolean;

  // State matching accessors (match selectors)
  isIdle(): boolean;
  isNodeSelected(): boolean;
  isEditing(): boolean;

  // Compound state checks
  isInAnySelectedState(): boolean;

  // Derived state
  getUIState(): DiagramUIState;
}

// Re-export NodeId for convenience
export type { NodeId };
