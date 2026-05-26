/**
 * Use CF Manager Hook
 *
 * Provides decomposed CF accessors for conditional formatting data.
 * Used as a fallback when the binary viewport buffer is not active.
 *
 * NOTE: CF data is now primarily provided by the binary viewport buffer
 * from Rust's CF cache. This hook provides a fallback for the non-binary
 * path (e.g., showFormulas mode). The underlying ConditionalFormatCache
 * is a no-op stub — CF results always come from the binary buffer.
 *
 * @see worksheet-impl.ts - No-op stub cache via ws._internal.cfCache
 */

import { useCallback } from 'react';

import type { CFResult } from '@mog-sdk/contracts/conditional-format';
import type { CellCoord, DataBarData, IconData } from '@mog-sdk/contracts/rendering';

import { useActiveSheetId, useWorkbook } from '../../infra/context';

/**
 * Hook providing access to the ConditionalFormatCache via Worksheet API.
 *
 * Returns decomposed CF accessors (getBgColorOverride, getFontColorOverride,
 * getDataBar, getIcon) instead of the monolithic getCFResult. This matches
 * the CellDataSource interface which expects typed accessors rather than
 * an opaque CFResult blob.
 *
 * @returns ConditionalFormatCache instance and decomposed CF accessor callbacks
 *
 * @example
 * ```tsx
 * const { cfManager, getBgColorOverride, getFontColorOverride, getDataBar, getIcon } = useCFManager();
 *
 * // Pass to coordinator
 * coordinator.setRenderContextConfig({
 * getBgColorOverride,
 * getFontColorOverride,
 * getDataBar,
 * getIcon,
 * });
 * ```
 */
export function useCFManager() {
  const wb = useWorkbook();
  const activeSheetId = useActiveSheetId();
  const ws = wb.getSheetById(activeSheetId);

  // Access the reactive ConditionalFormatCache from the Worksheet API.
  // The cache is lazily created and managed by WorksheetImpl — no manual
  // lifecycle management needed (WorksheetImpl.dispose() handles teardown).
  const cfManager = ws._internal.cfCache;

  // Helper to get the raw CFResult for a cell (shared by all accessors)
  const getResult = useCallback(
    (sheetId: string, cell: CellCoord): CFResult | undefined => {
      return cfManager.getResult(sheetId, cell.row, cell.col) ?? undefined;
    },
    [cfManager],
  );

  // Decomposed CF accessors — each extracts one facet from CFResult.
  // These will eventually be replaced by direct binary viewport buffer reads.
  const getBgColorOverride = useCallback(
    (sheetId: string, cell: CellCoord): string | null => {
      const r = getResult(sheetId, cell);
      if (!r) return null;
      return r.computedBackgroundColor ?? r.style?.backgroundColor ?? null;
    },
    [getResult],
  );

  const getFontColorOverride = useCallback(
    (sheetId: string, cell: CellCoord): string | null => {
      const r = getResult(sheetId, cell);
      return r?.style?.fontColor ?? null;
    },
    [getResult],
  );

  const getDataBar = useCallback(
    (sheetId: string, cell: CellCoord): DataBarData | null => {
      const r = getResult(sheetId, cell);
      if (!r?.dataBar) return null;
      const db = r.dataBar;
      return {
        fillPercent: db.fillPercent,
        color: db.color,
        isNegative: db.isNegative,
        gradient: db.gradient,
        showValue: db.showValue,
        showAxis: db.showAxis,
        axisPosition: db.axisPosition,
        negativeColor: db.negativeColor ?? db.color,
      };
    },
    [getResult],
  );

  const getIcon = useCallback(
    (sheetId: string, cell: CellCoord): IconData | null => {
      const r = getResult(sheetId, cell);
      if (!r?.icon) return null;
      return {
        setName: r.icon.setName,
        iconIndex: r.icon.iconIndex,
        iconOnly: r.icon.iconOnly,
      };
    },
    [getResult],
  );

  return {
    cfManager,
    getBgColorOverride,
    getFontColorOverride,
    getDataBar,
    getIcon,
  };
}
