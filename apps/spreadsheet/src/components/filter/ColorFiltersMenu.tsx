/**
 * ColorFiltersMenu Component
 *
 * B4: Filter Dropdown Panel - Color filter submenu
 *
 * Provides filtering by cell background or font color.
 * Shows unique colors in the column with color swatches.
 *
 * ARCHITECTURE:
 * - Extracts unique colors from column cells
 * - Applies the selected color criterion through the Worksheet API
 */

import type { SheetId } from '@mog-sdk/contracts/core';
import React, { useEffect, useState } from 'react';
import { useWorkbook } from '../../infra/context';
import { MenuItem, MenuSeparator } from '@mog/shell/components/ui';
import { getUniqueColors } from './filter-utils';

type FilterOperationReceipt = {
  readonly status: string;
  readonly effects: readonly unknown[];
  readonly diagnostics: readonly { severity?: string; message?: string }[];
};

function filterReceiptError(receipt: unknown, fallback: string): string | null {
  if (typeof receipt !== 'object' || receipt === null) return null;
  const maybe = receipt as Partial<FilterOperationReceipt>;
  if (
    typeof maybe.status !== 'string' ||
    !Array.isArray(maybe.effects) ||
    !Array.isArray(maybe.diagnostics)
  ) {
    return null;
  }
  if (maybe.status !== 'failed' && maybe.status !== 'unsupported' && maybe.status !== 'noOp') {
    return null;
  }
  return (
    maybe.diagnostics.find((diagnostic) => diagnostic.severity === 'error')?.message ??
    maybe.diagnostics[0]?.message ??
    fallback
  );
}

export interface ColorFiltersMenuProps {
  sheetId: SheetId;
  filterId: string;
  /** 0-based column index (from FilterButtonMetadata.col) */
  col?: number;
  /** Called to close the submenu */
  onClose: () => void;
}

/**
 * Color filters submenu with background/font color options
 *
 * Applies the selected color criterion directly through the Worksheet API.
 */
export function ColorFiltersMenu({
  sheetId,
  filterId,
  col,
  onClose,
}: ColorFiltersMenuProps): React.ReactElement {
  const wb = useWorkbook();

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
  }, [wb, sheetId, filterId, col]);

  const handleColorSelect = async (color: string, type: 'fill' | 'font') => {
    if (col === undefined) return;
    try {
      const ws = wb.getSheetById(sheetId);
      const receipt = await ws.filters.setColumnFilter(
        col,
        {
          type: 'color',
          colorFilter: { type, color },
        },
        filterId,
      );
      const error = filterReceiptError(receipt, 'Color filter did not apply.');
      if (error) {
        console.error(error, receipt);
        return;
      }
      onClose();
    } catch (error) {
      console.error('[ColorFiltersMenu] Failed to apply color filter:', error);
    }
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
    <div className="color-filters-menu flex max-h-[min(480px,calc(100vh-16px))] flex-col overflow-y-auto overscroll-contain">
      {backgroundColors.length > 0 && (
        <>
          <div className="px-3 py-1.5 text-caption font-medium text-ss-text-secondary">
            Filter by Cell Color
          </div>
          {backgroundColors.map((color) => (
            <MenuItem key={`bg-${color}`} onSelect={() => void handleColorSelect(color, 'fill')}>
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
            <MenuItem key={`font-${color}`} onSelect={() => void handleColorSelect(color, 'font')}>
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
