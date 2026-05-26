/**
 * Sheet Events
 *
 * Event types for sheet lifecycle operations.
 */

import type { BaseEvent, StructureChangeSource } from '@mog/types-commands/event-base';

export interface SheetCreatedEvent extends BaseEvent {
  type: 'sheet:created';
  sheetId: string;
  name: string;
  index: number;
  source: StructureChangeSource;
}

export interface SheetDeletedEvent extends BaseEvent {
  type: 'sheet:deleted';
  sheetId: string;
  name: string;
  source: StructureChangeSource;
}

export interface SheetRenamedEvent extends BaseEvent {
  type: 'sheet:renamed';
  sheetId: string;
  oldName: string;
  newName: string;
  source: StructureChangeSource;
}

export interface SheetReorderedEvent extends BaseEvent {
  type: 'sheet:reordered';
  sheetId: string;
  oldIndex: number;
  newIndex: number;
  source: StructureChangeSource;
}

export interface SheetColorChangedEvent extends BaseEvent {
  type: 'sheet:colorChanged';
  sheetId: string;
  oldColor: string | null;
  newColor: string | null;
  source: StructureChangeSource;
}

export interface SheetVisibilityChangedEvent extends BaseEvent {
  type: 'sheet:visibilityChanged';
  sheetId: string;
  hidden: boolean;
  source: StructureChangeSource;
}

export interface SheetMovedEvent extends BaseEvent {
  type: 'sheet:moved';
  sheetId: string;
  fromIndex: number;
  toIndex: number;
  source: StructureChangeSource;
}

export interface SheetCopiedEvent extends BaseEvent {
  type: 'sheet:copied';
  sourceSheetId: string;
  newSheetId: string;
  newName: string;
  source: StructureChangeSource;
}

export interface SheetActivatedEvent extends BaseEvent {
  type: 'sheet:activated';
  sheetId: string;
  name: string;
  source: StructureChangeSource;
}

/**
 * Emitted when sheet protection status changes.
 * Maps to OfficeJS `onProtectionChanged`.
 */
export interface ProtectionChangedEvent extends BaseEvent {
  type: 'protection:changed';
  sheetId: string;
  /** Whether the sheet is now protected */
  isProtected: boolean;
  source: StructureChangeSource;
}

export type SheetEvent =
  | SheetCreatedEvent
  | SheetDeletedEvent
  | SheetRenamedEvent
  | SheetReorderedEvent
  | SheetColorChangedEvent
  | SheetVisibilityChangedEvent
  | SheetMovedEvent
  | SheetCopiedEvent
  | SheetActivatedEvent
  | ProtectionChangedEvent;
