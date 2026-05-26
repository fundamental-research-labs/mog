/**
 * Checkbox Coordination
 *
 * Feature coordination for checkbox cells - combines setup and actions.
 * Checkboxes are special cells with boolean values that toggle on click.
 *
 * ARCHITECTURE:
 * - Stores checkbox configuration (callbacks for cell value access)
 * - Provides actions: toggleCheckbox, isCheckboxCell
 * - No state machine subscriptions needed (checkbox is stateless)
 * - Function-based API (not class-based)
 *
 */

import type { CellCoord } from '@mog-sdk/contracts/rendering';

import type { CleanupManager } from '../../../shared/cleanup-manager';

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for checkbox feature coordination.
 */
export interface CheckboxCoordinationConfig {
  /** Get cell value for checking current checkbox state */
  getCellValue: (sheetId: string, row: number, col: number) => unknown;
  /** Set cell value when toggling checkbox */
  setCellValue: (sheetId: string, row: number, col: number, value: unknown) => void;
  /** Check if a cell is a checkbox cell */
  isCheckboxCell: (sheetId: string, row: number, col: number) => boolean;
  /** Optional: Set pending undo description for checkbox toggle */
  setPendingUndoDescription?: (description: string) => void;
}

/**
 * Result of checkbox coordination setup.
 */
export interface CheckboxCoordinationResult {
  /** Check if a cell is a checkbox cell */
  isCheckboxCell: (sheetId: string, row: number, col: number) => boolean;
  /** Toggle a checkbox cell value. Returns true if toggled, false if not a checkbox. */
  toggleCheckbox: (cell: CellCoord, sheetId: string) => boolean;
  /** Cleanup function */
  cleanup: () => void;
}

// =============================================================================
// Coordination Setup
// =============================================================================

/**
 * Build checkbox coordination feature.
 *
 * Provides checkbox cell detection and toggle actions.
 * No state machine subscriptions needed since checkboxes are stateless.
 *
 * @param config - Configuration with cell value callbacks
 * @param cleanups - CleanupManager to register cleanup function
 * @returns Checkbox coordination result with actions
 */
export function buildCheckboxCoordination(
  config: CheckboxCoordinationConfig,
  cleanups: CleanupManager,
): CheckboxCoordinationResult {
  const { getCellValue, setCellValue, isCheckboxCell, setPendingUndoDescription } = config;

  // Checkbox coordination is stateless - no subscriptions needed
  const cleanup = () => {
    // No-op: no subscriptions to clean up
  };

  // Register cleanup with manager
  cleanups.register('checkboxCoordination', cleanup);

  return {
    isCheckboxCell: (sheetId: string, row: number, col: number) => {
      return isCheckboxCell(sheetId, row, col);
    },

    toggleCheckbox: (cell: CellCoord, sheetId: string): boolean => {
      // Check if cell is a checkbox
      if (!isCheckboxCell(sheetId, cell.row, cell.col)) {
        return false;
      }

      // Get current value and determine checked state
      const currentValue = getCellValue(sheetId, cell.row, cell.col);
      const isCurrentlyChecked =
        currentValue === true || currentValue === 'TRUE' || currentValue === 1;

      // Set undo description if callback provided
      if (setPendingUndoDescription) {
        const colLetter = String.fromCharCode(65 + (cell.col % 26));
        setPendingUndoDescription(`Toggle checkbox ${colLetter}${cell.row + 1}`);
      }

      // Toggle the checkbox value
      setCellValue(sheetId, cell.row, cell.col, !isCurrentlyChecked);

      return true;
    },

    cleanup,
  };
}
