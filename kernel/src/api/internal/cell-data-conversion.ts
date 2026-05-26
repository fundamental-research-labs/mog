/**
 * Cell Data Conversion Utilities
 *
 * Provides conversion between the three cell data representations:
 * - CellWriteData: write input for Cells.set() (Pick of StoreCellData)
 * - StoreCellData: read output from Cells.getData()
 * - CellData: high-level Worksheet API type
 */

import type { CellValue } from '@mog-sdk/contracts/core';
import type { CellWriteData, StoreCellData } from '@mog-sdk/contracts/store';
import type { CellData } from '@mog-sdk/contracts/core';

/**
 * Convert StoreCellData (read output) to CellWriteData (write input).
 * Enables read-then-write workflows without manual field mapping.
 *
 * @deprecated Since CellWriteData is now a Pick of StoreCellData, you can
 * destructure directly: `const { raw, formula } = storeData;`
 * This helper is kept for backward compatibility.
 */
export function toCellWriteData(data: StoreCellData): CellWriteData {
  const { raw, formula, identityFormula, computed } = data;
  return {
    raw,
    ...(formula !== undefined && { formula }),
    ...(identityFormula !== undefined && { identityFormula }),
    ...(computed !== undefined && { computed }),
  };
}

/**
 * @deprecated Renamed to toCellWriteData(). This alias will be removed in a future release.
 */
export const toKernelCellData = toCellWriteData;

/**
 * Convert StoreCellData (read output) to CellData (Worksheet API type).
 * Useful when bridging between namespace and OOP APIs.
 */
export function toCellData(data: StoreCellData): CellData {
  const result: CellData = {
    value: data.computed ?? (data.raw as CellValue),
  };
  if (data.formula !== undefined) {
    result.formula = data.formula;
  }
  if (data.note !== undefined) {
    result.comment = data.note;
  }
  if (data.hyperlink !== undefined) {
    result.hyperlink = data.hyperlink;
  }
  return result;
}
