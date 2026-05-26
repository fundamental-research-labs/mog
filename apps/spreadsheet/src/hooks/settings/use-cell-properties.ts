/**
 * Cell Properties Hook
 *
 * React hook that provides reactive access to a cell's properties (format + metadata).
 * Reads from ViewportBuffer (populated from Rust) instead of Yjs domain modules.
 *
 * Subscribes to cell property changes via the coordinator, ensuring the hook re-renders
 * when the cell's format or metadata changes.
 *
 * This hook solves the toolbar reactivity bug where format changes didn't trigger
 * React re-renders because the toolbar only depended on selection.activeCell.
 *
 * @see docs/renderer/README.md - Coordinator Pattern
 */

import { useCallback, useEffect, useState } from 'react';

import type { CellFormat, CellMetadata, CellProperties, SheetId } from '@mog-sdk/contracts/core';

import { useWorkbook } from '../../infra/context';
import { useCoordinator } from '../shared/use-coordinator';

// =============================================================================
// HOOK RETURN TYPE
// =============================================================================

export interface UseCellPropertiesReturn {
  /** Full cell properties (format + metadata) */
  properties: CellProperties | undefined;

  /** Cell format (font, colors, alignment, etc.) */
  format: CellFormat | undefined;

  /** Cell metadata (provenance, validation, etc.) - excludes format */
  metadata: CellMetadata | undefined;
}

// =============================================================================
// HELPER FUNCTION
// =============================================================================

/**
 * Extract metadata from properties (excludes format field)
 */
function extractMetadata(props: CellProperties | undefined): CellMetadata | undefined {
  if (!props) return undefined;

  const { format: _, ...metadata } = props;
  // Return undefined if no metadata fields are set
  if (Object.keys(metadata).length === 0) return undefined;
  return metadata as CellMetadata;
}

// =============================================================================
// HOOK IMPLEMENTATION
// =============================================================================

/**
 * Hook for reactive access to a cell's properties.
 *
 * Uses the coordinator pattern - subscribes to cell property changes via
 * the coordinator, not directly to the EventBus. When the cell's format
 * or metadata changes, the hook re-renders with the new values.
 *
 * @param sheetId - Sheet ID
 * @param row - Row index (0-based)
 * @param col - Column index (0-based)
 * @returns Object containing properties, format, and metadata
 *
 * @example
 * ```tsx
 * function ToolbarBoldButton() {
 * const { activeSheetId } = useActiveSheetId;
 * const { activeCell } = useSelection;
 * const { format } = useCellProperties(activeSheetId, activeCell.row, activeCell.col);
 *
 * // `format.bold` updates immediately when bold changes!
 * return (
 * <button
 * className={format?.bold ? 'active' : ''}
 * onClick={ => toggleBold}
 * >
 * B
 * </button>
 * );
 * }
 * ```
 */
export function useCellProperties(
  sheetId: SheetId,
  row: number,
  col: number,
): UseCellPropertiesReturn {
  const coordinator = useCoordinator();
  const wb = useWorkbook();

  // Read from viewport — check active cell first, fall back to viewport cell
  const readProperties = useCallback((): CellProperties | undefined => {
    const vp = wb.getSheetById(sheetId).viewport;

    // For the active cell, use getActiveCellData (has full format)
    const activeCell = vp.getActiveCellData();
    if (activeCell) {
      // Check if this is the active cell by matching position
      const cellData = vp.getCellData(row, col);
      if (cellData && cellData.cellId === activeCell.cellId) {
        const format = activeCell.format as CellFormat | undefined;
        if (format) {
          return { format } as CellProperties;
        }
        return undefined;
      }
    }

    // For non-active viewport cells, read from getCellData
    const cellData = vp.getCellData(row, col);
    if (cellData?.format) {
      return { format: cellData.format as CellFormat } as CellProperties;
    }
    return undefined;
  }, [wb, sheetId, row, col]);

  const [properties, setProperties] = useState<CellProperties | undefined>(readProperties);

  const refreshProperties = useCallback(() => {
    setProperties(readProperties());
  }, [readProperties]);

  // Subscribe to property changes via coordinator
  useEffect(() => {
    // Re-read initial value when cell changes
    refreshProperties();

    // Subscribe to changes
    const unsubscribe = coordinator.grid.subscribeToCellPropertyChanges(
      sheetId,
      row,
      col,
      refreshProperties,
    );

    return unsubscribe;
  }, [coordinator, sheetId, row, col, refreshProperties]);

  return {
    properties,
    format: properties?.format,
    metadata: extractMetadata(properties),
  };
}
