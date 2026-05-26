/**
 * Pivot Expansion Manager
 *
 * Lightweight standalone manager for pivot table expansion state
 * (which row/column groups are expanded/collapsed).
 *
 * This is ephemeral view state -- it does NOT persist across sessions.
 * Owned by the app layer (not the kernel) because it's UI state, not data model state.
 *
 * Implements PivotExpansionStateProvider so the kernel can read expansion state
 * without owning it.
 */

import type { IEventBus, PivotExpansionChangedEvent } from '@mog-sdk/contracts/events';
import type { PivotExpansionState, PivotExpansionStateProvider } from '@mog-sdk/contracts/pivot';

/**
 * Manages ephemeral expansion state for pivot tables.
 *
 * Each pivot table has a Map<string, boolean> keyed by prefixed header keys:
 * - "row:<headerKey>" for row headers
 * - "col:<headerKey>" for column headers
 *
 * Emits `pivot:expansion-changed` events via the EventBus on changes.
 */
export class PivotExpansionManager implements PivotExpansionStateProvider {
  /** Per-pivot expansion state: pivotId -> Map<prefixedKey, expanded> */
  private expansionMaps: Map<string, Map<string, boolean>> = new Map();
  private eventBus: IEventBus;

  constructor(eventBus: IEventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Get or create the expansion Map for a pivot table.
   */
  private getExpansionMap(pivotId: string): Map<string, boolean> {
    let map = this.expansionMaps.get(pivotId);
    if (!map) {
      map = new Map();
      this.expansionMaps.set(pivotId, map);
    }
    return map;
  }

  /**
   * Get expansion state for a pivot table.
   */
  getExpansionState(pivotId: string): PivotExpansionState {
    const expansionMap = this.getExpansionMap(pivotId);
    const expandedRows: Record<string, boolean> = {};
    const expandedColumns: Record<string, boolean> = {};

    expansionMap.forEach((value, key) => {
      if (key.startsWith('row:')) {
        expandedRows[key.slice(4)] = value;
      } else if (key.startsWith('col:')) {
        expandedColumns[key.slice(4)] = value;
      }
    });

    return { expandedRows, expandedColumns };
  }

  /**
   * Toggle expansion state for a header.
   *
   * @returns The new expansion state (true = expanded, false = collapsed)
   */
  toggleExpanded(pivotId: string, headerKey: string, isRow: boolean, sheetId?: string): boolean {
    const expansionMap = this.getExpansionMap(pivotId);
    const key = `${isRow ? 'row' : 'col'}:${headerKey}`;
    const current = expansionMap.get(key) ?? true; // Default to expanded
    const newValue = !current;

    expansionMap.set(key, newValue);

    // Emit pivot:expansion-changed event
    const expansionEvent: PivotExpansionChangedEvent = {
      type: 'pivot:expansion-changed',
      timestamp: Date.now(),
      sheetId: sheetId ?? '',
      pivotId,
      headerKey,
      isExpanded: newValue,
      axis: isRow ? 'row' : 'column',
    };
    this.eventBus.emit(expansionEvent);

    return newValue;
  }

  /**
   * Expand or collapse all headers.
   */
  setAllExpanded(pivotId: string, expanded: boolean): void {
    const expansionMap = this.getExpansionMap(pivotId);
    expansionMap.forEach((_, key) => {
      expansionMap.set(key, expanded);
    });
  }

  /**
   * Set expansion state for a row header.
   */
  setRowExpanded(pivotId: string, headerKey: string, expanded: boolean): void {
    const expansionMap = this.getExpansionMap(pivotId);
    expansionMap.set(`row:${headerKey}`, expanded);
  }

  /**
   * Set expansion state for a column header.
   */
  setColumnExpanded(pivotId: string, headerKey: string, expanded: boolean): void {
    const expansionMap = this.getExpansionMap(pivotId);
    expansionMap.set(`col:${headerKey}`, expanded);
  }

  /**
   * Clear expansion state (reset to default).
   */
  clearExpansionState(pivotId: string): void {
    this.expansionMaps.delete(pivotId);
  }

  /**
   * Subscribe to expansion state changes for a pivot table.
   *
   * @returns Unsubscribe function
   */
  subscribeToExpansion(
    pivotId: string,
    callback: (state: PivotExpansionState) => void,
  ): () => void {
    return this.eventBus.on('pivot:expansion-changed', (event: any) => {
      if (event.pivotId === pivotId) {
        callback(this.getExpansionState(pivotId));
      }
    });
  }

  /**
   * Clean up all expansion state.
   */
  destroy(): void {
    this.expansionMaps.clear();
  }
}
