/**
 * Search Executor
 *
 * Pure functions for executing search queries across cells.
 * Returns CellId-based results per Cell Identity Architecture.
 *
 * ARCHITECTURE:
 * - Results store CellId, not position (survives structure changes)
 * - Position resolved at navigation/render time via GridIndex
 * - Abstracted from Yjs via SearchDataProvider interface
 * - Sort by row-major or column-major order per search options
 *
 * @see docs/architecture/cell-identity.md
 */

import type { CellId } from '@mog-sdk/contracts/cell-identity';
import type { CellValue, SheetId } from '@mog-sdk/contracts/core';
import type { SearchOptions, SearchResult } from '@mog-sdk/contracts/search';

import { cellMatchesQuery, createMatcher, formatDisplayValue } from './search-utils';

// =============================================================================
// Data Provider Interface
// =============================================================================

/**
 * Data provider interface for search operations.
 * Abstracts data access to enable pure function testing.
 *
 * ARCHITECTURE:
 * The search module is completely decoupled from Yjs internals.
 */
export interface SearchDataProvider {
  /**
   * Get all sheet IDs in the workbook (for workbook-wide search).
   */
  getSheetIds(): SheetId[];

  /**
   * Get all cells in a sheet.
   * Returns cells sorted by position for consistent iteration order.
   * Order depends on direction option (row-major or column-major).
   *
   * @param sheetId - Sheet to iterate
   * @param direction - 'byRow' for row-major, 'byColumn' for column-major
   */
  getCellsInSheet(
    sheetId: SheetId,
    direction: 'byRow' | 'byColumn',
  ): Array<{
    cellId: CellId;
    row: number;
    col: number;
    displayValue: CellValue | null;
    formulaText: string | undefined;
  }>;

  /**
   * Get the current row/col bounds of the sheet.
   * Used for progress reporting.
   */
  getSheetBounds(sheetId: SheetId): { maxRow: number; maxCol: number } | null;
}

/**
 * Progress callback for long-running search operations.
 * Called periodically to report progress and check for cancellation.
 *
 * @param progress - Progress value from 0 to 1
 * @returns true to continue, false to cancel
 */
export type SearchProgressCallback = (progress: number) => boolean;

// =============================================================================
// Search Functions
// =============================================================================

/**
 * Search cells in a single sheet.
 *
 * @param provider - Data provider for cell access
 * @param sheetId - Sheet to search
 * @param query - Search query
 * @param options - Search options
 * @param onProgress - Optional progress callback
 * @returns Array of SearchResult (CellId-based, no positions stored)
 */
export function searchCells(
  provider: SearchDataProvider,
  sheetId: SheetId,
  query: string,
  options: SearchOptions,
  onProgress?: SearchProgressCallback,
): SearchResult[] {
  if (query.trim() === '') {
    return [];
  }

  const results: SearchResult[] = [];
  const matcher = createMatcher(query, options);

  // Get all cells sorted by position
  const cells = provider.getCellsInSheet(sheetId, options.direction);

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];

    // Report progress periodically
    if (onProgress && i % 1000 === 0) {
      const shouldContinue = onProgress(i / cells.length);
      if (!shouldContinue) {
        break; // Search cancelled
      }
    }

    // Convert display value to string
    const displayStr = formatDisplayValue(cell.displayValue);

    // Check for match
    const match = cellMatchesQuery(displayStr, cell.formulaText, options, matcher);

    if (match) {
      results.push({
        sheetId,
        cellId: cell.cellId,
        matchedText: match.text,
        matchStart: match.start,
        matchLength: match.length,
        isInFormula: match.isInFormula,
      });
    }
  }

  // Final progress report
  if (onProgress) {
    onProgress(1);
  }

  return results;
}

/**
 * Search cells in multiple sheets (workbook-wide search).
 *
 * @param provider - Data provider for cell access
 * @param query - Search query
 * @param options - Search options
 * @param startSheetId - Optional sheet to start from (for cycling through sheets)
 * @param onProgress - Optional progress callback
 * @returns Array of SearchResult sorted by sheet, then by direction
 */
export function searchWorkbook(
  provider: SearchDataProvider,
  query: string,
  options: SearchOptions,
  startSheetId?: SheetId,
  onProgress?: SearchProgressCallback,
): SearchResult[] {
  if (query.trim() === '') {
    return [];
  }

  const results: SearchResult[] = [];
  const sheetIds = provider.getSheetIds();

  if (sheetIds.length === 0) {
    return [];
  }

  // Calculate total cells for progress reporting
  let totalCells = 0;
  let processedCells = 0;

  for (const sheetId of sheetIds) {
    const bounds = provider.getSheetBounds(sheetId);
    if (bounds) {
      totalCells += (bounds.maxRow + 1) * (bounds.maxCol + 1);
    }
  }

  // Reorder sheets to start from startSheetId (for "Find Next" cycling)
  let orderedSheets = sheetIds;
  if (startSheetId) {
    const startIndex = sheetIds.indexOf(startSheetId);
    if (startIndex > 0) {
      orderedSheets = [...sheetIds.slice(startIndex), ...sheetIds.slice(0, startIndex)];
    }
  }

  // Search each sheet
  for (const sheetId of orderedSheets) {
    const sheetResults = searchCells(provider, sheetId, query, options, (sheetProgress) => {
      const bounds = provider.getSheetBounds(sheetId);
      const sheetCells = bounds ? (bounds.maxRow + 1) * (bounds.maxCol + 1) : 0;

      if (onProgress && totalCells > 0) {
        const overallProgress = (processedCells + sheetProgress * sheetCells) / totalCells;
        return onProgress(overallProgress);
      }
      return true;
    });

    results.push(...sheetResults);

    const bounds = provider.getSheetBounds(sheetId);
    if (bounds) {
      processedCells += (bounds.maxRow + 1) * (bounds.maxCol + 1);
    }
  }

  // Final progress
  if (onProgress) {
    onProgress(1);
  }

  return results;
}

/**
 * Search cells based on scope option (sheet or workbook).
 * Convenience function that dispatches to searchCells or searchWorkbook.
 *
 * @param provider - Data provider for cell access
 * @param query - Search query
 * @param options - Search options (includes scope)
 * @param activeSheetId - Current active sheet (for sheet scope)
 * @param onProgress - Optional progress callback
 * @returns Array of SearchResult
 */
export function searchInScope(
  provider: SearchDataProvider,
  query: string,
  options: SearchOptions,
  activeSheetId: SheetId,
  onProgress?: SearchProgressCallback,
): SearchResult[] {
  if (options.scope === 'workbook') {
    return searchWorkbook(provider, query, options, activeSheetId, onProgress);
  }
  return searchCells(provider, activeSheetId, query, options, onProgress);
}
