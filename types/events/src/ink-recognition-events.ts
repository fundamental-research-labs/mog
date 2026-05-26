/**
 * Ink Recognition Event Types
 *
 * Event definitions for ink recognition (shapes, text, handwriting).
 * These events support the shape/text recognition pipeline and user acceptance flow.
 *
 * @see ink-events.ts for main InkEvent union type
 * @see ink-stroke-events.ts for stroke lifecycle events
 * @see ink-collaboration-events.ts for collaboration events
 */

import type { BaseEvent, StructureChangeSource } from '@mog/types-commands/event-base';
import type {
  RecognitionResult,
  RecognizedShape,
  RecognizedText,
  ShapeParams,
  StrokeId,
} from '@mog/types-objects/ink/types';

// =============================================================================
// Recognition Events
// =============================================================================

/**
 * Emitted when shape recognition starts.
 * Allows UI to show recognition indicator.
 */
export interface DrawingRecognitionStartedEvent extends BaseEvent {
  type: 'drawing:recognitionStarted';
  sheetId: string;
  /** ID of the drawing */
  drawingId: string;
  /** IDs of strokes being recognized */
  strokeIds: StrokeId[];
}

/**
 * Emitted when a shape is recognized from strokes.
 */
export interface DrawingShapeRecognizedEvent extends BaseEvent {
  type: 'drawing:shapeRecognized';
  sheetId: string;
  /** ID of the drawing */
  drawingId: string;
  /** Unique ID for this recognition */
  recognitionId: string;
  /** The recognized shape */
  shape: RecognizedShape;
  /** Source of the recognition */
  source: StructureChangeSource;
}

/**
 * Emitted when text is recognized from handwriting.
 */
export interface DrawingTextRecognizedEvent extends BaseEvent {
  type: 'drawing:textRecognized';
  sheetId: string;
  /** ID of the drawing */
  drawingId: string;
  /** Unique ID for this recognition */
  recognitionId: string;
  /** The recognized text */
  text: RecognizedText;
  /** Source of the recognition */
  source: StructureChangeSource;
}

/**
 * Emitted when recognition fails.
 */
export interface DrawingRecognitionFailedEvent extends BaseEvent {
  type: 'drawing:recognitionFailed';
  sheetId: string;
  /** ID of the drawing */
  drawingId: string;
  /** IDs of strokes that failed recognition */
  strokeIds: StrokeId[];
  /** Reason for failure */
  reason: 'no_match' | 'low_confidence' | 'timeout' | 'error';
  /** Error message if applicable */
  errorMessage?: string;
}

/**
 * Emitted when a recognition is removed (user rejected or undone).
 */
export interface DrawingRecognitionRemovedEvent extends BaseEvent {
  type: 'drawing:recognitionRemoved';
  sheetId: string;
  /** ID of the drawing */
  drawingId: string;
  /** ID of the removed recognition */
  recognitionId: string;
  /** Source of the removal */
  source: StructureChangeSource;
}

/**
 * Emitted when user accepts a recognition
 * (converts strokes to shape/text permanently).
 */
export interface DrawingRecognitionAcceptedEvent extends BaseEvent {
  type: 'drawing:recognitionAccepted';
  sheetId: string;
  /** ID of the drawing */
  drawingId: string;
  /** ID of the accepted recognition */
  recognitionId: string;
  /** The accepted recognition result */
  result: RecognitionResult;
  /** IDs of source strokes that will be removed */
  sourceStrokeIds: StrokeId[];
  /** Source of the acceptance */
  source: StructureChangeSource;
}

// =============================================================================
// Wave 6: Ink Recognition Bridge Events
// =============================================================================

/**
 * Emitted when ink strokes are successfully recognized as a shape.
 * Used by action handlers to communicate with coordinators.
 */
export interface InkShapeRecognizedEvent extends BaseEvent {
  type: 'INK_SHAPE_RECOGNIZED';
  /** ID of the drawing containing the strokes */
  drawingId: string;
  /** Type of recognized shape */
  shapeType: string;
  /** Recognition confidence [0, 1] */
  confidence: number;
  /** Bounding box of the recognized shape */
  bounds: { x: number; y: number; width: number; height: number };
  /** Shape-specific parameters */
  params: ShapeParams;
}

/**
 * Emitted when ink strokes are successfully recognized as text.
 * Used by action handlers to communicate with coordinators.
 */
export interface InkTextRecognizedEvent extends BaseEvent {
  type: 'INK_TEXT_RECOGNIZED';
  /** ID of the drawing containing the strokes */
  drawingId: string;
  /** Recognized text string */
  text: string;
  /** Recognition confidence [0, 1] */
  confidence: number;
  /** Bounding box of the text (null if not available) */
  bounds: { x: number; y: number; width: number; height: number } | null;
}

/**
 * Emitted when text recognition is attempted but the browser API is unavailable.
 */
export interface InkTextRecognitionUnavailableEvent extends BaseEvent {
  type: 'INK_TEXT_RECOGNITION_UNAVAILABLE';
}
