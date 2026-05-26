/**
 * useCalculationMode Hook
 *
 * Provides calculation mode control and synchronous recalculation actions.
 * This handles calculation mode control (Automatic/Manual) and manual recalculation triggers.
 *
 * Used for:
 * - Toggling between automatic and manual calculation modes
 * - Triggering manual recalculation (Calculate Now / F9)
 * - Triggering sheet-specific recalculation (Calculate Sheet / Shift+F9)
 *
 * Architecture:
 * - Reads: Workbook settings mirror
 * - Writes: Through Workbook API
 */

import { useCallback } from 'react';

import { useWorkbook } from '../../infra/context';
import { useWorkbookSettings } from '../settings/use-workbook-settings';

// =============================================================================
// Types
// =============================================================================

export interface UseCalculationModeReturn {
  /** Current calculation mode */
  calculationMode: 'auto' | 'manual';
  /** Set calculation mode */
  setCalculationMode: (mode: 'auto' | 'manual') => void;
  /** Recalculate all formulas in the workbook (F9) */
  calculateNow: () => void;
  /** Recalculate all formulas in the active sheet (Shift+F9) */
  calculateSheet: () => void;
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook for calculation mode and synchronous recalculation actions.
 *
 * @example
 * ```tsx
 * const { calculationMode, setCalculationMode, calculateNow, calculateSheet } = useCalculationMode();
 *
 * // Toggle mode
 * setCalculationMode(calculationMode === 'auto' ? 'manual' : 'auto');
 *
 * // Trigger recalculation (F9)
 * calculateNow();
 *
 * // Trigger sheet recalculation (Shift+F9)
 * calculateSheet();
 * ```
 */
export function useCalculationMode(): UseCalculationModeReturn {
  const wb = useWorkbook();
  const { settings } = useWorkbookSettings();
  const rawMode = settings.calculationSettings?.calcMode ?? 'auto';
  const calculationMode = rawMode === 'manual' ? 'manual' : 'auto';

  const setCalculationMode = useCallback(
    (mode: 'auto' | 'manual') => {
      void wb.setCalculationMode(mode);
    },
    [wb],
  );

  const calculateNow = useCallback(() => {
    void wb.calculate();
  }, [wb]);

  const calculateSheet = useCallback(() => {
    // Workbook API only exposes full recalculation; this is a safe superset
    // of sheet-scoped recalculation.
    void wb.calculate();
  }, [wb]);

  return {
    calculationMode,
    setCalculationMode,
    calculateNow,
    calculateSheet,
  };
}
