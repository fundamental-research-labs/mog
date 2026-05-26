// @mog/spreadsheet-utils
// Runtime utility functions extracted from @mog-sdk/contracts.
// Individual modules are available via sub-path exports (e.g., "@mog/spreadsheet-utils/a1").

// A1 notation utilities
export {
  cellRangeToA1,
  cellRangeToSheetA1,
  colToLetter,
  letterToCol,
  parseA1,
  parseA1Range,
  quoteSheetName,
  toA1,
  toSheetA1,
} from './a1';

// Error utilities
export { ERROR_DISPLAY_MAP, errorDisplayString, isCellError } from './errors';

// Range utilities (includes both range.ts and range-navigation.ts functions)
export {
  containsRange,
  getAbsoluteResizedRange,
  getBoundingRect,
  getCellRange,
  getColumn,
  getColumnsAfter,
  getColumnsBefore,
  getEntireColumn,
  getEntireRow,
  getIntersection,
  getLastCell,
  getLastColumn,
  getLastRow,
  getOffsetRange,
  getRangeSize,
  getResizedRange,
  getRow,
  getRowsAbove,
  getRowsBelow,
  isCellInRange,
  isCellRange,
  iterateRange,
  normalizeRange,
  rangesEqual,
  rangesOverlap,
  singleCellRange,
} from './range';

// Rich text utilities
export {
  applyFormat,
  fromPlainText,
  getRichTextLength,
  hasAnyFormatting,
  hasFormatting,
  isEmptyRichText,
  isRichText,
  normalizeRichText,
  rawToCellValue,
  toPlainText,
} from './rich-text';

// Function registry
export { FunctionRegistry, globalRegistry } from './function-registry';

// Protection utilities
export {
  hashExcelPassword,
  invalidRangeError,
  protectionError,
  sheetNotFoundError,
  successResult,
  verifyExcelPassword,
} from './protection';
