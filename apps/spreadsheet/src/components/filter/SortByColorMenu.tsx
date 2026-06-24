/**
 * SortByColorMenu Component
 *
 * Filter Dropdown Enhancements - Sort by Color
 *
 * Provides a submenu to sort data by cell background color or font color.
 * Shows unique colors in the column with color swatches.
 *
 * ARCHITECTURE:
 * - Uses Mutations.sortRangeByColumn for sorting
 * - Extracts unique colors from column cells
 * - Supports sorting with color at top
 *
 */

import type { CellId } from '@mog-sdk/contracts/cell-identity';
import type { SheetId } from '@mog-sdk/contracts/core';
import { cellRangeToA1 } from '@mog/spreadsheet-utils/a1';
import React, { useEffect, useState } from 'react';
import { useWorkbook } from '../../infra/context';
import { MenuItem, MenuSeparator } from '@mog/shell/components/ui';
import { getUniqueColors } from './filter-utils';

export interface SortByColorMenuProps {
  sheetId: SheetId;
  filterId: string;
  headerCellId: CellId;
  /** 0-based column index (from FilterButtonMetadata.col) */
  col: number;
  /** Called to close the submenu */
  onClose: () => void;
  /** Called when sort is applied */
  onSortApplied?: () => void;
}

/**
 * Sort by Color submenu with background/font color options
 */
export function SortByColorMenu({
  sheetId,
  filterId,
  headerCellId,
  col,
  onClose,
  onSortApplied,
}: SortByColorMenuProps): React.ReactElement {
  const wb = useWorkbook();

  // Get filter and resolve range (async)
  const [backgroundColors, setBackgroundColors] = useState<string[]>([]);
  const [fontColors, setFontColors] = useState<string[]>([]);
  const [range, setRange] = useState<import('@mog-sdk/contracts/core').CellRange | null>(null);
  const [columnIndex, setColumnIndex] = useState(col);
  useEffect(() => {
    let stale = false;
    void (async () => {
      const ws = wb.getSheetById(sheetId);

      // Get filter info (includes resolved range)
      const filterInfo = await ws.filters.getInfo(filterId);
      if (!filterInfo || stale) return;

      const resolvedRange = filterInfo.range;

      // Get all data rows in the filter range
      const rows: number[] = [];
      for (let row = resolvedRange.startRow + 1; row <= resolvedRange.endRow; row++) {
        rows.push(row);
      }

      // Extract unique colors using col directly (no batchGetCellPositions needed)
      const bgColors = await getUniqueColors(ws, rows, col, 'fill');
      const fgColors = await getUniqueColors(ws, rows, col, 'font');
      if (!stale) {
        setBackgroundColors(bgColors);
        setFontColors(fgColors);
        setRange(resolvedRange);
        setColumnIndex(col);
      }
    })();
    return () => {
      stale = true;
    };
  }, [wb, sheetId, filterId, headerCellId, col]);

  /**
   * Handle color selection for sorting.
   * Sorts the range by the selected color, placing matched rows on top.
   */
  const handleColorSort = async (color: string, type: 'fill' | 'font') => {
    if (!range || columnIndex < 0) {
      console.warn('[SortByColorMenu] Cannot sort: missing range or column');
      onClose();
      return;
    }

    const ws = wb.getSheetById(sheetId);
    try {
      await ws.sortByColor(cellRangeToA1(range), {
        column: columnIndex,
        colorType: type,
        color,
        position: 'top',
        hasHeaders: true,
        visibleRowsOnly: true,
      });

      onSortApplied?.();
      onClose();
    } catch (error) {
      console.error('[SortByColorMenu] Failed to sort by color:', error);
    }
  };

  const hasColors = backgroundColors.length > 0 || fontColors.length > 0;

  if (!hasColors) {
    return (
      <div className="sort-by-color-menu p-3 text-body-sm text-ss-text-secondary">
        No colors found in this column
      </div>
    );
  }

  return (
    <div className="sort-by-color-menu flex max-h-[min(480px,calc(100vh-16px))] flex-col overflow-y-auto overscroll-contain">
      {backgroundColors.length > 0 && (
        <>
          <div className="px-3 py-1.5 text-caption font-medium text-ss-text-secondary">
            Sort by Cell Color
          </div>
          {backgroundColors.map((color) => (
            <MenuItem key={`bg-${color}`} onSelect={() => void handleColorSort(color, 'fill')}>
              <div
                className="w-4 h-4 border border-ss-border rounded mr-2"
                style={{ backgroundColor: color }}
                data-color={color}
                data-color-type="fill"
              />
              On Top
            </MenuItem>
          ))}
        </>
      )}

      {fontColors.length > 0 && (
        <>
          {backgroundColors.length > 0 && <MenuSeparator />}
          <div className="px-3 py-1.5 text-caption font-medium text-ss-text-secondary">
            Sort by Font Color
          </div>
          {fontColors.map((color) => (
            <MenuItem key={`font-${color}`} onSelect={() => void handleColorSort(color, 'font')}>
              <div
                className="w-4 h-4 border border-ss-border rounded flex items-center justify-center mr-2"
                data-color={color}
                data-color-type="font"
              >
                <span style={{ color }}>A</span>
              </div>
              On Top
            </MenuItem>
          ))}
        </>
      )}
    </div>
  );
}
