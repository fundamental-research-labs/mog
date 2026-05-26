/**
 * Canvas Object Events
 *
 * Event types for the universal canvas object system (canvasObject:*).
 * These are emitted by the kernel's floating-objects module through ICanvasEventBus,
 * and are included in the SpreadsheetEvent union so the spreadsheet app can
 * subscribe to them via workbook.on().
 *
 * @see ../objects/canvas-object.ts - ICanvasEventBus interface
 */

import type { BaseEvent } from '@mog/types-commands/event-base';

export interface CanvasObjectCreatedEvent extends BaseEvent {
  type: 'canvasObject:created';
  containerId: string;
  objectId: string;
  source?: string;
}

export interface CanvasObjectUpdatedEvent extends BaseEvent {
  type: 'canvasObject:updated';
  containerId: string;
  objectId: string;
  source?: string;
}

export interface CanvasObjectDeletedEvent extends BaseEvent {
  type: 'canvasObject:deleted';
  containerId: string;
  objectId: string;
  source?: string;
}

export type CanvasObjectEventUnion =
  | CanvasObjectCreatedEvent
  | CanvasObjectUpdatedEvent
  | CanvasObjectDeletedEvent;
