/**
 * Cell Property Subscriptions Module
 *
 * Handles subscriptions to cell property change events (format, metadata).
 * These are DATA events, not rendering events, so they should work
 * independently of whether a renderer is attached.
 *
 * This module is initialized in the coordinator constructor, NOT in
 * setRendererDependencies, because:
 * 1. Cell property changes are fundamentally data changes
 * 2. A headless coordinator should still support property subscriptions
 * 3. This decouples data events from rendering lifecycle
 *
 * @see Issue-B-CELL-PROPERTY-SUBSCRIPTIONS.md
 */

import type { Workbook } from '@mog-sdk/contracts/api';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Result returned by setupCellPropertySubscriptions.
 */
export interface CellPropertySubscriptionResult {
  /**
   * Subscribe to property changes for a specific cell.
   * Returns unsubscribe function.
   */
  subscribeToCellPropertyChanges: (
    sheetId: string,
    row: number,
    col: number,
    onChange: () => void,
  ) => () => void;

  /**
   * Cleanup function - unsubscribes all events.
   */
  cleanup: () => void;
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * Set up cell property subscriptions.
 *
 * This is called during coordinator construction (not setRendererDependencies)
 * because cell property subscriptions are data events, not rendering events.
 *
 * @param workbook - The workbook API for event subscriptions
 * @returns Result with subscription API and cleanup
 */
export function setupCellPropertySubscriptions(workbook: Workbook): CellPropertySubscriptionResult {
  // Cell properties subscriptions Map
  // Key format: `${sheetId}:${row}:${col}`
  const cellPropertiesSubscriptions = new Map<string, Set<() => void>>();

  // Cleanup tracking for event bus subscriptions
  let formatUnsub: (() => void) | null = null;
  let metadataUnsub: (() => void) | null = null;

  // ---------------------------------------------------------------------------
  // LAZY EVENT SETUP (only when first subscription is added)
  // ---------------------------------------------------------------------------

  const setupEventListeners = () => {
    if (formatUnsub || metadataUnsub) {
      return; // Already set up
    }

    // Subscribe to format changes
    formatUnsub = workbook.on('cell:format-changed', (event) => {
      const key = `${event.sheetId}:${event.row}:${event.col}`;
      const callbacks = cellPropertiesSubscriptions.get(key);
      if (callbacks) {
        callbacks.forEach((cb) => {
          try {
            cb();
          } catch (error) {
            console.error('[CellPropertySubscriptions] Callback error on format change:', error);
          }
        });
      }
    });

    // Subscribe to metadata changes
    metadataUnsub = workbook.on('cell:metadata-changed', (event) => {
      const key = `${event.sheetId}:${event.row}:${event.col}`;
      const callbacks = cellPropertiesSubscriptions.get(key);
      if (callbacks) {
        callbacks.forEach((cb) => {
          try {
            cb();
          } catch (error) {
            console.error('[CellPropertySubscriptions] Callback error on metadata change:', error);
          }
        });
      }
    });
  };

  const teardownEventListeners = () => {
    if (formatUnsub) {
      formatUnsub();
      formatUnsub = null;
    }
    if (metadataUnsub) {
      metadataUnsub();
      metadataUnsub = null;
    }
  };

  // ---------------------------------------------------------------------------
  // PUBLIC API
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to property changes for a specific cell.
   */
  const subscribeToCellPropertyChanges = (
    sheetId: string,
    row: number,
    col: number,
    onChange: () => void,
  ): (() => void) => {
    const key = `${sheetId}:${row}:${col}`;

    // Get or create callback set for this cell
    let callbacks = cellPropertiesSubscriptions.get(key);
    if (!callbacks) {
      callbacks = new Set();
      cellPropertiesSubscriptions.set(key, callbacks);
    }

    // Add this callback
    callbacks.add(onChange);

    // Set up global event subscription if this is the first cell subscription
    if (cellPropertiesSubscriptions.size === 1 && callbacks.size === 1) {
      setupEventListeners();
    }

    // Return unsubscribe function
    return () => {
      const cbs = cellPropertiesSubscriptions.get(key);
      if (cbs) {
        cbs.delete(onChange);
        // Clean up empty sets
        if (cbs.size === 0) {
          cellPropertiesSubscriptions.delete(key);
        }
      }

      // Clean up global subscription if no more cell subscriptions
      if (cellPropertiesSubscriptions.size === 0) {
        teardownEventListeners();
      }
    };
  };

  /**
   * Main cleanup - unsubscribe all events and clear subscriptions.
   */
  const cleanup = () => {
    teardownEventListeners();
    cellPropertiesSubscriptions.clear();
  };

  return {
    subscribeToCellPropertyChanges,
    cleanup,
  };
}
