/**
 * Shell Utilities - Barrel Export
 *
 * UI-related utilities for the spreadsheet shell.
 */

// Auto-correct
export {
  DEFAULT_AUTO_CORRECT_OPTIONS,
  addCustomCorrection,
  autoCorrect,
  containsUrl,
  getCorrection,
  type AutoCorrectOptions,
  type AutoCorrectResult,
} from './auto-correct';

// Clipboard text parsing (canonical location: domain/clipboard/)
export {
  detectFormat,
  parseCSV,
  parseClipboardText,
  parseTSV,
} from '../../domain/clipboard/clipboard-parser';

// Clipboard utilities (HTML parsing, range export)
export {
  parseHTML,
  rangeToHTML,
  rangeToTSV,
  type MergeInfo,
  type ParsedHTMLData,
  type RangeExportOptions,
} from './clipboard-utils';

// Naming utilities
export { collectSheetNames, getUniqueSheetName, type NamingContext } from './naming';

// Range manager
export {
  RangeManager,
  RangeSpatialIndex,
  colIndexToLetter,
  letterToColIndex,
} from './range-manager';

// Selection utilities
export { getCellsFromRanges, getRangeDescription } from './selection-utils';

// System preferences
export {
  DEFAULT_LINE_HEIGHT,
  DEFAULT_PAGE_MULTIPLIER,
  clearPreferencesCache,
  getScrollLineHeight,
  getSystemScrollPreferences,
  prefersReducedMotion,
  subscribeToMotionPreference,
} from './system-preferences';

// Workbook statistics
export {
  formatEndOfSheet,
  formatStatValue,
  getSheetStatistics,
  getWorkbookStatistics,
  type ImageCountProvider,
  type SheetStatistics,
  type WorkbookStatistics,
} from './workbook-statistics';

// Zoom utilities
export {
  clampZoom,
  formatZoomPercent,
  getZoomLevel,
  nearestPreset,
  parseZoomPercent,
  zoomIn,
  zoomOut,
} from './zoom-utils';

export {
  calculateZoomToSelection,
  type ZoomToSelectionHeaderVisibility,
  type ZoomToSelectionParams,
  type ZoomToSelectionPositionDimensions,
  type ZoomToSelectionResult,
} from './zoom-to-selection';

// Navigation utilities
export {
  findDataEdge,
  findLastUsedCell,
  getUsedRange,
  type CellValueGetter,
  type MergedRegionGetter,
  type VisibilityChecker,
} from './navigation-utils';
