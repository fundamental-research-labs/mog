/**
 * Use Cell Metadata Cache Hook
 *
 * Provides access to the CellMetadataCache for synchronous spill and validation
 * data lookups during the canvas render loop.
 *
 * Architecture (mirrors use-cf-manager.ts pattern):
 * - CellMetadataCache batch-fetches spill + validation data via Worksheet API
 * - Sync read methods serve cached data per-cell per-frame (hot path)
 * - onChange listeners trigger re-renders when cache is populated
 * - evaluateViewport() is called when viewport bounds or sheetId change
 *
 * This hook solves the async-in-sync-render-loop bug: SpreadsheetGrid previously
 * passed async callbacks (isProjectedPosition, hasValidationErrors, etc.) into the
 * synchronous canvas render loop. The Promises (truthy) were treated as `true`,
 * causing red validation circles on every cell and broken spill rendering.
 *
 * Cache is obtained via ws.cellMetadata (Worksheet API). MutationResultHandler
 * registration is handled automatically by WorksheetImpl when the cache is created.
 *
 * @see cell-metadata-cache.ts - Cache implementation (evaluate/cache/notify pattern)
 * @see use-cf-manager.ts - Same architectural pattern for conditional formatting
 */

import { useCallback, useEffect, useMemo } from 'react';

import type { CellRange } from '@mog-sdk/contracts/core';
import type { CellCoord } from '@mog-sdk/contracts/rendering';

import { useActiveSheetId, useWorkbook } from '../../infra/context';

// =============================================================================
// Types
// =============================================================================

export interface UseCellMetadataCacheOptions {
  /** Active sheet ID to evaluate. */
  sheetId: string;
  /** Viewport start row (0-based). */
  startRow: number;
  /** Viewport start column (0-based). */
  startCol: number;
  /** Viewport end row (0-based, inclusive). */
  endRow: number;
  /** Viewport end column (0-based, inclusive). */
  endCol: number;
  /** Optional callback invoked when cache data updates (e.g. to invalidate the renderer). */
  onCacheUpdate?: () => void;
}

export interface UseCellMetadataCacheResult {
  /** Sync callback: check if a cell has validation errors. Matches RenderContextConfig signature. */
  hasValidationErrors: (sheetId: string, cell: CellCoord) => boolean;
  /** Sync callback: check if a cell is a spill member. Matches RenderContextConfig signature. */
  isProjectedPosition: (sheetId: string, cell: CellCoord) => boolean;
  /** Sync callback: get spill anchor position. Matches RenderContextConfig signature. */
  getProjectionSourcePosition: (sheetId: string, cell: CellCoord) => CellCoord | undefined;
  /** Sync callback: get spill range. Matches RenderContextConfig signature. */
  getProjectionRange: (sheetId: string, cell: CellCoord) => CellRange | undefined;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook to manage a CellMetadataCache via the Worksheet API.
 *
 * Obtains the cache from ws.cellMetadata (memoized on workbook + sheetId),
 * evaluates the viewport when bounds change, and provides sync callbacks
 * matching RenderContextConfig signatures.
 *
 * @param options - Viewport bounds and sheet ID for cache evaluation
 * @returns Sync callbacks for the render loop
 *
 * @example
 * ```tsx
 * const { hasValidationErrors, isProjectedPosition, getProjectionSourcePosition, getProjectionRange } =
 * useCellMetadataCache({ sheetId, startRow: 0, startCol: 0, endRow: 50, endCol: 20 });
 *
 * // Pass to coordinator
 * coordinator.setRenderContextConfig({
 * hasValidationErrors,
 * isProjectedPosition,
 * getProjectionSourcePosition,
 * getProjectionRange,
 * });
 * ```
 */
export function useCellMetadataCache(
  options: UseCellMetadataCacheOptions,
): UseCellMetadataCacheResult {
  const { sheetId, startRow, startCol, endRow, endCol, onCacheUpdate } = options;
  const wb = useWorkbook();
  const activeSheetId = useActiveSheetId();

  // Obtain cache via Worksheet API — memoized on workbook + sheetId.
  // useWorksheet() creates a new WorksheetImpl per render (wb.getSheetById(id) is not cached),
  // so we memoize on wb + activeSheetId to keep the cache stable across renders.
  const cache = useMemo(() => {
    const ws = wb.getSheetById(activeSheetId);
    return ws.cellMetadata;
  }, [wb, activeSheetId]);

  // Notify parent when cache updates (for renderer invalidation).
  useEffect(() => {
    if (!onCacheUpdate) return;
    const unsub = cache.onChange(onCacheUpdate);
    return unsub;
  }, [cache, onCacheUpdate]);

  // Evaluate viewport when bounds or sheetId change.
  useEffect(() => {
    if (sheetId && startRow >= 0 && endRow >= startRow) {
      void cache.evaluateViewport(sheetId, startRow, startCol, endRow, endCol);
    }
  }, [cache, sheetId, startRow, startCol, endRow, endCol]);

  // ===========================================================================
  // Sync callbacks matching RenderContextConfig signatures
  // ===========================================================================

  const hasValidationErrors = useCallback(
    (_sheetId: string, cell: CellCoord): boolean => {
      return cache.hasValidationErrors(cell.row, cell.col);
    },
    [cache],
  );

  const isProjectedPosition = useCallback(
    (_sheetId: string, cell: CellCoord): boolean => {
      return cache.isProjectedPosition(cell.row, cell.col);
    },
    [cache],
  );

  const getProjectionSourcePosition = useCallback(
    (_sheetId: string, cell: CellCoord): CellCoord | undefined => {
      return cache.getProjectionSourcePosition(cell.row, cell.col);
    },
    [cache],
  );

  const getProjectionRange = useCallback(
    (_sheetId: string, cell: CellCoord): CellRange | undefined => {
      return cache.getProjectionRange(cell.row, cell.col);
    },
    [cache],
  );

  return {
    hasValidationErrors,
    isProjectedPosition,
    getProjectionSourcePosition,
    getProjectionRange,
  };
}
