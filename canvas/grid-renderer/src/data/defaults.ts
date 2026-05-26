/**
 * Data Source Defaults
 *
 * Default/null implementations of data source interfaces for testing
 * and initial state before data sources are connected.
 */

import { getDefaultCulture } from '@mog/culture';
import type {
  CellDataSource,
  CollaborationDataSource,
  GroupingDataSource,
  PageBreakDataSource,
  SelectionDataSource,
  SheetDataSource,
  TraceDataSource,
} from '@mog-sdk/contracts/rendering';
import { DEFAULT_CHROME_THEME } from '../shared/constants';
import {
  DEFAULT_RESOLVED_SHEET_VIEW_SKIN,
  DEFAULT_SHIMMER_CONFIG,
} from '@mog-sdk/contracts/rendering';
import { OFFICE_THEME } from '../shared/theme-constants';

export const NULL_CELL_DATA_SOURCE: CellDataSource = {
  getCellValue: () => undefined,
  getCellFormat: () => undefined,
  getCellBindingStatus: () => undefined,
  getSparklineRenderData: () => undefined,
  getTableAtCell: () => undefined,
  hasTableColumnFilter: () => false,
  getFilterHeaderInfo: () => undefined,
  hasValidationErrors: () => false,
  showZeroValues: true,
  dropdownCells: new Set(),
};

export const NULL_SELECTION_DATA_SOURCE: SelectionDataSource = {
  getSelectionState: () => ({
    // SelectionSnapshot fields
    ranges: [],
    activeCell: { row: 0, col: 0 },
    isSelecting: false,
    isFormulaMode: false,
    isDraggingFillHandle: false,
    isRightDraggingFillHandle: false,
    direction: 'down-right' as const,
    hasFullRowSelection: false,
    hasFullColumnSelection: false,
    selectedRows: new Set<number>(),
    selectedCols: new Set<number>(),
    fullySelectedRows: new Set<number>(),
    fullySelectedCols: new Set<number>(),
    isDraggingCells: false,
    dragSourceRange: null,
    dragTargetCell: null,
    dragMode: 'move' as const,
    isResizingHeader: false,
    resizeType: null,
    resizeIndex: null,
    resizeCurrentSize: null,
    isResizingTable: false,
    tableResizeId: null,
    tableResizeStartBounds: null,
    tableResizeTargetRow: null,
    tableResizeTargetCol: null,
    // SelectionRenderState extension fields
    formulaRanges: [],
    activeReferenceIndex: -1,
    fillPreviewRange: undefined,
    pastePreview: undefined,
    flashFillPreview: undefined,
    hasError: false,
    errorType: undefined,
    tablePreviewRange: null,
  }),
  getEditorState: () => ({
    isEditing: false,
    isFormulaEditing: false,
    editingCell: null,
    sheetId: null,
    mergeBounds: null,
    value: '',
    hasConflict: false,
    isIMEComposing: false,
  }),
  getClipboardState: () => ({
    hasCopy: false,
    hasCut: false,
    cutSource: null,
    copySource: null,
    isPasting: false,
    sourceSheetId: null,
  }),
  getSearchHighlights: () => [],
  getPastePreview: () => null,
  getDragDropState: () => null,
  getTablePreviewRange: () => null,
  hasError: () => false,
};

export const NULL_SHEET_DATA_SOURCE: SheetDataSource = {
  sheetId: '',
  totalRows: 1048576,
  totalCols: 16384,
  showGridlines: true,
  gridlineColor: '#e0e0e0',
  theme: OFFICE_THEME,
  culture: getDefaultCulture(),
  rightToLeft: false,
  showFormulas: false,
  showRowHeaders: true,
  showColumnHeaders: true,
  showCutCopyIndicator: true,
  allowDragFill: true,
  validationCirclesVisible: false,
  previewFont: null,
  blockedEditAttempt: null,
  chromeTheme: DEFAULT_CHROME_THEME,
  sheetViewSkin: DEFAULT_RESOLVED_SHEET_VIEW_SKIN,
  shimmerEntries: [],
  shimmerEffect: DEFAULT_SHIMMER_CONFIG.effect,
  shimmerDurationMs: DEFAULT_SHIMMER_CONFIG.durationMs,
  shimmerColor: DEFAULT_SHIMMER_CONFIG.color,
  shimmerMaxOpacity: DEFAULT_SHIMMER_CONFIG.maxOpacity,
  shimmerEnabled: DEFAULT_SHIMMER_CONFIG.enabled,
};

export const NULL_COLLABORATION_DATA_SOURCE: CollaborationDataSource = {
  getRemoteCursors: () => [],
};

export const NULL_TRACE_DATA_SOURCE: TraceDataSource = {
  getTraceArrows: () => [],
  getCellPositionForTrace: () => null,
};

export const NULL_GROUPING_DATA_SOURCE: GroupingDataSource = {
  getGroupingConfig: () => null,
  getRowGroups: () => [],
  getColumnGroups: () => [],
  getRowOutlineLevels: () => [],
  getColumnOutlineLevels: () => [],
  maxRowOutlineLevel: 0,
  maxColOutlineLevel: 0,
};

export const NULL_PAGE_BREAK_DATA_SOURCE: PageBreakDataSource = {
  pageBreakPreviewMode: false,
  getPageBreaks: () => ({ rowBreaks: [], colBreaks: [] }),
  getAutoPageBreaks: () => ({ rowBreaks: [], colBreaks: [] }),
  getPrintArea: () => null,
  getPageBreakDragState: () => null,
};
