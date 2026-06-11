import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import type { ClipboardData, PasteSpecialOptions } from '@mog-sdk/contracts/actors';
import { normalizeRange } from './clipboard-utils';
import {
  executePaste,
  filterBlanks,
  filterByPasteType,
  getClipboardDimensions,
  transposeData,
  type PasteResult,
  type PasteStoreOperations,
  type PasteValidationViolation,
} from './paste-executor';

export interface PasteDimensions {
  rows: number;
  cols: number;
}

export function getRangeDimensions(range: CellRange): PasteDimensions {
  const normalized = normalizeRange(range);
  return {
    rows: normalized.endRow - normalized.startRow + 1,
    cols: normalized.endCol - normalized.startCol + 1,
  };
}

export function createDefaultTargetRange(
  target: CellCoord,
  dimensions: PasteDimensions,
): CellRange {
  return {
    startRow: target.row,
    startCol: target.col,
    endRow: target.row + Math.max(0, dimensions.rows - 1),
    endCol: target.col + Math.max(0, dimensions.cols - 1),
  };
}

export function resolveExecutionTargetRange(
  target: CellCoord,
  dimensions: PasteDimensions,
  requestedRange: CellRange | undefined,
  skipHiddenRows: boolean,
): CellRange {
  const fallback = createDefaultTargetRange(target, dimensions);
  if (!requestedRange || skipHiddenRows || dimensions.rows <= 0 || dimensions.cols <= 0) {
    return fallback;
  }

  const normalized = normalizeRange(requestedRange);
  const requestedSize = getRangeDimensions(normalized);
  if (
    requestedSize.rows <= 0 ||
    requestedSize.cols <= 0 ||
    requestedSize.rows % dimensions.rows !== 0 ||
    requestedSize.cols % dimensions.cols !== 0
  ) {
    return fallback;
  }

  return normalized;
}

export function getTileOrigins(targetRange: CellRange, dimensions: PasteDimensions): CellCoord[] {
  if (dimensions.rows <= 0 || dimensions.cols <= 0) return [];

  const origins: CellCoord[] = [];
  for (let row = targetRange.startRow; row <= targetRange.endRow; row += dimensions.rows) {
    for (let col = targetRange.startCol; col <= targetRange.endCol; col += dimensions.cols) {
      origins.push({ row, col });
    }
  }
  return origins;
}

function getProcessedDimensions(
  data: ClipboardData,
  options: PasteSpecialOptions,
): PasteDimensions {
  let processedData = data;
  if (options.transpose) {
    processedData = transposeData(processedData);
  }
  processedData = filterByPasteType(processedData, options);
  if (options.skipBlanks) {
    processedData = filterBlanks(processedData);
  }
  return getClipboardDimensions(processedData);
}

export async function executePasteIntoTargetRange(
  data: ClipboardData,
  target: CellCoord,
  sheetId: SheetId,
  options: PasteSpecialOptions,
  store: PasteStoreOperations,
  targetRange: CellRange,
): Promise<PasteResult> {
  const dimensions = getProcessedDimensions(data, options);
  const executionTargetRange = resolveExecutionTargetRange(
    target,
    dimensions,
    targetRange,
    !!(options.skipHiddenRows && store.isRowHidden),
  );
  const tileOrigins = getTileOrigins(executionTargetRange, dimensions);

  if (tileOrigins.length <= 1) {
    return executePaste(data, tileOrigins[0] ?? target, sheetId, options, store);
  }

  let cellCount = 0;
  const validationViolations: PasteValidationViolation[] = [];

  for (const tileOrigin of tileOrigins) {
    const result = await executePaste(data, tileOrigin, sheetId, options, store);
    if (!result.success) {
      return {
        ...result,
        affectedRange: executionTargetRange,
        cellCount,
      };
    }
    cellCount += result.cellCount;
    if (result.validationViolations) {
      validationViolations.push(...result.validationViolations);
    }
  }

  return {
    success: true,
    affectedRange: executionTargetRange,
    cellCount,
    validationViolations: validationViolations.length > 0 ? validationViolations : undefined,
  };
}
