/**
 * Machine Types Runtime Functions
 *
 * Extracted from @mog-sdk/contracts/machines/types.
 */

import { FORMULA_RANGE_COLORS } from '@mog-sdk/contracts/machines/types';

export function getNextFormulaRangeColor(currentIndex: number): {
  color: string;
  nextIndex: number;
} {
  const nextIndex = (currentIndex + 1) % FORMULA_RANGE_COLORS.length;
  return {
    color: FORMULA_RANGE_COLORS[nextIndex],
    nextIndex,
  };
}
