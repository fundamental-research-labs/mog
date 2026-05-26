/**
 * Validation Circles Coordination
 *
 * Auto-clears validation circles when cells become valid.
 *
 * This coordination module subscribes to validation events from the EventBus
 * and automatically removes cells from the validation circles display when
 * they pass validation.
 *
 * Architecture:
 * - Subscribes to `validation:passed` events from the EventBus
 * - Calls UIStore's `removeValidationCircle()` to update UI state
 * - Follows the cleanup pattern for proper event handler disposal
 *
 * Rust contract:
 * `prepare_recalc_for_flush` runs both column-schema validation AND
 * data-validation rules over every changed cell, emitting a
 * `RecalcValidationAnnotation` for each — including passes (empty errors).
 * The schema-bridge translates empty-errors annotations to
 * `validation:passed`, so this coordinator clears the circle without
 * needing to re-validate per cell.
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - EventBus subscription patterns
 */

import type { Workbook } from '@mog-sdk/contracts/api';
import type { ReadableStoreApi } from '../../../shared/types';
import type { GridEditingUIStore } from '../../types';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Configuration for validation circles coordination.
 */
export interface ValidationCirclesCoordinationConfig {
  /** Workbook API for event subscriptions */
  workbook: Workbook;
  /**
   * UIStore view for updating validation circles state.
   * Accepts any store API whose getState() returns a superset of
   * GridEditingUIStore — the full UIStore from apps/spreadsheet satisfies this.
   */
  uiStore: ReadableStoreApi<GridEditingUIStore>;
}

/**
 * Result of setting up validation circles coordination.
 */
export interface ValidationCirclesCoordinationResult {
  /** Cleanup function to unsubscribe from events */
  cleanup: () => void;
}

// =============================================================================
// COORDINATION SETUP
// =============================================================================

/**
 * Set up validation circles coordination.
 *
 * This coordination module subscribes to `validation:passed` events from the
 * EventBus and removes cells from validation circles when they become valid.
 * Rust emits an empty-errors `RecalcValidationAnnotation` for every dirty
 * cell that exits the error set (data-validation rules and column schemas
 * both go through the same annotation path), so a single subscription is
 * sufficient — no per-cell-change re-validation needed.
 *
 * @param config - Configuration with EventBus and UIStore
 * @returns Object with cleanup function
 */
export function setupValidationCirclesCoordination(
  config: ValidationCirclesCoordinationConfig,
): ValidationCirclesCoordinationResult {
  const { workbook, uiStore } = config;

  const unsubPassed = workbook.on('validation:passed', (event) => {
    const { sheetId, row, col } = event;
    // Remove the cell from validation circles if it was marked.
    // This is idempotent — if the cell wasn't in the set, nothing happens.
    uiStore.getState().removeValidationCircle(sheetId, row, col);
  });

  return {
    cleanup: () => {
      unsubPassed();
    },
  };
}
