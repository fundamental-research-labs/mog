/**
 * Table Events
 *
 * Event types for table CRUD and operations.
 */

import type { CellRange } from '@mog/types-core';
import type { BaseEvent, StructureChangeSource } from '@mog/types-commands/event-base';
import type { TableConfig } from '@mog/types-data/data/tables';

export interface TableCreatedEvent extends BaseEvent {
  type: 'table:created';
  sheetId: string;
  tableId: string;
  config: TableConfig;
  source: StructureChangeSource;
}

export interface TableUpdatedEvent extends BaseEvent {
  type: 'table:updated';
  sheetId: string;
  tableId: string;
  changes: Partial<TableConfig>;
  source: StructureChangeSource;
}

export interface TableDeletedEvent extends BaseEvent {
  type: 'table:deleted';
  sheetId: string;
  tableId: string;
  source: StructureChangeSource;
}

export interface TableResizedEvent extends BaseEvent {
  type: 'table:resized';
  sheetId: string;
  tableId: string;
  oldRange: CellRange;
  newRange: CellRange;
  source: StructureChangeSource;
}

export interface TableColumnRenamedEvent extends BaseEvent {
  type: 'table:column-renamed';
  sheetId: string;
  tableId: string;
  columnId: string;
  oldName: string;
  newName: string;
  source: StructureChangeSource;
}

export interface TableTotalRowChangedEvent extends BaseEvent {
  type: 'table:total-row-changed';
  sheetId: string;
  tableId: string;
  hasTotalRow: boolean;
  source: StructureChangeSource;
}

export interface TableRenamedEvent extends BaseEvent {
  type: 'table:renamed';
  sheetId: string;
  tableId: string;
  oldName: string;
  newName: string;
  source: StructureChangeSource;
}

export interface TableCalculatedColumnFilledEvent extends BaseEvent {
  type: 'table:calculated-column-filled';
  sheetId: string;
  tableId: string;
  columnIndex: number;
  columnName: string;
  cellsFilled: number;
  formula: string;
  source: StructureChangeSource;
}

export interface TableDuplicatesRemovedEvent extends BaseEvent {
  type: 'table:duplicates-removed';
  sheetId: string;
  tableId: string;
  columnsChecked: number[];
  duplicatesRemoved: number;
  uniqueValuesRemaining: number;
  source: StructureChangeSource;
}

export interface TableColumnDeletedEvent extends BaseEvent {
  type: 'table:column-deleted';
  sheetId: string;
  tableId: string;
  columnName: string;
  columnIndex: number;
  affectedFormulaCount: number;
  source: StructureChangeSource;
}

export interface TableConvertedToRangeEvent extends BaseEvent {
  type: 'table:converted-to-range';
  sheetId: string;
  tableId: string;
  tableName: string;
  range: CellRange;
  affectedFormulaCount: number;
  source: StructureChangeSource;
}

export interface TableSelectionChangedEvent extends BaseEvent {
  type: 'table:selection-changed';
  sheetId: string;
  tableId: string;
  tableName: string;
  /** The selected range within the table, or null if selection moved outside the table. */
  selection: CellRange | null;
  source: StructureChangeSource;
}

export type TableEvent =
  | TableCreatedEvent
  | TableUpdatedEvent
  | TableDeletedEvent
  | TableResizedEvent
  | TableColumnRenamedEvent
  | TableTotalRowChangedEvent
  | TableRenamedEvent
  | TableCalculatedColumnFilledEvent
  | TableDuplicatesRemovedEvent
  | TableColumnDeletedEvent
  | TableConvertedToRangeEvent
  | TableSelectionChangedEvent;
