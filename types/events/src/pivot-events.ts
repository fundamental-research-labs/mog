/**
 * Pivot Table Events
 *
 * Event types for pivot table operations.
 */

import type { BaseEvent, StructureChangeSource } from '@mog/types-commands/event-base';
import type {
  PlacementId,
  PivotCommandReceipt,
  PivotExpansionKey,
  PivotKernelMutationReceipt,
  PivotTableConfig,
} from '@mog/types-data/data/pivot';

export type PivotUpdateReason =
  | 'renamed'
  | 'fieldPlacementChanged'
  | 'aggregateFunctionChanged'
  | 'showValuesAsChanged'
  | 'sortOrderChanged'
  | 'filterChanged'
  | 'fieldReset'
  | 'layoutChanged'
  | 'styleChanged'
  | 'formattingOptionChanged'
  | 'calculatedFieldChanged'
  | 'sourceRangeChanged'
  | 'slicerFilterChanged'
  | 'historyReplay'
  | 'uiConfigChanged';

export type PivotRefreshPolicy = 'dirtyOnly' | 'refreshAndMaterialize';

export interface PivotUpdateOptions {
  reason: PivotUpdateReason;
  refreshPolicy: PivotRefreshPolicy;
  placementId?: PlacementId;
  kernelReceiptId?: string;
}

export interface PivotCreatedEvent extends BaseEvent {
  type: 'pivot:created';
  outputSheetId: string;
  sourceSheetId: string;
  /** @deprecated Use outputSheetId instead. Kept for backwards compatibility. */
  sheetId: string;
  pivotId: string;
  kernelReceipt?: PivotKernelMutationReceipt;
  config: PivotTableConfig;
  source: StructureChangeSource;
}

export interface PivotUpdatedEvent extends BaseEvent {
  type: 'pivot:updated';
  outputSheetId: string;
  sourceSheetId: string;
  /** @deprecated Use outputSheetId instead. */
  sheetId: string;
  pivotId: string;
  placementIds?: PlacementId[];
  oldConfig?: PivotTableConfig;
  newConfig?: PivotTableConfig;
  update: PivotUpdateOptions;
  kernelReceipt?: PivotKernelMutationReceipt;
  commandReceipt?: PivotCommandReceipt;
  source: StructureChangeSource;
}

export interface PivotDeletedEvent extends BaseEvent {
  type: 'pivot:deleted';
  outputSheetId: string;
  sourceSheetId: string;
  /** @deprecated Use outputSheetId instead. */
  sheetId: string;
  pivotId: string;
  removedPlacementIds?: PlacementId[];
  source: StructureChangeSource;
}

export interface PivotExpansionChangedEvent extends BaseEvent {
  type: 'pivot:expansion-changed';
  sheetId: string;
  pivotId: string;
  expansionKey?: PivotExpansionKey;
  /** @deprecated Legacy rendered header key. */
  headerKey: string;
  isExpanded: boolean;
  axis: 'row' | 'column';
  axisPlacementId?: PlacementId;
}

export type PivotEvent =
  | PivotCreatedEvent
  | PivotUpdatedEvent
  | PivotDeletedEvent
  | PivotExpansionChangedEvent;
