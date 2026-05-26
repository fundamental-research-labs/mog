/**
 * Scenario Events
 *
 * Event types for What-If analysis.
 */

import type { BaseEvent, StructureChangeSource } from '@mog/types-commands/event-base';

export interface ScenarioCreatedEvent extends BaseEvent {
  type: 'scenario:created';
  scenarioId: string;
  name: string;
  source: StructureChangeSource;
}

export interface ScenarioDeletedEvent extends BaseEvent {
  type: 'scenario:deleted';
  scenarioId: string;
  source: StructureChangeSource;
}

export interface ScenarioAppliedEvent extends BaseEvent {
  type: 'scenario:applied';
  scenarioId: string;
  cellsUpdated: number;
  cellsSkipped: number;
  source: StructureChangeSource;
}

export interface ScenarioRestoredEvent extends BaseEvent {
  type: 'scenario:restored';
  cellsRestored: number;
  source: StructureChangeSource;
}

export interface ScenarioUpdatedEvent extends BaseEvent {
  type: 'scenario:updated';
  scenarioId: string;
  updatedFields: ('name' | 'comment' | 'changingCells' | 'values')[];
  source: StructureChangeSource;
}

export type ScenarioEvent =
  | ScenarioCreatedEvent
  | ScenarioDeletedEvent
  | ScenarioAppliedEvent
  | ScenarioRestoredEvent
  | ScenarioUpdatedEvent;
