/**
 * Sparkline Events
 *
 * Event types for sparkline CRUD.
 */

import type { CellAddress, CellRange } from '@mog/types-core';
import type { BaseEvent, StructureChangeSource } from '@mog/types-commands/event-base';
import type { Sparkline, SparklineGroup, SparklineType } from '@mog/types-data/data/sparklines';

export interface SparklineChangedEvent extends BaseEvent {
  type: 'sparkline:changed';
  sheetId: string;
  position?: { row: number; col: number };
  kind: 'Set' | 'Removed' | 'Modified';
  source: StructureChangeSource;
}

export interface SparklineCreatedEvent extends BaseEvent {
  type: 'sparkline:created';
  sheetId: string;
  sparklineId: string;
  cell: CellAddress;
  sparklineType: SparklineType;
  sparkline: Sparkline;
  source: StructureChangeSource;
}

export interface SparklineUpdatedEvent extends BaseEvent {
  type: 'sparkline:updated';
  sheetId: string;
  sparklineId: string;
  changes: Partial<Sparkline>;
  source: StructureChangeSource;
}

export interface SparklineDeletedEvent extends BaseEvent {
  type: 'sparkline:deleted';
  sheetId: string;
  sparklineId: string;
  cell: CellAddress;
  source: StructureChangeSource;
}

export interface SparklineGroupCreatedEvent extends BaseEvent {
  type: 'sparklineGroup:created';
  sheetId: string;
  groupId: string;
  sparklineIds: string[];
  sparklineType: SparklineType;
  source: StructureChangeSource;
}

export interface SparklineGroupUpdatedEvent extends BaseEvent {
  type: 'sparklineGroup:updated';
  sheetId: string;
  groupId: string;
  changes: Partial<SparklineGroup>;
  source: StructureChangeSource;
}

export interface SparklineGroupDeletedEvent extends BaseEvent {
  type: 'sparklineGroup:deleted';
  sheetId: string;
  groupId: string;
  sparklineIds: string[];
  source: StructureChangeSource;
}

export interface SparklinesClearedEvent extends BaseEvent {
  type: 'sparklines:cleared';
  sheetId: string;
  range: CellRange;
  clearedSparklineIds: string[];
  source: StructureChangeSource;
}

export interface SparklineDataChangedEvent extends BaseEvent {
  type: 'sparkline:dataChanged';
  sheetId: string;
  sparklineId: string;
  dataRange: CellRange;
}

export type SparklineEvent =
  | SparklineChangedEvent
  | SparklineCreatedEvent
  | SparklineUpdatedEvent
  | SparklineDeletedEvent
  | SparklineGroupCreatedEvent
  | SparklineGroupUpdatedEvent
  | SparklineGroupDeletedEvent
  | SparklinesClearedEvent
  | SparklineDataChangedEvent;
