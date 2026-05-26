/**
 * Data Tools Events
 *
 * Event types for remove duplicates, text to columns.
 */

import type { CellRange } from '@mog/types-core';
import type { BaseEvent, StructureChangeSource } from '@mog/types-commands/event-base';

export interface DuplicatesRemovedEvent extends BaseEvent {
  type: 'duplicates:removed';
  sheetId: string;
  range: CellRange;
  duplicatesRemoved: number;
  uniqueValuesRemaining: number;
  source: StructureChangeSource;
}

export interface TextSplitEvent extends BaseEvent {
  type: 'text:split';
  sheetId: string;
  sourceRange: CellRange;
  destinationStart: { row: number; col: number };
  rowsProcessed: number;
  columnsCreated: number;
  source: StructureChangeSource;
}

export type DataToolsEvent = DuplicatesRemovedEvent | TextSplitEvent;
