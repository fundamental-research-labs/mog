/**
 * Named Range Events
 *
 * Event types for defined names.
 */

import type { BaseEvent, StructureChangeSource } from '@mog/types-commands/event-base';
import type { DefinedName } from '@mog/types-data/data/named-ranges';

export interface NamedRangeEventNamePayload {
  name: string;
}

export interface NameCreatedEvent extends BaseEvent {
  type: 'name:created';
  name: DefinedName | NamedRangeEventNamePayload;
  source: StructureChangeSource;
}

export interface NameUpdatedEvent extends BaseEvent {
  type: 'name:updated';
  oldName?: DefinedName | NamedRangeEventNamePayload;
  newName: DefinedName | NamedRangeEventNamePayload;
  source: StructureChangeSource;
}

export interface NameDeletedEvent extends BaseEvent {
  type: 'name:deleted';
  name: DefinedName | NamedRangeEventNamePayload;
  source: StructureChangeSource;
}

export type NamedRangeEvent = NameCreatedEvent | NameUpdatedEvent | NameDeletedEvent;
