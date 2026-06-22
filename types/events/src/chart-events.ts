/**
 * Chart Events
 *
 * Event types for chart CRUD operations and UI interaction events.
 */

import type { CellRange } from '@mog/types-core';
import type { BaseEvent, StructureChangeSource } from '@mog/types-commands/event-base';
import type { ChartConfig } from '@mog/types-data/data/charts';

export interface ChartCreatedEvent extends BaseEvent {
  type: 'chart:created';
  sheetId: string;
  chartId: string;
  chartType: string;
  dataRange: CellRange;
  source: StructureChangeSource;
}

export interface ChartUpdatedEvent extends BaseEvent {
  type: 'chart:updated';
  sheetId: string;
  chartId: string;
  changes: Partial<ChartConfig>;
  /** Names of chart/floating-object fields that changed, when supplied by compute. */
  changedFields?: string[];
  source: StructureChangeSource;
}

export interface ChartDeletedEvent extends BaseEvent {
  type: 'chart:deleted';
  sheetId: string;
  chartId: string;
  source: StructureChangeSource;
}

export interface ChartMovedEvent extends BaseEvent {
  type: 'chart:moved';
  sheetId: string;
  chartId: string;
  oldPosition: { x: number; y: number; width: number; height: number };
  newPosition: { x: number; y: number; width: number; height: number };
  source: StructureChangeSource;
}

/** Emitted when a chart is selected in the UI */
export interface ChartSelectedEvent extends BaseEvent {
  type: 'chart:selected';
  sheetId: string;
  chartId: string;
}

/** Emitted when a chart is deselected in the UI */
export interface ChartDeselectedEvent extends BaseEvent {
  type: 'chart:deselected';
  sheetId: string;
  chartId: string;
}

export type ChartEvent =
  | ChartCreatedEvent
  | ChartUpdatedEvent
  | ChartDeletedEvent
  | ChartMovedEvent
  | ChartSelectedEvent
  | ChartDeselectedEvent;
