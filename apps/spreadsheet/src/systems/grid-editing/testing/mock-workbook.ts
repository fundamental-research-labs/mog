import type { WorkbookInternal } from '@mog-sdk/contracts/api';
import type { CellValue, SheetId } from '@mog-sdk/contracts/core';
import { displayString, sheetId as toSheetId, type CellRange } from '@mog-sdk/contracts/core';
import type { Direction } from '@mog-sdk/contracts/machines';
import type { CellCoord } from '@mog-sdk/contracts/rendering';

import { findDataEdge, type CellValueGetter } from '../../../infra/utils/navigation-utils';
import type { TestSheetConfig } from './test-sheet-context';

interface TestWorkbookConfig extends TestSheetConfig {
  viewportBuffer?: {
    getCellData?: (row: number, col: number) => any;
    getMerges?: () => Array<{
      start_row: number;
      start_col: number;
      end_row: number;
      end_col: number;
    }>;
  };
  formats?: Record<string, { numberFormat?: string | null }>;
}

function normalizeSheetId(sheetId: string | SheetId | undefined): SheetId {
  return typeof sheetId === 'string' ? toSheetId(sheetId) : (sheetId ?? toSheetId('sheet-1'));
}

function toViewportMerge(range: CellRange): {
  start_row: number;
  start_col: number;
  end_row: number;
  end_col: number;
} {
  return {
    start_row: range.startRow,
    start_col: range.startCol,
    end_row: range.endRow,
    end_col: range.endCol,
  };
}

function getConfigCellValue(
  config: TestWorkbookConfig,
  row: number,
  col: number,
): CellValue | null {
  const value = config.cells?.[`${row},${col}`];
  return value === undefined ? null : (value as CellValue | null);
}

function getViewportCellValue(
  config: TestWorkbookConfig,
  row: number,
  col: number,
): CellValue | undefined {
  const cellData = config.viewportBuffer?.getCellData?.(row, col);
  if (cellData && 'value' in cellData) return cellData.value as CellValue;
  const configValue = getConfigCellValue(config, row, col);
  return configValue === null ? undefined : configValue;
}

function getMergedRegion(config: TestWorkbookConfig, row: number, col: number): CellRange | null {
  const merge = config.merges?.find(
    (range) =>
      row >= range.startRow && row <= range.endRow && col >= range.startCol && col <= range.endCol,
  );
  return merge ?? null;
}

/**
 * Minimal editable WorkbookInternal for grid-editing tests.
 *
 * Use this for tests that exercise workbook-backed edit entry or action
 * handlers that call the worksheet API, while keeping the implementation small
 * enough to make missing contract methods visible.
 */
export function createEditableTestWorkbook(config: TestWorkbookConfig = {}): WorkbookInternal {
  const testSheetId = normalizeSheetId(config.sheetId);
  const hiddenRows = new Set(config.hiddenRows ?? []);
  const hiddenCols = new Set(config.hiddenCols ?? []);
  const viewportMerges =
    config.viewportBuffer?.getMerges?.() ?? (config.merges ?? []).map(toViewportMerge);

  const getCellValue: CellValueGetter = (row, col) => getViewportCellValue(config, row, col);
  const isHidden = (row: number, col: number): boolean =>
    hiddenRows.has(row) || hiddenCols.has(col);

  const worksheet = {
    sheetId: testSheetId,
    name: 'Sheet1',
    getName: async () => 'Sheet1',
    protection: {
      canEditCellFast: () => true,
      canEditCell: async () => true,
      isProtected: async () => false,
    },
    getActiveCellEditSource: () => null,
    viewport: {
      getCellData: (row: number, col: number) => {
        const cellData = config.viewportBuffer?.getCellData?.(row, col);
        if (cellData) return cellData;

        const value = getConfigCellValue(config, row, col);
        if (value === null) return null;
        return {
          row,
          col,
          value,
          displayText: String(value),
          editText: String(value),
          hasFormula: false,
        };
      },
      getMerges: () => viewportMerges,
      getActiveCellData: () => null,
      getActiveCellFormula: () => null,
      hasComment: () => false,
    },
    layout: {
      getHiddenRowsBitmap: async () => hiddenRows,
      getHiddenColumnsBitmap: async () => hiddenCols,
      isRowHidden: (row: number) => hiddenRows.has(row),
      isColumnHidden: (col: number) => hiddenCols.has(col),
      setColumnWidth: async () => {},
      setRowHeight: async () => {},
    },
    structure: {
      getMergedRegions: async () => config.merges ?? [],
      merge: async () => {},
      unmerge: async () => {},
    },
    validations: {
      peek: () => null,
      get: async () => null,
      getDropdownItems: async () => [],
    },
    formats: {
      set: async () => {},
      get: async (row: number, col: number) => config.formats?.[`${row},${col}`] ?? {},
    },
    conditionalFormats: {
      add: async () => ({ id: 'cf-test' }),
    },
    comments: {
      get: async () => null,
    },
    getValue: async (row: number, col: number) => getViewportCellValue(config, row, col) ?? null,
    getValueForEditing: async (row: number, col: number) => {
      const cellData = config.viewportBuffer?.getCellData?.(row, col);
      if (cellData?.editText !== undefined) return String(cellData.editText);
      if (cellData?.displayText !== undefined && cellData.displayText !== null) {
        return displayString(cellData.displayText);
      }
      const value = getConfigCellValue(config, row, col);
      return value == null ? '' : String(value);
    },
    findDataEdge: async (row: number, col: number, direction: Direction): Promise<CellCoord> =>
      findDataEdge({ row, col }, direction, getCellValue, 1_048_575, 16_383, isHidden, (r, c) =>
        getMergedRegion(config, r, c),
      ),
    clearData: async () => {},
    getUsedRange: async () => null,
    getRange: async () => [],
    setCells: async () => {},
    _internal: {
      relocateCells: async () => {},
      relocateCellsToSheet: async () => {},
      copyRangeToSheet: async () => {},
      setRangeSchemaFromClipboard: async () => {},
    },
  };

  const workbook = {
    activeSheet: worksheet,
    getActiveSheet: () => worksheet,
    getSheet: () => worksheet,
    getSheetById: () => worksheet,
    setPendingUndoDescription: () => {},
    undoGroup: (fn: () => unknown) => fn(),
    on: () => () => {},
  };

  return workbook as unknown as WorkbookInternal;
}
