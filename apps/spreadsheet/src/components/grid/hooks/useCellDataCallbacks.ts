/**
 * Cell Data Callbacks Hook
 *
 * Provides sheet-aware callbacks for retrieving cell values, formats,
 * and sparkline render data. These callbacks are used by CellDataSource
 * for non-binary-buffer data: overflow neighbor reads, sticky headers,
 * and sparkline render data.
 *
 * Per-cell rendering data (flags, display text, CF overrides) comes from
 * the binary viewport buffer directly — not through these callbacks.
 */

import type { ViewportReader } from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import { useCallback } from 'react';
import type { SparklineManager } from '../../../coordinator/sparklines';

interface UseCellDataCallbacksOptions {
  getViewport: (sheetId: SheetId) => ViewportReader;
  sparklineManager: SparklineManager;
}

export interface CellDataCallbacks {
  getCellValue: (sheetId: SheetId, cell: CellCoord) => any;
  getCellFormat: (sheetId: SheetId, cell: CellCoord) => any;
  getSparklineRenderData: (sheetId: SheetId, cell: CellCoord) => any;
}

/**
 * Hook to create sheet-aware cell data callbacks.
 *
 * These callbacks receive sheetId at call time (not from React closure),
 * preventing stale data when sheets switch. The renderer machine's
 * RenderContext.currentSheetId is the authoritative source.
 */
export function useCellDataCallbacks(options: UseCellDataCallbacksOptions): CellDataCallbacks {
  const { getViewport, sparklineManager } = options;

  const getCellValue = useCallback(
    (sheetId: SheetId, cell: CellCoord) => {
      const cellData = getViewport(sheetId).getCellData(cell.row, cell.col);
      return cellData?.displayText ?? null;
    },
    [getViewport],
  );

  const getCellFormat = useCallback(
    (sheetId: SheetId, cell: CellCoord) => {
      const cellData = getViewport(sheetId).getCellData(cell.row, cell.col);
      return cellData?.format ?? null;
    },
    [getViewport],
  );

  const getSparklineRenderData = useCallback(
    (sheetId: SheetId, cell: CellCoord) =>
      sparklineManager.getRenderDataAtCell(sheetId, cell.row, cell.col),
    [sparklineManager],
  );

  return {
    getCellValue,
    getCellFormat,
    getSparklineRenderData,
  };
}
