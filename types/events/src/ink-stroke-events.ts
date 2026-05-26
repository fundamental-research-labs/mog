/**
 * Ink Stroke Event Types
 *
 * Event definitions for ink stroke lifecycle, selection, and tool changes.
 * These events enable reactive coordination between drawing components.
 *
 * @see ink-events.ts for main InkEvent union type
 * @see ink-recognition-events.ts for recognition events
 * @see ink-collaboration-events.ts for collaboration events
 */

import type { BaseEvent, StructureChangeSource } from '@mog/types-commands/event-base';
import type {
  DrawingObject,
  InkStroke,
  InkToolState,
  StrokeId,
} from '@mog/types-objects/ink/types';

// =============================================================================
// Drawing Object Lifecycle Events
// =============================================================================

/**
 * Emitted when a new drawing object is created.
 */
export interface DrawingCreatedEvent extends BaseEvent {
  type: 'drawing:created';
  sheetId: string;
  /** ID of the created drawing */
  drawingId: string;
  /** The created drawing object */
  drawing: DrawingObject;
  /** Source of the creation */
  source: StructureChangeSource;
}

/**
 * Emitted when a drawing object is deleted.
 */
export interface DrawingDeletedEvent extends BaseEvent {
  type: 'drawing:deleted';
  sheetId: string;
  /** ID of the deleted drawing */
  drawingId: string;
  /** Source of the deletion */
  source: StructureChangeSource;
}

/**
 * Emitted when a drawing object's properties are updated
 * (not including stroke changes, which have their own events).
 */
export interface DrawingUpdatedEvent extends BaseEvent {
  type: 'drawing:updated';
  sheetId: string;
  /** ID of the updated drawing */
  drawingId: string;
  /** Fields that were updated */
  updatedFields: string[];
  /** Source of the update */
  source: StructureChangeSource;
}

// =============================================================================
// Stroke Events
// =============================================================================

/**
 * Emitted when a stroke is added to a drawing.
 */
export interface DrawingStrokeAddedEvent extends BaseEvent {
  type: 'drawing:strokeAdded';
  sheetId: string;
  /** ID of the drawing containing the stroke */
  drawingId: string;
  /** The added stroke */
  stroke: InkStroke;
  /** Source of the addition */
  source: StructureChangeSource;
}

/**
 * Emitted when a stroke is removed from a drawing.
 */
export interface DrawingStrokeRemovedEvent extends BaseEvent {
  type: 'drawing:strokeRemoved';
  sheetId: string;
  /** ID of the drawing containing the stroke */
  drawingId: string;
  /** ID of the removed stroke */
  strokeId: StrokeId;
  /** Source of the removal */
  source: StructureChangeSource;
}

/**
 * Emitted when a stroke's properties are updated.
 */
export interface DrawingStrokeUpdatedEvent extends BaseEvent {
  type: 'drawing:strokeUpdated';
  sheetId: string;
  /** ID of the drawing containing the stroke */
  drawingId: string;
  /** ID of the updated stroke */
  strokeId: StrokeId;
  /** The updated fields (partial stroke) */
  updates: Partial<InkStroke>;
  /** Source of the update */
  source: StructureChangeSource;
}

/**
 * Emitted when multiple strokes are added in a batch.
 * Used for paste operations or bulk imports.
 */
export interface DrawingStrokesBatchAddedEvent extends BaseEvent {
  type: 'drawing:strokesBatchAdded';
  sheetId: string;
  /** ID of the drawing */
  drawingId: string;
  /** The added strokes */
  strokes: InkStroke[];
  /** Source of the batch addition */
  source: StructureChangeSource;
}

/**
 * Emitted when multiple strokes are removed in a batch.
 * Used for delete operations or clear actions.
 */
export interface DrawingStrokesBatchRemovedEvent extends BaseEvent {
  type: 'drawing:strokesBatchRemoved';
  sheetId: string;
  /** ID of the drawing */
  drawingId: string;
  /** IDs of the removed strokes */
  strokeIds: StrokeId[];
  /** Source of the batch removal */
  source: StructureChangeSource;
}

// =============================================================================
// Selection Events
// =============================================================================

/**
 * Emitted when strokes are selected (via lasso, rectangle select, etc.).
 */
export interface DrawingStrokesSelectedEvent extends BaseEvent {
  type: 'drawing:strokesSelected';
  sheetId: string;
  /** ID of the drawing */
  drawingId: string;
  /** IDs of the selected strokes */
  selectedStrokeIds: StrokeId[];
  /** Selection mode used */
  selectionMode: 'lasso' | 'rectangle';
  /** User ID who made the selection (for collaboration) */
  userId?: string;
}

/**
 * Emitted when stroke selection is cleared.
 */
export interface DrawingSelectionClearedEvent extends BaseEvent {
  type: 'drawing:selectionCleared';
  sheetId: string;
  /** ID of the drawing */
  drawingId: string;
  /** IDs of strokes that were deselected */
  previouslySelectedIds: StrokeId[];
  /** User ID who cleared selection */
  userId?: string;
}

// =============================================================================
// Tool Events
// =============================================================================

/**
 * Emitted when the active tool changes.
 */
export interface DrawingToolChangedEvent extends BaseEvent {
  type: 'drawing:toolChanged';
  sheetId: string;
  /** ID of the drawing */
  drawingId: string;
  /** New tool state */
  toolState: InkToolState;
  /** Source of the tool change */
  source: StructureChangeSource;
}

// =============================================================================
// Undo/Redo Events
// =============================================================================

/**
 * Emitted when a drawing operation is undone.
 */
export interface DrawingUndoEvent extends BaseEvent {
  type: 'drawing:undo';
  sheetId: string;
  /** ID of the drawing */
  drawingId: string;
  /** Type of operation that was undone */
  operationType: 'stroke' | 'recognition' | 'style' | 'delete';
  /** Details about what was undone */
  details?: {
    strokeIds?: StrokeId[];
    recognitionId?: string;
  };
  /** Source of the undo */
  source: StructureChangeSource;
}

/**
 * Emitted when a drawing operation is redone.
 */
export interface DrawingRedoEvent extends BaseEvent {
  type: 'drawing:redo';
  sheetId: string;
  /** ID of the drawing */
  drawingId: string;
  /** Type of operation that was redone */
  operationType: 'stroke' | 'recognition' | 'style' | 'delete';
  /** Details about what was redone */
  details?: {
    strokeIds?: StrokeId[];
    recognitionId?: string;
  };
  /** Source of the redo */
  source: StructureChangeSource;
}
