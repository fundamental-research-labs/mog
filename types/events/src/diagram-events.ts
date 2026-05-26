/**
 * Diagram Event Types
 *
 * Event definitions for Diagram diagrams. These events enable reactive
 * coordination between components and support collaboration.
 *
 * Event Design Principles:
 * - All events extend BaseEvent for consistent structure
 * - Include 'source' field for tracking change origin
 * - Include relevant IDs for targeted handling
 * - Support batch operations for undo/redo grouping
 *
 * @see contracts/src/events.ts for main event bus integration
 * @see contracts/src/diagram/types.ts for type definitions
 */

import type { BaseEvent, StructureChangeSource } from '@mog/types-commands/event-base';
import type { NodeId, DiagramNode } from '@mog/types-objects/diagrams/types';

// =============================================================================
// Lifecycle Events
// =============================================================================

/**
 * Emitted when a Diagram diagram is created.
 */
export interface DiagramCreatedEvent extends BaseEvent {
  type: 'diagram:created';
  /** ID of the created Diagram floating object */
  objectId: string;
  /** Sheet containing the Diagram */
  sheetId: string;
  /** Layout ID used for the diagram */
  layoutId: string;
  /** Source of the creation */
  source: StructureChangeSource;
}

/**
 * Emitted when a Diagram diagram is deleted.
 */
export interface DiagramDeletedEvent extends BaseEvent {
  type: 'diagram:deleted';
  /** ID of the deleted Diagram floating object */
  objectId: string;
  /** Sheet that contained the Diagram */
  sheetId: string;
  /** Source of the deletion */
  source: StructureChangeSource;
}

// =============================================================================
// Node Events
// =============================================================================

/**
 * Emitted when a node is added to a Diagram diagram.
 */
export interface DiagramNodeAddedEvent extends BaseEvent {
  type: 'diagram:node-added';
  /** ID of the Diagram floating object */
  objectId: string;
  /** ID of the newly added node */
  nodeId: NodeId;
  /** Parent node ID (null for root-level nodes) */
  parentId: NodeId | null;
  /** Position relative to reference node */
  position: 'before' | 'after' | 'above' | 'below' | 'child';
  /** Source of the addition */
  source: StructureChangeSource;
}

/**
 * Emitted when a node is removed from a Diagram diagram.
 */
export interface DiagramNodeRemovedEvent extends BaseEvent {
  type: 'diagram:node-removed';
  /** ID of the Diagram floating object */
  objectId: string;
  /** ID of the removed node */
  nodeId: NodeId;
  /** Source of the removal */
  source: StructureChangeSource;
}

/**
 * Emitted when a node's properties are updated.
 */
export interface DiagramNodeUpdatedEvent extends BaseEvent {
  type: 'diagram:node-updated';
  /** ID of the Diagram floating object */
  objectId: string;
  /** ID of the updated node */
  nodeId: NodeId;
  /** Properties that changed */
  changes: Partial<{ text: string; fillColor: string; imageUrl: string }>;
  /** Source of the update */
  source: StructureChangeSource;
}

/**
 * Emitted when a node is moved (promoted, demoted, reordered).
 */
export interface DiagramNodeMovedEvent extends BaseEvent {
  type: 'diagram:node-moved';
  /** ID of the Diagram floating object */
  objectId: string;
  /** ID of the moved node */
  nodeId: NodeId;
  /** Direction of the move */
  direction: 'promote' | 'demote' | 'move-up' | 'move-down';
  /** Source of the move */
  source: StructureChangeSource;
}

/**
 * Emitted when multiple nodes are added in a batch.
 * Used for paste operations or initial diagram creation.
 *
 * Transaction Grouping: Use the same transactionId for proper undo/redo grouping.
 */
export interface DiagramNodesBatchAddedEvent extends BaseEvent {
  type: 'diagram:nodes-batch-added';
  /** ID of the Diagram floating object */
  objectId: string;
  /** The added nodes */
  nodes: DiagramNode[];
  /** Source of the batch addition */
  source: StructureChangeSource;
}

