/**
 * Slicers Domain Types
 *
 * This module provides:
 * - Re-exports of all slicer types from @mog-sdk/contracts
 * - Helper functions for slicer ID generation
 * - Internal types needed by other slicer modules
 *
 * No CRDT dependency — pure type definitions and utility functions.
 *
 * @see docs/architecture/cell-identity.md
 */

// =============================================================================
// Re-export slicer types from contracts
// =============================================================================

export type { CellId } from '@mog-sdk/contracts/cell-identity';
export type { SheetId } from '@mog-sdk/contracts/core';
export type { StructureChangeSource } from '@mog-sdk/contracts/event-base';
export type {
  SlicerCacheInvalidatedEvent,
  SlicerCreatedEvent,
  SlicerDeletedEvent,
  SlicerDisconnectedEvent,
  SlicerSelectionChangedEvent,
  SlicerUpdatedEvent,
} from '@mog-sdk/contracts/events';
export type { ObjectPosition } from '@mog-sdk/contracts/floating-objects';
export type {
  CreateSlicerOptions,
  SlicerCache,
  SlicerConfig,
  SlicerCustomStyle,
  SlicerItem,
  SlicerItemState,
  SlicerPivotSource,
  SlicerSelectionState,
  SlicerSource,
  SlicerSourceType,
  SlicerStyle,
  SlicerStylePreset,
  SlicerTableSource,
  StoredSlicerConfig,
  TimelineLevel,
  TimelinePeriod,
  TimelineSlicerConfig,
} from '@mog-sdk/contracts/slicers';
export type { WorkflowCellValue } from '@mog-sdk/contracts/workflows';

export {
  DEFAULT_SLICER_STYLE,
  DEFAULT_TIMELINE_STYLE,
  getQuarterFromMonth,
  getQuarterLabel,
  isPivotSlicerSource,
  isTableSlicerSource,
  isTimelineSlicerConfig,
} from './slicer-utils';

// =============================================================================
// Internal Types
// =============================================================================

/**
 * Invalidation reason codes used internally.
 * These are mapped to contract event reason codes when emitting events.
 */
export type SlicerInvalidationReason = 'data-changed' | 'filter-changed' | 'structure-changed';

/**
 * Disconnection reason codes used internally.
 * These are mapped to contract event reason codes when emitting events.
 */
export type SlicerDisconnectionReason = 'column-deleted' | 'table-deleted' | 'pivot-deleted';

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate a unique slicer ID.
 *
 * @returns A unique slicer ID string
 */
export function generateSlicerId(): string {
  return `slicer-${crypto.randomUUID()}`;
}

/**
 * Map internal invalidation reason codes to contract event reason codes.
 *
 * @param reason - Internal reason code
 * @returns Contract event reason code
 */
export function mapInvalidationReason(
  reason: SlicerInvalidationReason,
): 'cellsChanged' | 'filterApplied' | 'tableStructureChanged' | 'pivotUpdated' {
  switch (reason) {
    case 'data-changed':
      return 'cellsChanged';
    case 'filter-changed':
      return 'filterApplied';
    case 'structure-changed':
      return 'tableStructureChanged';
  }
}

/**
 * Map internal disconnection reason codes to contract event reason codes.
 *
 * @param reason - Internal reason code
 * @returns Contract event reason code
 */
export function mapDisconnectedReason(
  reason: SlicerDisconnectionReason,
): 'columnDeleted' | 'tableDeleted' | 'pivotDeleted' {
  switch (reason) {
    case 'column-deleted':
      return 'columnDeleted';
    case 'table-deleted':
      return 'tableDeleted';
    case 'pivot-deleted':
      return 'pivotDeleted';
  }
}
