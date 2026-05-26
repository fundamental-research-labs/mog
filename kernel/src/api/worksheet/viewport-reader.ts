/**
 * Viewport Reader Factory
 *
 * Creates a ViewportReader — a sync render-path data accessor that provides
 * binary buffer access, error mapping, and cell accessor lookup for a sheet.
 *
 * Extracted from WorksheetImpl._createViewportReader().
 */

import type {
  ActiveCellInfo,
  BinaryCellData,
  BinaryViewportReader,
  ViewportBounds,
  ViewportCellData,
  ViewportColDimension,
  ViewportMergeRegion,
  ViewportReader,
  ViewportRowDimension,
} from '@mog-sdk/contracts/api';
import type { CellError, CellValue } from '@mog-sdk/contracts/core';
import { displayStringOrNull } from '@mog-sdk/contracts/core';

import type { ComputeBridge } from '../../bridges/compute/compute-bridge';
import type { CellAccessor } from '../../bridges/wire/binary-viewport-buffer';
import type { ReadonlyBinaryViewportBuffer } from '../../bridges/wire/viewport-coordinator';

/** Map Rust error display strings to ErrorVariant names. */
const DISPLAY_TO_VARIANT: Record<string, CellError['value']> = {
  '#NULL!': 'Null',
  '#DIV/0!': 'Div0',
  '#VALUE!': 'Value',
  '#REF!': 'Ref',
  '#NAME?': 'Name',
  '#NUM!': 'Num',
  '#N/A': 'Na',
  '#GETTING_DATA': 'GettingData',
  '#SPILL!': 'Spill',
  '#CALC!': 'Calc',
};

/**
 * Create a ViewportReader for the given sheet, backed by the compute bridge.
 *
 * The ViewportReader provides sync access to per-viewport binary buffers,
 * cell data, merges, dimensions, and active cell info.
 */
