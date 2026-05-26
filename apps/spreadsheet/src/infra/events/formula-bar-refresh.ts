import type { CellRange, SheetId } from '@mog-sdk/contracts/core';

export const FORMULA_BAR_REFRESH_REQUESTED = 'mog:formula-bar-refresh-requested';

export interface FormulaBarRefreshDetail {
  sheetIds?: SheetId[];
  ranges?: CellRange[];
}

export function requestFormulaBarRefresh(detail: FormulaBarRefreshDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(FORMULA_BAR_REFRESH_REQUESTED, { detail }));
}
