/**
 * Filter Events
 *
 * Event types for AutoFilter operations.
 */

import type { CellRange } from '@mog/types-core';
import type { BaseEvent, StructureChangeSource } from '@mog/types-commands/event-base';

export type FilterKind = 'autoFilter' | 'tableFilter' | 'advancedFilter';

export type FilterCapability = 'supported' | 'unsupported';

export type ImportFilterUnsupportedReason =
  | 'unknownDynamicType'
  | 'unknownCustomOperator'
  | 'dateGroupUnsupported'
  | 'dynamicTemporalContextUnsupported'
  | 'valueTokenUnresolved'
  | 'valueTypeUnsupported'
  | 'colorDxfUnresolved'
  | 'iconFilterUnsupported'
  | 'unknownExtension'
  | 'tableFilterShapeUnsupported';

export interface FilterEventMetadata {
  tableId?: string;
  capability?: FilterCapability;
  unsupportedReasons?: readonly ImportFilterUnsupportedReason[];
  hasActiveFilter?: boolean;
  clearable?: boolean;
}

export interface FilterCreatedEvent extends BaseEvent, FilterEventMetadata {
  type: 'filter:created';
  sheetId: string;
  filterId: string;
  filterKind?: FilterKind;
  range?: CellRange;
  filterType?: string;
  source: StructureChangeSource;
}

export interface FilterUpdatedEvent extends BaseEvent, FilterEventMetadata {
  type: 'filter:updated';
  sheetId: string;
  filterId: string;
  filterKind?: FilterKind;
  headerCellId?: string;
  hiddenRowCount?: number;
  visibleRowCount?: number;
  source: StructureChangeSource;
}

export interface FilterAppliedEvent extends BaseEvent, FilterEventMetadata {
  type: 'filter:applied';
  sheetId: string;
  filterId: string;
  filterKind?: FilterKind;
  hiddenRowCount?: number;
  visibleRowCount?: number;
  source?: StructureChangeSource;
}

export interface FilterDeletedEvent extends BaseEvent, FilterEventMetadata {
  type: 'filter:deleted';
  sheetId: string;
  filterId: string;
  filterKind?: FilterKind;
  source: StructureChangeSource;
}

export interface FilterClearedEvent extends BaseEvent, FilterEventMetadata {
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
