/**
 * Clipboard Module
 *
 * Canonical clipboard format and service for cross-view copy/paste.
 * All views export TO and import FROM the ClipboardPayload format.
 *
 */

// Types
export type {
  ClipboardOperation,
  ClipboardPayload,
  ClipboardServiceState,
  ClipboardTableId,
  ClipboardViewId,
  ClipboardViewType,
  ColumnSchema,
  ColumnTypeKind,
  PasteOptions,
  SelectOption,
  SystemClipboardData,
  ViewClipboardContract,
} from './types';

// Clipboard Utilities
export { normalizeRange, parseCellKey } from './clipboard-utils';
export {
  hasFullShapeIntent,
  isDenseCoreCopyUnsafeForSource,
  isFullColumnRange,
  isFullRowRange,
  isFullShapeRange,
  isMatchingFullShapePaste,
} from './full-shape-ranges';

// Cell Value Contract
export {
  clipboardCellValueToText,
  fromClipboardCellValue,
  isClipboardCellError,
  toClipboardCellValue,
  toClipboardCellValues,
  type ClipboardInputCellValue,
} from './cell-value-contract';

// Service
export { ClipboardService, clipboardService } from './clipboard-service';

// Serializers
export { cellsToHTML, cellsToTSV, htmlToCells, inferValue, tsvToCells } from './serializers';

// Clipboard Data Builder
export {
  buildClipboardData,
  buildSparseClipboardData,
  getClipboardCellDisplayValue,
  type SparseClipboardCellEntry,
  type ClipboardStoreReader,
} from './clipboard-data-builder';

// Unified Operations
export {
  unifiedCopy,
  unifiedCut,
  unifiedPaste,
  writeToSystemClipboard,
  type UnifiedCopyCutDeps,
  type UnifiedPasteDeps,
} from './unified-paste';

// Paste Executor
export {
  applyArithmeticOperation,
  createCellReference,
  createDefaultPasteOptions,
  executePaste,
  filterBlanks,
  filterByPasteType,
  getClipboardDimensions,
  transposeData,
  type PasteStoreOperations,
} from './paste-executor';

// Paste Preview Calculator
export {
  calculatePastePreview,
  isPastePreviewAvailable,
  pasteOptionToSpecialOptions,
  type PastePreviewResult,
} from './paste-preview-calculator';

// Utilities
// Note: getClipboardDimensions is exported from paste-executor (works with ClipboardData)
// utils.ts has a different getClipboardDimensions that works with ClipboardPayload
export {
  convertPayloadForSchema,
  convertValueForType,
  extractColumn,
  extractRegion,
  extractRow,
  fitsInRegion,
  getColumnIndex,
  getColumnSchema,
  getClipboardDimensions as getPayloadDimensions,
  hasClipboardData,
  hasTableContext,
  isSameTable,
  isSameViewType,
  isTypeCompatible,
  mapColumnsByType,
  transposePayload,
  wouldOverflow,
} from './utils';
