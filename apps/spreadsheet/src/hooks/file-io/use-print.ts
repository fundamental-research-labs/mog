/**
 * usePrint Hook
 *
 * Provides browser print functionality for the spreadsheet application.
 * Integrates with @mog/print-export for print operations.
 *
 * All data access goes through the unified Workbook/Worksheet API
 * Row heights and column widths are pre-fetched via batch methods before constructing
 * the ITableDataProvider, giving genuinely sync lookups with no `as unknown` casts.
 *
 * Features:
 * - Print to browser print dialog
 * - Print preview generation
 * - Page setup options (headers, footers, margins)
 * - Keyboard shortcut support (Ctrl+P)
 */

import { useCallback, useState } from 'react';

import type {
  ITableDataProvider,
  PageSetup,
  PrintArea,
  PrintOptions,
  PrintRange,
  PrintResult,
} from '@mog/print-export';
import { printHandler } from '@mog/print-export';

import type { Workbook } from '@mog-sdk/contracts/api';
import type { CellData, SheetId } from '@mog-sdk/contracts/core';

import { useWorkbook } from '../../infra/context';

// =============================================================================
// Types
// =============================================================================

export interface PrintState {
  /** Whether a print operation is currently in progress */
  isPrinting: boolean;

  /** Error message if print failed */
  error: string | null;

  /** Statistics from last successful print */
  lastPrintStats: PrintResult['stats'] | null;
}

export interface UsePrintOptions {
  /** Default print options */
  defaultPrintOptions?: Partial<PrintOptions>;

  /** Default page setup */
  defaultPageSetup?: PageSetup;

  /** File name for header/footer placeholders */
  fileName?: string;

  /** Callback when print starts */
  onPrintStart?: () => void;

  /** Callback when print completes */
  onPrintComplete?: (result: PrintResult) => void;

  /** Callback when print fails */
  onPrintError?: (error: string) => void;
}

export interface UsePrintReturn {
  /** Current print state */
  state: PrintState;

  /** Open browser print dialog */
  print: (
    options?: Partial<PrintOptions>,
    pageSetup?: PageSetup,
    areas?: PrintArea[],
  ) => Promise<boolean>;

  /** Generate print preview HTML */
  generatePreview: (
    options?: Partial<PrintOptions>,
    pageSetup?: PageSetup,
    areas?: PrintArea[],
  ) => Promise<string>;

  /** Print current selection only */
  printSelection: (options?: Partial<PrintOptions>, pageSetup?: PageSetup) => Promise<boolean>;

  /** Reset error state */
  clearError: () => void;
}

// =============================================================================
// Data Provider Adapter
// =============================================================================

/**
 * Pre-fetch dimensions and create an ITableDataProvider for a specific sheet.
 * Row heights and column widths are pre-fetched via batch methods so the sync
 * getRowHeight/getColumnWidth methods use genuine Map lookups (no `as unknown` casts).
 */
async function createTableDataProviderForSheet(
  wb: Workbook,
  sheetId: SheetId,
): Promise<ITableDataProvider> {
  // Pre-fetch dimensions for sync provider lookups.
  // ws.getUsedRange() returns a structured `CellRange | null` — use the
  // 0-based row/col fields directly. (The previous code matched A1 strings
  // off the value, which returned `undefined` and silently skipped the
  // batch pre-fetch.)
  const ws = wb.getSheetById(sheetId);
  const usedRange = await ws.getUsedRange();
  let rowHeightMap = new Map<number, number>();
  let colWidthMap = new Map<number, number>();

  if (usedRange) {
    const [rowHeights, colWidths] = await Promise.all([
      ws.layout.getRowHeightsBatch(usedRange.startRow, usedRange.endRow),
      ws.layout.getColWidthsBatch(usedRange.startCol, usedRange.endCol),
    ]);
    rowHeightMap = new Map(rowHeights);
    colWidthMap = new Map(colWidths);
  }

  return {
    async getCellData(_sid: string, row: number, col: number): Promise<CellData | undefined> {
      const cellData = await ws.getCell(row, col);
      if (!cellData || cellData.value == null) return undefined;
      return cellData;
    },

    async getCellsInRange(
      _sid: string,
      range: PrintRange,
    ): Promise<Array<{ row: number; col: number; data: CellData }>> {
      const result: Array<{ row: number; col: number; data: CellData }> = [];
      const rangeData = await ws.getRange(
        range.startRow,
        range.startCol,
        range.endRow,
        range.endCol,
      );
      if (rangeData) {
        for (let r = 0; r < rangeData.length; r++) {
          for (let c = 0; c < rangeData[r].length; c++) {
            const cellData = rangeData[r][c];
            if (cellData && cellData.value != null) {
              result.push({
                row: range.startRow + r,
                col: range.startCol + c,
                data: cellData,
              });
            }
          }
        }
      }
      return result;
    },

    async getUsedRange(_sid: string): Promise<PrintRange | undefined> {
      const usedRange = await ws.getUsedRange();
      if (!usedRange) return undefined;
      // ws.getUsedRange() returns a structured `CellRange | null` with
      // 0-based fields — pass them through.
      return {
        startRow: usedRange.startRow,
        startCol: usedRange.startCol,
        endRow: usedRange.endRow,
        endCol: usedRange.endCol,
      };
    },

    getColumnWidth(_sid: string, col: number): number {
      return colWidthMap.get(col) ?? 100;
    },

    getRowHeight(_sid: string, row: number): number {
      return rowHeightMap.get(row) ?? 21;
    },

    async getSheetName(_sid: string): Promise<string> {
      return (await ws.getName()) ?? 'Sheet';
    },
  };
}