/**
 * Emitted when multiple nodes are removed in a batch.
 * Used for delete operations or clear actions.
 *
 * Transaction Grouping: Use the same transactionId for proper undo/redo grouping.
 */
export interface DiagramNodesBatchRemovedEvent extends BaseEvent {
  type: 'diagram:nodes-batch-removed';
  /** ID of the Diagram floating object */
  objectId: string;
  /** IDs of the removed nodes */
  nodeIds: NodeId[];
  /** Source of the batch removal */
  source: StructureChangeSource;
}

// =============================================================================
// Layout and Style Events
// =============================================================================

/**
 * Emitted when the diagram layout is changed.
 */
export interface DiagramLayoutChangedEvent extends BaseEvent {
  type: 'diagram:layout-changed';
  /** ID of the Diagram floating object */
  objectId: string;
  /** Previous layout ID */
  previousLayoutId: string;
  /** New layout ID */
  newLayoutId: string;
  /** Source of the change */
  source: StructureChangeSource;
}

/**
 * Emitted when the diagram style (quick style or color theme) is changed.
 */
export interface DiagramStyleChangedEvent extends BaseEvent {
  type: 'diagram:style-changed';
  /** ID of the Diagram floating object */
  objectId: string;
  /** Type of style change */
  changeType: 'quick-style' | 'color-theme';
  /** Previous style value */
  previousValue: string;
  /** New style value */
  newValue: string;
  /** Source of the change */
  source: StructureChangeSource;
}

// =============================================================================
// Selection and Interaction Events
// =============================================================================

/**
 * Emitted when node selection changes within a Diagram diagram.
 */
export interface DiagramSelectionChangedEvent extends BaseEvent {
  type: 'diagram:selection-changed';
  /** ID of the Diagram floating object */
  objectId: string;
  /** Currently selected node IDs */
  selectedNodeIds: NodeId[];
  /** Previously selected node IDs */
  previousSelectedNodeIds: NodeId[];
  /** User ID who made the selection (for collaboration) */
  userId?: string;
}

/**
 * Emitted when entering or exiting text edit mode for a node.
 */
export interface DiagramEditModeChangedEvent extends BaseEvent {
  type: 'diagram:edit-mode-changed';
  /** ID of the Diagram floating object */
  objectId: string;
  /** ID of the node currently being edited (null if exiting edit mode) */
  editingNodeId: NodeId | null;
  /** ID of the node previously being edited (null if entering edit mode) */
  previousEditingNodeId: NodeId | null;
  /** User ID who changed edit mode (for collaboration) */
  userId?: string;
}

/**
 * Emitted when a user clicks on a Diagram diagram or node.
 * Used for canvas interaction and node selection.
 */
export interface DiagramClickEvent extends BaseEvent {
  type: 'diagram:click';
  /** ID of the Diagram floating object */
  objectId: string;
  /** ID of the clicked node (null if clicking diagram background) */
  nodeId: NodeId | null;
  /** Click position within the Diagram object (in pixels) */
  clickPosition: { x: number; y: number };
  /** Keyboard modifiers held during click */
  modifiers: {
    shift: boolean;
    ctrl: boolean;
    meta: boolean;
  };
}

// =============================================================================
// Union Type
// =============================================================================

/**
 * Union of all Diagram-related events.
 */
export type DiagramEvent =
  // Lifecycle events
  | DiagramCreatedEvent
  | DiagramDeletedEvent
  // Node events
  | DiagramNodeAddedEvent
  | DiagramNodeRemovedEvent
  | DiagramNodeUpdatedEvent
  | DiagramNodeMovedEvent
  | DiagramNodesBatchAddedEvent
  | DiagramNodesBatchRemovedEvent
  // Layout and style events
  | DiagramLayoutChangedEvent
  | DiagramStyleChangedEvent
  // Selection and interaction events
  | DiagramSelectionChangedEvent
  | DiagramEditModeChangedEvent
  | DiagramClickEvent;

/**
 * All Diagram event type strings.
 */
export type DiagramEventType = DiagramEvent['type'];
