/**
 * Ink Event Types
 *
 * Event definitions for the ink/drawing engine. These events enable
 * reactive coordination between components and support collaboration.
 *
 * Event Design Principles:
 * - All events extend BaseEvent for consistent structure
 * - Include 'source' field for tracking change origin
 * - Include relevant IDs for targeted handling
 * - Support batch operations where appropriate
 *
 * This file re-exports from domain-specific files and defines the InkEvent union.
 *
 * @see ink-stroke-events.ts for stroke lifecycle, selection, and tool events
 * @see ink-recognition-events.ts for shape/text recognition events
 * @see ink-collaboration-events.ts for real-time collaboration events
 */

// =============================================================================
// Re-exports from domain-specific files
// =============================================================================

// Stroke lifecycle, selection, tool, and undo/redo events
export type {
  DrawingCreatedEvent,
  DrawingDeletedEvent,
  DrawingRedoEvent,
  DrawingSelectionClearedEvent,
  DrawingStrokeAddedEvent,
  DrawingStrokeRemovedEvent,
  DrawingStrokesBatchAddedEvent,
  DrawingStrokesBatchRemovedEvent,
  DrawingStrokesSelectedEvent,
  DrawingStrokeUpdatedEvent,
  DrawingToolChangedEvent,
  DrawingUndoEvent,
  DrawingUpdatedEvent,
} from './ink-stroke-events';

// Recognition events
export type {
  DrawingRecognitionAcceptedEvent,
  DrawingRecognitionFailedEvent,
  DrawingRecognitionRemovedEvent,
  DrawingRecognitionStartedEvent,
  DrawingShapeRecognizedEvent,
  DrawingTextRecognizedEvent,
  InkShapeRecognizedEvent,
  InkTextRecognitionUnavailableEvent,
  InkTextRecognizedEvent,
} from './ink-recognition-events';

// Collaboration events
export type {
  DrawingRemoteStrokeEndedEvent,
  DrawingRemoteStrokeStartedEvent,
  DrawingRemoteStrokeUpdatedEvent,
} from './ink-collaboration-events';

// =============================================================================
// Import types for the union
// =============================================================================

import type {
  DrawingCreatedEvent,
  DrawingDeletedEvent,
  DrawingRedoEvent,
  DrawingSelectionClearedEvent,
  DrawingStrokeAddedEvent,
  DrawingStrokeRemovedEvent,
  DrawingStrokesBatchAddedEvent,
  DrawingStrokesBatchRemovedEvent,
  DrawingStrokesSelectedEvent,
  DrawingStrokeUpdatedEvent,
  DrawingToolChangedEvent,
  DrawingUndoEvent,
  DrawingUpdatedEvent,
} from './ink-stroke-events';

import type {
  DrawingRecognitionAcceptedEvent,
  DrawingRecognitionFailedEvent,
  DrawingRecognitionRemovedEvent,
  DrawingRecognitionStartedEvent,
  DrawingShapeRecognizedEvent,
  DrawingTextRecognizedEvent,
  InkShapeRecognizedEvent,
  InkTextRecognitionUnavailableEvent,
  InkTextRecognizedEvent,
} from './ink-recognition-events';

import type {
  DrawingRemoteStrokeEndedEvent,
  DrawingRemoteStrokeStartedEvent,
  DrawingRemoteStrokeUpdatedEvent,
} from './ink-collaboration-events';

// =============================================================================
// Union Type for All Ink Events
// =============================================================================

/**
 * Union of all ink-related events.
 */
export type InkEvent =
  // Lifecycle events
  | DrawingCreatedEvent
  | DrawingDeletedEvent
  | DrawingUpdatedEvent
  // Stroke events
  | DrawingStrokeAddedEvent
  | DrawingStrokeRemovedEvent
  | DrawingStrokeUpdatedEvent
  | DrawingStrokesBatchAddedEvent
  | DrawingStrokesBatchRemovedEvent
  // Selection events
  | DrawingStrokesSelectedEvent
  | DrawingSelectionClearedEvent
  // Tool events
  | DrawingToolChangedEvent
  // Recognition events
  | DrawingRecognitionStartedEvent
  | DrawingShapeRecognizedEvent
  | DrawingTextRecognizedEvent
  | DrawingRecognitionFailedEvent
  | DrawingRecognitionRemovedEvent
  | DrawingRecognitionAcceptedEvent
  // Wave 6: Recognition bridge events
  | InkShapeRecognizedEvent
  | InkTextRecognizedEvent
  | InkTextRecognitionUnavailableEvent
  // Undo/redo events
  | DrawingUndoEvent
  | DrawingRedoEvent
  // Collaboration events
  | DrawingRemoteStrokeStartedEvent
  | DrawingRemoteStrokeUpdatedEvent
  | DrawingRemoteStrokeEndedEvent;

/**
 * All ink event type strings.
 */
export type InkEventType = InkEvent['type'];