// =============================================================================
// Hook Implementation
// =============================================================================

const initialState: PrintState = {
  isPrinting: false,
  error: null,
  lastPrintStats: null,
};

export function usePrint(
  activeSheetId: SheetId,
  selection?: { startRow: number; startCol: number; endRow: number; endCol: number },
  options: UsePrintOptions = {},
): UsePrintReturn {
  const {
    defaultPrintOptions,
    defaultPageSetup,
    fileName,
    onPrintStart,
    onPrintComplete,
    onPrintError,
  } = options;

  const wb = useWorkbook();
  const [state, setState] = useState<PrintState>(initialState);

  // Print to browser
  const print = useCallback(
    async (
      printOptions?: Partial<PrintOptions>,
      pageSetup?: PageSetup,
      areas?: PrintArea[],
    ): Promise<boolean> => {
      setState({
        ...initialState,
        isPrinting: true,
      });

      onPrintStart?.();

      try {
        const dataProvider = await createTableDataProviderForSheet(wb, activeSheetId);

        const result = await printHandler.print({
          dataProvider,
          sheetId: activeSheetId,
          printOptions: { ...defaultPrintOptions, ...printOptions },
          pageSetup: pageSetup ?? defaultPageSetup,
          areas,
          fileName,
          onPrintDialogOpen: () => {
            // Print dialog is opening
          },
          onPrintDialogClose: () => {
            // Print dialog closed
          },
        });

        setState((prev) => ({
          ...prev,
          isPrinting: false,
          error: result.success ? null : (result.error ?? 'Print failed'),
          lastPrintStats: result.stats,
        }));

        if (result.success) {
          onPrintComplete?.(result);
          return true;
        } else {
          onPrintError?.(result.error ?? 'Print failed');
          return false;
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Print failed';
        setState((prev) => ({
          ...prev,
          isPrinting: false,
          error: errorMsg,
        }));
        onPrintError?.(errorMsg);
        return false;
      }
    },
    [
      wb,
      activeSheetId,
      defaultPrintOptions,
      defaultPageSetup,
      fileName,
      onPrintStart,
      onPrintComplete,
      onPrintError,
    ],
  );

  // Generate print preview
  const generatePreview = useCallback(
    async (
      printOptions?: Partial<PrintOptions>,
      pageSetup?: PageSetup,
      areas?: PrintArea[],
    ): Promise<string> => {
      const dataProvider = await createTableDataProviderForSheet(wb, activeSheetId);
      return printHandler.generatePreview({
        dataProvider,
        sheetId: activeSheetId,
        printOptions: { ...defaultPrintOptions, ...printOptions },
        pageSetup: pageSetup ?? defaultPageSetup,
        areas,
        fileName,
      });
    },
    [wb, activeSheetId, defaultPrintOptions, defaultPageSetup, fileName],
  );

  // Print current selection
  const printSelection = useCallback(
    async (printOptions?: Partial<PrintOptions>, pageSetup?: PageSetup): Promise<boolean> => {
      if (!selection) {
        // No selection, print entire sheet
        return print(printOptions, pageSetup);
      }

      // Create print area from selection
      const areas: PrintArea[] = [
        {
          sheetId: activeSheetId,
          range: {
            startRow: selection.startRow,
            startCol: selection.startCol,
            endRow: selection.endRow,
            endCol: selection.endCol,
          },
        },
      ];

      return print(printOptions, pageSetup, areas);
    },
    [selection, activeSheetId, print],
  );

  // Clear error
  const clearError = useCallback(() => {
    setState((prev) => ({
      ...prev,
      error: null,
    }));
  }, []);

  return {
    state,
    print,
    generatePreview,
    printSelection,
    clearError,
  };
}
