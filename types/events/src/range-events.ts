/**
 * Range Events
 *
 * Event types for first-class range lifecycle operations.
 */

import type { BaseEvent, StructureChangeSource } from '@mog/types-commands/event-base';

export interface RangeCreatedEvent extends BaseEvent {
  type: 'range:created';
  sheetId: string;
  rangeId: string;
  source: StructureChangeSource;
}

export interface RangeRemovedEvent extends BaseEvent {
  type: 'range:removed';
  sheetId: string;
  rangeId: string;
  source: StructureChangeSource;
}

export interface RangeReplacedEvent extends BaseEvent {
  type: 'range:replaced';
  sheetId: string;
  rangeId: string;
  source: StructureChangeSource;
}

export interface RangeReformattedEvent extends BaseEvent {
  type: 'range:reformatted';
  sheetId: string;
  rangeId: string;
  source: StructureChangeSource;
}

export interface RangeBoundEvent extends BaseEvent {
  type: 'range:bound';
  sheetId: string;
  rangeId: string;
  source: StructureChangeSource;
}

export type RangeEvent =
  | RangeCreatedEvent
  | RangeRemovedEvent
  | RangeReplacedEvent
  | RangeReformattedEvent
  | RangeBoundEvent;
