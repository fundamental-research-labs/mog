/**
 * ColorFiltersMenu Component
 *
 * B4: Filter Dropdown Panel - Color filter submenu
 *
 * Provides filtering by cell background or font color.
 * Shows unique colors in the column with color swatches.
 *
 * ARCHITECTURE:
 * - Uses Draft + Apply pattern: stores pending config in UIStore, then dispatches
 * - Extracts unique colors from column cells
 * - Dispatches APPLY_COLOR_FILTER to apply the filter
 */

import type { CellId } from '@mog-sdk/contracts/cell-identity';
import type { SheetId } from '@mog-sdk/contracts/core';
import React, { useEffect, useState } from 'react';
import { dispatch } from '../../actions';
import { useActionDependencies } from '../../hooks/toolbar/use-action-dependencies';
import { useUIStore, useWorkbook } from '../../infra/context';
import { MenuItem, MenuSeparator } from '@mog/shell/components/ui';
import { getUniqueColors } from './filter-utils';

export interface ColorFiltersMenuProps {
  sheetId: SheetId;
  filterId: string;
  headerCellId: CellId;
  /** 0-based column index (from FilterButtonMetadata.col) */
  col?: number;
  /** Called to close the submenu */
  onClose: () => void;
}

/**
 * Color filters submenu with background/font color options
 *
 * Uses Draft + Apply pattern:
 * 1. Store pending config in UIStore via setPendingColorFilter
 * 2. Dispatch APPLY_COLOR_FILTER to apply
 */
export function ColorFiltersMenu({
  sheetId,
  filterId,
  headerCellId,
  col,
  onClose,
}: ColorFiltersMenuProps): React.ReactElement {
  const wb = useWorkbook();
  const deps = useActionDependencies();
  const setPendingColorFilter = useUIStore((s) => s.setPendingColorFilter);

  // Get filter and resolve range (async)
  const [backgroundColors, setBackgroundColors] = useState<string[]>([]);
  const [fontColors, setFontColors] = useState<string[]>([]);
  useEffect(() => {
    if (col === undefined) {
      setBackgroundColors([]);
      setFontColors([]);
      return;
    }
    let stale = false;
    void (async () => {
      const ws = wb.getSheetById(sheetId);

      // Get filter info (includes resolved range)
      const filterInfo = await ws.filters.getInfo(filterId);
      if (!filterInfo || stale) {
        setBackgroundColors([]);
        setFontColors([]);
        return;
      }

      const range = filterInfo.range;

      // Get all data rows in the filter range
      const rows: number[] = [];
      for (let row = range.startRow + 1; row <= range.endRow; row++) {
        rows.push(row);
      }

      // Extract unique colors using col directly (no batchGetCellPositions needed)
      const bgColors = await getUniqueColors(ws, rows, col, 'fill');
      const fgColors = await getUniqueColors(ws, rows, col, 'font');
      if (!stale) {
        setBackgroundColors(bgColors);
        setFontColors(fgColors);
      }
    })();
    return () => {
      stale = true;
    };
  }, [wb, sheetId, filterId, headerCellId, col]);

  /**
   * Handle color selection.
   * Uses Draft + Apply pattern: store config, then dispatch.
   */
  const handleColorSelect = (color: string, type: 'fill' | 'font') => {
    // Store pending config in UIStore (Draft step)
    setPendingColorFilter({
      filterId,
      headerCellId,
      col,
      colorType: type,
      color,
    });

    // Dispatch to apply filter (Apply step)
    dispatch('APPLY_COLOR_FILTER', deps);
    onClose();
  };

  const hasColors = backgroundColors.length > 0 || fontColors.length > 0;

  if (!hasColors) {
    return (
      <div className="color-filters-menu p-3 text-body-sm text-ss-text-secondary">
        No colors found in this column
      </div>
    );
  }

  return (
    <div className="color-filters-menu flex flex-col">
      {backgroundColors.length > 0 && (
        <>
          <div className="px-3 py-1.5 text-caption font-medium text-ss-text-secondary">
            Filter by Cell Color
          </div>
          {backgroundColors.map((color) => (
            <MenuItem key={`bg-${color}`} onSelect={() => handleColorSelect(color, 'fill')}>
              <div
                className="w-4 h-4 border border-ss-border rounded mr-2"
                style={{ backgroundColor: color }}
                data-color={color}
                data-color-type="fill"
              />
              {color}
            </MenuItem>
          ))}
        </>
      )}

      {fontColors.length > 0 && (
        <>
          {backgroundColors.length > 0 && <MenuSeparator />}
          <div className="px-3 py-1.5 text-caption font-medium text-ss-text-secondary">
            Filter by Font Color
          </div>
          {fontColors.map((color) => (
            <MenuItem key={`font-${color}`} onSelect={() => handleColorSelect(color, 'font')}>
              <div
                className="w-4 h-4 border border-ss-border rounded flex items-center justify-center mr-2"
                data-color={color}
                data-color-type="font"
              >
                <span style={{ color }}>A</span>
              </div>
              {color}
            </MenuItem>
          ))}
        </>
      )}
    </div>
  );
}
