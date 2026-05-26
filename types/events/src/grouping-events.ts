/**
 * Grouping Events
 *
 * Event types for row/column grouping and outline.
 */

import type { CellRange } from '@mog/types-core';
import type { BaseEvent, StructureChangeSource } from '@mog/types-commands/event-base';
import type { SheetGroupingConfig } from '@mog/types-data/data/grouping';

export interface GroupCreatedEvent extends BaseEvent {
  type: 'group:created';
  sheetId: string;
  groupId: string;
  axis: 'row' | 'column';
  start: number;
  end: number;
  level: number;
  source: StructureChangeSource;
}

export interface GroupDeletedEvent extends BaseEvent {
  type: 'group:deleted';
  sheetId: string;
  groupId: string;
  axis: 'row' | 'column';
  source: StructureChangeSource;
}

export interface GroupCollapsedEvent extends BaseEvent {
  type: 'group:collapsed';
  sheetId: string;
  groupId: string;
  collapsed: boolean;
  affectedRows?: number[];
  affectedCols?: number[];
}

export interface OutlineSettingsChangedEvent extends BaseEvent {
  type: 'outline:settings-changed';
  sheetId: string;
  settings: Partial<SheetGroupingConfig>;
  source: StructureChangeSource;
}

export interface OutlineLevelChangedEvent extends BaseEvent {
  type: 'outline:level-changed';
  sheetId: string;
  groupType: 'row' | 'column';
  level: number;
  source: StructureChangeSource;
}

export interface AutoOutlineAppliedEvent extends BaseEvent {
  type: 'outline:auto-applied';
  sheetId: string;
  groupsCreated: number;
  source: StructureChangeSource;
}

export interface SubtotalsCreatedEvent extends BaseEvent {
  type: 'subtotals:created';
  sheetId: string;
  range: CellRange;
  groupsCreated: number;
  subtotalRowsInserted: number;
  source: StructureChangeSource;
}

export interface SubtotalsRemovedEvent extends BaseEvent {
  type: 'subtotals:removed';
  sheetId: string;
  range: CellRange;
  groupsRemoved: number;
  subtotalRowsRemoved: number;
  source: StructureChangeSource;
}

/**
 * Describes a single grouping change within a `grouping:changed` event.
 * Mirrors the Rust `GroupingChange` payload from the mutation result.
 */
export interface GroupingChangeDetail {
  /** Which axis was affected */
  axis: 'row' | 'column';
  /** Whether a group was added or removed */
  kind: 'Set' | 'Removed';
}

/** Generic grouping changed event (fired when any grouping state changes). */
export interface GroupingChangedEvent extends BaseEvent {
  type: 'grouping:changed';
  sheetId?: string;
  /** Per-change details when available (empty when detail is unavailable, e.g. coalesced remote batch). */
  changes?: GroupingChangeDetail[];
  /** Source of the change when available. */
  source?: StructureChangeSource;
}

export type GroupingEvent =
  | GroupCreatedEvent
  | GroupDeletedEvent
  | GroupCollapsedEvent
  | OutlineSettingsChangedEvent
  | OutlineLevelChangedEvent
  | AutoOutlineAppliedEvent
  | SubtotalsCreatedEvent
  | SubtotalsRemovedEvent
  | GroupingChangedEvent;
