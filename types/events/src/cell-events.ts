/**
 * Cell Events
 *
 * Event types for cell value, format, border, and metadata changes.
 */

import type { CellBorders, CellFormat, CellMetadata, CellValue } from '@mog/types-core';
import type { BaseEvent, CellChangeSource } from '@mog/types-commands/event-base';

export interface CellChangedEvent extends BaseEvent {
  type: 'cell:changed';
  sheetId: string;
  row: number;
  col: number;
  oldValue: CellValue | undefined;
  newValue: CellValue | undefined;
  oldFormula?: string;
  newFormula?: string;
  source: CellChangeSource;
}

export interface CellsBatchChangedEvent extends BaseEvent {
  type: 'cells:batch-changed';
  sheetId: string;
  changes: Array<{
    row: number;
    col: number;
    oldValue: CellValue | undefined;
    newValue: CellValue | undefined;
    oldFormula?: string;
    newFormula?: string;
  }>;
  source: CellChangeSource;
}

export interface CellFormatChangedEvent extends BaseEvent {
  type: 'cell:format-changed';
  sheetId: string;
  row: number;
  col: number;
  oldFormat: CellFormat | undefined;
  newFormat: CellFormat | undefined;
  source: CellChangeSource;
}

export interface CellBordersChangedEvent extends BaseEvent {
  type: 'cell:borders-changed';
  sheetId: string;
  row: number;
  col: number;
  oldBorders: CellBorders | undefined;
  newBorders: CellBorders | undefined;
  source: CellChangeSource;
}

export interface CellMetadataChangedEvent extends BaseEvent {
  type: 'cell:metadata-changed';
  sheetId: string;
  row: number;
  col: number;
  oldMetadata: CellMetadata | undefined;
  newMetadata: CellMetadata | undefined;
  source: CellChangeSource;
}

/**
 * Emitted when a formula changes on a cell.
 * Maps to OfficeJS `onFormulaChanged`.
 */
export interface FormulaChangedEvent extends BaseEvent {
  type: 'formula:changed';
  sheetId: string;
  row: number;
  col: number;
  oldFormula: string | undefined;
  newFormula: string | undefined;
  source: CellChangeSource;
}

export type CellEvent =
  | CellChangedEvent
  | CellsBatchChangedEvent
  | CellFormatChangedEvent
  | CellBordersChangedEvent
  | CellMetadataChangedEvent
  | FormulaChangedEvent;