export function createViewportReader(sheetId: string, bridge: ComputeBridge): ViewportReader {
  /**
   * Find a per-viewport CellAccessor that contains the given cell.
   * Tries all per-viewport accessors for the current sheet.
   * Returns the accessor positioned at the cell, or null if not found.
   */
  function findAccessorForCell(row: number, col: number): CellAccessor | null {
    const states = bridge.getPerViewportStates();
    for (const [vpId] of states) {
      // Only check viewports belonging to this sheet
      if (!vpId.endsWith(':' + sheetId)) continue;
      const accessor = bridge.getAccessorForViewport(vpId);
      if (accessor && accessor.moveTo(row, col)) {
        return accessor;
      }
    }
    return null;
  }

  /**
   * Get the sheet-level geometry buffer.
   *
   * Frozen and split layouts maintain multiple per-viewport buffers for one
   * sheet. The sheet-level ViewportReader backs the position index, so it must
   * not pick an arbitrary small pane such as frozen-corner; that leaves the
   * first unfrozen rows/cols to default sizes and makes pane boundaries overlap.
   */
  function getSheetBuffer(): ReadonlyBinaryViewportBuffer | null {
    const states = bridge.getPerViewportStates();
    const suffix = ':' + sheetId;
    let best: ReadonlyBinaryViewportBuffer | null = null;
    let bestArea = -1;

    for (const [vpId] of states) {
      if (!vpId.endsWith(suffix)) continue;

      const buf = bridge.getViewportBuffer(vpId);
      if (!buf || !buf.hasBuffer()) continue;

      if (vpId === `main${suffix}`) {
        return buf;
      }

      const bounds = buf.getBounds();
      const rows = bounds ? Math.max(0, bounds.endRow - bounds.startRow + 1) : 0;
      const cols = bounds ? Math.max(0, bounds.endCol - bounds.startCol + 1) : 0;
      const area = rows * cols;
      if (area > bestArea) {
        best = buf;
        bestArea = area;
      }
    }

    return best;
  }

  /** Extract typed CellValue from a cell accessor based on valueType tag. */
  function readCellValue(accessor: CellAccessor): CellValue {
    // valueType bits 0-2: Null=0, Number=1, Text=2, Bool=3, Error=4
    switch (accessor.valueType) {
      case 1:
        return accessor.numberValue;
      case 2:
        return displayStringOrNull(accessor.displayText);
      case 3:
        return accessor.numberValue !== 0;
      case 4: {
        const errStr = accessor.errorText || '#VALUE!';
        const errValue: CellError['value'] = DISPLAY_TO_VARIANT[errStr] ?? 'Value';
        return { type: 'error', value: errValue } as CellError;
      }
      default:
        return null; // Null (0) or unknown
    }
  }

  const binary: BinaryViewportReader = {
    getCellData(row: number, col: number): BinaryCellData | null {
      const accessor = findAccessorForCell(row, col);
      if (!accessor) return null;
      return { row, col };
    },
    getBuffer(): ArrayBuffer | null {
      return null; // Raw buffer not exposed through API layer
    },
    isReady(): boolean {
      return getSheetBuffer()?.hasBuffer() ?? false;
    },
  };

  return {
    getCellData(row: number, col: number): ViewportCellData | null {
      // getCellData is NOT in the hot render path — it's for programmatic API access.
      // The render loop uses CellAccessor.moveTo() directly via per-viewport accessors.
      const accessor = findAccessorForCell(row, col);
      if (!accessor) {
        return null;
      }
      const cellValue = readCellValue(accessor);
      return {
        row,
        col,
        value: cellValue,
        displayText: accessor.displayText,
        hasFormula: accessor.hasFormula,
        hasComment: accessor.hasComment,
        hasSparkline: accessor.hasSparkline,
        hasHyperlink: accessor.hasHyperlink,
        error: accessor.errorText || undefined,
        format: accessor.format,
      };
    },
    getActiveCellData(): ActiveCellInfo | null {
      const data = bridge.getActiveCellData();
      if (!data) return null;
      return {
        cellId: data.cellId,
        value: data.value as ActiveCellInfo['value'],
        formula: data.formula,
        format: data.format,
        metadata: data.metadata,
        editText: data.editText,
        isFormulaHidden: data.isFormulaHidden,
        hyperlinkUrl: data.hyperlinkUrl,
        numberFormat: data.numberFormat,
      };
    },
    getMerges(): ViewportMergeRegion[] {
      return getSheetBuffer()?.getMerges() ?? [];
    },
    hasComment(row: number, col: number): boolean {
      const accessor = findAccessorForCell(row, col);
      return accessor !== null && accessor.hasComment;
    },
    getRowDimension(row: number): ViewportRowDimension | null {
      return getSheetBuffer()?.getRowDimension(row) ?? null;
    },
    getColDimension(col: number): ViewportColDimension | null {
      return getSheetBuffer()?.getColDimension(col) ?? null;
    },
    getBounds(): ViewportBounds | null {
      return getSheetBuffer()?.getBounds() ?? null;
    },
    getRowPositions(): Float64Array | null {
      return getSheetBuffer()?.getRowPositions() ?? null;
    },
    getColPositions(): Float64Array | null {
      return getSheetBuffer()?.getColPositions() ?? null;
    },
    binary,
    get binaryCellReader() {
      // Lazily resolve: try all per-viewport accessors for this sheet
      const states = bridge.getPerViewportStates();
      for (const [vpId] of states) {
        if (!vpId.endsWith(':' + sheetId)) continue;
        const accessor = bridge.getAccessorForViewport(vpId);
        if (accessor) return accessor;
      }
      // No per-viewport accessor found yet; contract allows null
      return null;
    },
    // Per-viewport accessor resolver
    binaryCellReaderForViewport: (viewportId: string) => {
      return bridge.getAccessorForViewport(viewportId);
    },
  };
}
