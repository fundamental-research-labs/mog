/**
 * Slicer Events
 *
 * Event types for slicer operations.
 */

import type { BaseEvent, StructureChangeSource } from '@mog/types-commands/event-base';
import type { CellValue } from '@mog/types-core';

export interface SlicerCreatedEvent extends BaseEvent {
  type: 'slicer:created';
  sheetId: string;
  slicerId: string;
  sourceType: 'table' | 'pivot';
  sourceId: string;
  source: StructureChangeSource;
}

export interface SlicerUpdatedEvent extends BaseEvent {
  type: 'slicer:updated';
  sheetId: string;
  slicerId: string;
  updatedFields: string[];
  source: StructureChangeSource;
}

export interface SlicerDeletedEvent extends BaseEvent {
  type: 'slicer:deleted';
  sheetId: string;
  slicerId: string;
  source: StructureChangeSource;
}

export interface SlicerSelectionChangedEvent extends BaseEvent {
  type: 'slicer:selectionChanged';
  sheetId: string;
  slicerId: string;
  selectedValues: CellValue[];
  changeType: 'select' | 'toggle' | 'clear' | 'sync';
}

export interface SlicerCacheInvalidatedEvent extends BaseEvent {
  type: 'slicer:cacheInvalidated';
  slicerId: string;
  reason: 'cellsChanged' | 'filterApplied' | 'tableStructureChanged' | 'pivotUpdated';
}

export interface SlicerDisconnectedEvent extends BaseEvent {
  type: 'slicer:disconnected';
  sheetId: string;
  slicerId: string;
  reason: 'columnDeleted' | 'tableDeleted' | 'pivotDeleted';
}

export type SlicerEvent =
  | SlicerCreatedEvent
  | SlicerUpdatedEvent
  | SlicerDeletedEvent
  | SlicerSelectionChangedEvent
  | SlicerCacheInvalidatedEvent
  | SlicerDisconnectedEvent;
