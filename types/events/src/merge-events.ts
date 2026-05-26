/**
 * Merge Events
 *
 * Event types for cell merge and unmerge operations.
 */

import type { CellId, IdentityMergedRegion } from '@mog/types-core/cell-identity';
import type { BaseEvent, StructureChangeSource } from '@mog/types-commands/event-base';

export interface CellsMergedEvent extends BaseEvent {
  type: 'cells:merged';
  sheetId: string;
  /** The created merge region (CellId-based, stable under structure changes) */
  region: IdentityMergedRegion;
  /** Resolved start row position (for rendering) */
  startRow: number;
  /** Resolved start column position (for rendering) */
  startCol: number;
  /** Resolved end row position (for rendering) */
  endRow: number;
  /** Resolved end column position (for rendering) */
  endCol: number;
  source: StructureChangeSource;
}

export interface CellsUnmergedEvent extends BaseEvent {
  type: 'cells:unmerged';
  sheetId: string;
  /** The origin cell that was unmerged (CellId of former top-left) */
  topLeftId: CellId;
  /** Resolved start row position of the former merge (for rendering) */
  startRow: number;
  /** Resolved start column position of the former merge (for rendering) */
  startCol: number;
  /** Resolved end row position of the former merge (for rendering) */
  endRow: number;
  /** Resolved end column position of the former merge (for rendering) */
  endCol: number;
  source: StructureChangeSource;
}

/**
 * Per-region merge or unmerge change carried by `merges:changed`.
 * Coordinates are resolved row/col positions at the time of the change.
 */
export interface MergeRegionChange {
  kind: 'Set' | 'Removed';
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export interface MergesChangedEvent extends BaseEvent {
  type: 'merges:changed';
  sheetId: string;
  /** Number of merges after the change */
  mergeCount: number;
  /**
   * The individual region changes that triggered this event. Empty if no
   * regional detail was available (e.g. a coalesced batch from a remote
   * source). Listeners that need region geometry (e.g. selection re-anchor
   * after merge) should read this in preference to refetching from a cache.
   */
  regions: MergeRegionChange[];
  source: StructureChangeSource;
}

export type MergeEvent = CellsMergedEvent | CellsUnmergedEvent | MergesChangedEvent;
