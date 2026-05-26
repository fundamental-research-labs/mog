/**
 * Ink Collaboration Event Types
 *
 * Event definitions for real-time collaborative drawing.
 * These events enable live cursor/stroke preview in multi-user sessions.
 *
 * @see ink-events.ts for main InkEvent union type
 * @see ink-stroke-events.ts for stroke lifecycle events
 * @see ink-recognition-events.ts for recognition events
 */

import type { BaseEvent } from '@mog/types-commands/event-base';
import type { InkStroke, StrokeId } from '@mog/types-objects/ink/types';

// =============================================================================
// Collaboration Events
// =============================================================================

/**
 * Emitted when another user starts drawing in real-time.
 * Used for live cursor/stroke preview in collaboration mode.
 */
export interface DrawingRemoteStrokeStartedEvent extends BaseEvent {
  type: 'drawing:remoteStrokeStarted';
  sheetId: string;
  /** ID of the drawing */
  drawingId: string;
  /** User ID of the remote user */
  userId: string;
  /** User's display name */
  userName?: string;
  /** User's color for collaborative cursors */
  userColor?: string;
  /** Initial stroke state (partial, in progress) */
  strokePreview: Partial<InkStroke>;
}

/**
 * Emitted when another user's stroke is updated in real-time.
 */
export interface DrawingRemoteStrokeUpdatedEvent extends BaseEvent {
  type: 'drawing:remoteStrokeUpdated';
  sheetId: string;
  /** ID of the drawing */
  drawingId: string;
  /** User ID of the remote user */
  userId: string;
  /** Updated stroke preview */
  strokePreview: Partial<InkStroke>;
}

/**
 * Emitted when another user finishes their stroke.
 */
export interface DrawingRemoteStrokeEndedEvent extends BaseEvent {
  type: 'drawing:remoteStrokeEnded';
  sheetId: string;
  /** ID of the drawing */
  drawingId: string;
  /** User ID of the remote user */
  userId: string;
  /** The completed stroke ID */
  strokeId: StrokeId;
}
