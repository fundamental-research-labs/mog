/**
 * View Events
 *
 * Event types for freeze panes, split views, scroll, and viewport.
 */

import type {
  BaseEvent,
  CellChangeSource,
  StructureChangeSource,
} from '@mog/types-commands/event-base';

export interface FreezeChangedEvent extends BaseEvent {
  type: 'freeze:changed';
  sheetId: string;
  oldFrozenRows: number;
  oldFrozenCols: number;
  newFrozenRows: number;
  newFrozenCols: number;
  source: StructureChangeSource;
}

export interface ViewOptionsChangedEvent extends BaseEvent {
  type: 'view:options-changed';
  sheetId: string;
  showGridlines: boolean;
  showRowHeaders: boolean;
  showColumnHeaders: boolean;
  source: StructureChangeSource;
}

export interface ViewSelectionChangedEvent extends BaseEvent {
  type: 'view:selection-changed';
  sheetId: string;
  activeCell: { row: number; col: number };
  ranges: Array<{ startRow: number; startCol: number; endRow: number; endCol: number }>;
  source: CellChangeSource;
}

export interface SplitCreatedEvent extends BaseEvent {
  type: 'split:created';
  sheetId: string;
  config: {
    direction: 'horizontal' | 'vertical' | 'both';
    horizontalPosition: number;
    verticalPosition: number;
  };
  source: CellChangeSource;
}

export interface SplitRemovedEvent extends BaseEvent {
  type: 'split:removed';
  sheetId: string;
  source: CellChangeSource;
}

export interface SplitPositionChangedEvent extends BaseEvent {
  type: 'split:position-changed';
  sheetId: string;
  config: {
    direction: 'horizontal' | 'vertical' | 'both';
    horizontalPosition: number;
    verticalPosition: number;
  };
  source: CellChangeSource;
}

export type ScrollSource = 'user' | 'keyboard' | 'programmatic';

export interface ScrollChangedEvent extends BaseEvent {
  type: 'scroll:changed';
  sheetId: string;
  scrollX: number;
  scrollY: number;
  source: ScrollSource;
}

export interface ViewportResizedEvent extends BaseEvent {
  type: 'viewport:resized';
  sheetId: string;
  visibleRange: {
    startRow: number;
    endRow: number;
    startCol: number;
    endCol: number;
  };
  viewportSize: {
    width: number;
    height: number;
  };
}

export type ViewEvent =
  | FreezeChangedEvent
  | ViewOptionsChangedEvent
  | ViewSelectionChangedEvent
  | SplitCreatedEvent
  | SplitRemovedEvent
  | SplitPositionChangedEvent
  | ScrollChangedEvent
  | ViewportResizedEvent;
