/**
 * Filter Events
 *
 * Event types for AutoFilter operations.
 */

import type { CellRange } from '@mog/types-core';
import type { BaseEvent, StructureChangeSource } from '@mog/types-commands/event-base';

export type FilterKind = 'autoFilter' | 'tableFilter' | 'advancedFilter';

export interface FilterCreatedEvent extends BaseEvent {
  type: 'filter:created';
  sheetId: string;
  filterId: string;
  filterKind?: FilterKind;
  range?: CellRange;
  filterType?: string;
  source: StructureChangeSource;
}

export interface FilterUpdatedEvent extends BaseEvent {
  type: 'filter:updated';
  sheetId: string;
  filterId: string;
  filterKind?: FilterKind;
  headerCellId?: string;
  hiddenRowCount?: number;
  visibleRowCount?: number;
  source: StructureChangeSource;
}

export interface FilterAppliedEvent extends BaseEvent {
  type: 'filter:applied';
  sheetId: string;
  filterId: string;
  filterKind?: FilterKind;
  hiddenRowCount?: number;
  visibleRowCount?: number;
  source?: StructureChangeSource;
}

export interface FilterDeletedEvent extends BaseEvent {
  type: 'filter:deleted';
  sheetId: string;
  filterId: string;
  filterKind?: FilterKind;
  source: StructureChangeSource;
}

export interface FilterClearedEvent extends BaseEvent {
  type: 'filter:cleared';
  sheetId: string;
  filterId: string;
  filterKind?: FilterKind;
  hiddenRowCount?: number;
  visibleRowCount?: number;
  source: StructureChangeSource;
}

export type FilterEvent =
  | FilterCreatedEvent
  | FilterUpdatedEvent
  | FilterAppliedEvent
  | FilterDeletedEvent
  | FilterClearedEvent;
