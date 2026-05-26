/**
 * Structure Events
 *
 * Event types for row/column insertion, deletion, resizing, and visibility changes.
 */

import type { BaseEvent, StructureChangeSource } from '@mog/types-commands/event-base';

export interface RowsInsertedEvent extends BaseEvent {
  type: 'rows:inserted';
  sheetId: string;
  startRow: number;
  count: number;
  source: StructureChangeSource;
}

export interface RowsDeletedEvent extends BaseEvent {
  type: 'rows:deleted';
  sheetId: string;
  startRow: number;
  count: number;
  source: StructureChangeSource;
}

export interface ColumnsInsertedEvent extends BaseEvent {
  type: 'columns:inserted';
  sheetId: string;
  startCol: number;
  count: number;
  source: StructureChangeSource;
}

export interface ColumnsDeletedEvent extends BaseEvent {
  type: 'columns:deleted';
  sheetId: string;
  startCol: number;
  count: number;
  source: StructureChangeSource;
}

export interface RowHeightChangedEvent extends BaseEvent {
  type: 'row:height-changed';
  sheetId: string;
  row: number;
  oldHeight: number;
  newHeight: number;
  source: StructureChangeSource;
}

export interface ColumnWidthChangedEvent extends BaseEvent {
  type: 'column:width-changed';
  sheetId: string;
  col: number;
  oldWidth: number;
  newWidth: number;
  source: StructureChangeSource;
}

export interface RowsHiddenEvent extends BaseEvent {
  type: 'rows:hidden';
  sheetId: string;
  rows: number[];
  source: StructureChangeSource;
}

export interface RowsUnhiddenEvent extends BaseEvent {
  type: 'rows:unhidden';
  sheetId: string;
  rows: number[];
  source: StructureChangeSource;
}

export interface ColumnsHiddenEvent extends BaseEvent {
  type: 'columns:hidden';
  sheetId: string;
  cols: number[];
  source: StructureChangeSource;
}

export interface ColumnsUnhiddenEvent extends BaseEvent {
  type: 'columns:unhidden';
  sheetId: string;
  cols: number[];
  source: StructureChangeSource;
}

export type StructureEvent =
  | RowsInsertedEvent
  | RowsDeletedEvent
  | ColumnsInsertedEvent
  | ColumnsDeletedEvent
  | RowHeightChangedEvent
  | ColumnWidthChangedEvent
  | RowsHiddenEvent
  | RowsUnhiddenEvent
  | ColumnsHiddenEvent
  | ColumnsUnhiddenEvent;
