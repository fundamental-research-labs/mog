/**
 * @mog/grid-renderer
 *
 * Spreadsheet cell painting — grid layers implementing CanvasLayer interface.
 * Each layer consumes typed data source interfaces and is independently testable.
 *
 * Dependencies: @mog/canvas-engine, @mog-sdk/contracts
 * No React, no DOM (except CanvasRenderingContext2D), no Yjs.
 */

// =============================================================================
// Base Layer
// =============================================================================

export { BaseLayer } from './layers/base-layer';
export type { BaseLayerConfig } from './layers/base-layer';

// =============================================================================
// Background Layer
// =============================================================================

export { BackgroundLayer, createBackgroundLayer } from './layers/background';
export type { BackgroundLayerConfig } from './layers/background';

// =============================================================================
// Layout
// =============================================================================

export { computeFrozenRange, computeVisibleRange } from './layout/compute-visible-range';
export { forEachVisibleCell } from './layout/for-each-visible-cell';
export { GridCoordinateSystem } from './layout/grid-coords';
export type { CellAddress, CellDocumentRect } from './layout/grid-coords';
export type { GridRenderRegion, VisibleCellCallback, VisibleCellInfo } from './layout/types';

// =============================================================================
// Viewports
// =============================================================================

export * from './viewports';

// =============================================================================
// Coordinates
// =============================================================================

export * from './coordinates';

// =============================================================================
// Shared
// =============================================================================

export * from './shared/border-styles';
export * from './shared/cell-bounds';
export * from './shared/constants';
export * from './shared/font-utils';
export * from './shared/theme-constants';

// =============================================================================
// Selection Layer
// =============================================================================

export { SelectionLayer, createSelectionLayer } from './layers/selection';
export type { SelectionLayerConfig } from './layers/selection';

// =============================================================================
// UI Layer
// =============================================================================

export { UILayer, createUILayer } from './layers/ui';
export type { UILayerConfig } from './layers/ui';

// =============================================================================
// Specialized Layers
// =============================================================================

export { TraceArrowsLayer, createTraceArrowsLayer } from './layers/trace-arrows';
export type { TraceArrowsLayerConfig } from './layers/trace-arrows';

export { RemoteCursorsLayer, createRemoteCursorsLayer } from './layers/remote-cursors';
export type { RemoteCursorsLayerConfig } from './layers/remote-cursors';

export { ValidationCirclesLayer, createValidationCirclesLayer } from './layers/validation-circles';
export type { ValidationCirclesLayerConfig } from './layers/validation-circles';

export { PageBreakLayer, createPageBreakLayer } from './layers/page-breaks';
export type { PageBreakLayerConfig } from './layers/page-breaks';

export { StickyHeadersLayer, createStickyHeadersLayer } from './layers/sticky-headers';
export type { StickyHeadersLayerConfig } from './layers/sticky-headers';

// =============================================================================
// Headers & Dividers
// =============================================================================

export { HeadersLayer, createHeadersLayer } from './layers/headers';
export type { HeadersLayerConfig } from './layers/headers';

export { DividersLayer, createDividersLayer } from './layers/dividers';
export type { DividersLayerConfig } from './layers/dividers';

// =============================================================================
// Cells Layer
// =============================================================================

export { CellsLayer, createCellsLayer } from './layers/cells';
export type { CellsLayerConfig } from './layers/cells';

// =============================================================================
// Cells Layer — Text Rendering
// =============================================================================

export type { CellRenderInfo } from './cells/types';
export type {
  CenterAcrossRenderSpan,
  CenterAcrossSourceCell,
  CenterAcrossSpanProvider,
} from './cells/center-across';

// Text rendering
export {
  buildCellFont,
  clearFontCache,
  computeBaselineY,
  getCellStyle,
  getDefaultAlignment,
  mapHorizontalAlign,
  mapVerticalAlign,
  renderNormalText,
  renderTextDecorations,
  truncateTextToFit,
} from './cells/text';
export type { CanvasHAlign, CanvasVAlign, OverflowResult, RenderTextOptions } from './cells/text';

// Text wrapping
export { renderWrappedText, wrapTextToLines } from './cells/text-wrap';
export type { RenderWrappedTextOptions } from './cells/text-wrap';

// Text overflow
export {
  calculateTextOverflow,
  canValueOverflow,
  clippedCellKey,
  getClippedCellText,
  getOverflowDirection,
  trackClippedCell,
} from './cells/text-overflow';
export type {
  CalculateTextOverflowParams,
  ClippedCellMap,
  OverflowDirection,
} from './cells/text-overflow';

// Shrink-to-fit
export { calculateShrunkFontSize, renderShrinkToFit } from './cells/shrink-to-fit';
export type { RenderShrinkToFitOptions } from './cells/shrink-to-fit';

// Rich text
export { buildSegmentFont, renderRichText, renderRichTextWrapped } from './cells/rich-text';
export type { RenderRichTextOptions } from './cells/rich-text';

// Rotated text
export { renderRotatedText, renderVerticalStackedText } from './cells/rotated-text';
export type { RenderRotatedTextOptions } from './cells/rotated-text';

// Alignment
export {
  parseAccountingText,
  renderAccountingText,
  renderCenterContinuousText,
  renderDistributedHorizontalText,
  renderDistributedVerticalText,
  renderFillAlignmentText,
  renderJustifyVerticalText,
} from './cells/alignment';
export type { CenterContinuousContext } from './cells/alignment';

// Value formatting
export { formatCellValue } from './cells/format-value';

// =============================================================================
// Cells Layer — Merged Cells, Indicators, CF Visuals
// =============================================================================

// Merged cells
export {
  computeCellBounds,
  createMergeTracker,
  getMergedCellRenderInfo,
  mergeKey,
} from './cells/merged-cells';
export type { CellBounds, MergeTracker, MergedCellRenderResult } from './cells/merged-cells';

// Cell indicators
export {
  isTableHeaderCell,
  renderBindingStatus,
  renderCheckbox,
  renderCommentIndicator,
  renderDropdownIndicator,
  renderFilterButton,
  renderValidationError,
} from './cells/indicators';

// Interactive elements
export {
  InteractiveElementCollectorImpl,
  collectInteractiveElements,
  createInteractiveElementCollector,
} from './cells/interactive-elements';
export type { InteractiveCellInfo } from './cells/interactive-elements';

// Data bars (conditional formatting)
export { renderDataBar, renderDataBarWithAxis } from './cells/data-bars';
export type { DataBarRenderOptions } from './cells/data-bars';

// Icon sets (conditional formatting)
export { getIconWidth, renderIcon } from './cells/icon-sets';
export type { IconRenderOptions } from './cells/icon-sets';

// Sparklines
export { SparklineRenderer, createSparklineRenderer } from './cells/sparklines';
export type { SparklineRendererConfig } from './cells/sparklines';

// =============================================================================
// Public API
// =============================================================================

export { createGridLayers } from './factory';
export type { GridLayersConfig, GridLayersResult } from './factory';
export type { BinaryCellReader } from './layers/cells';

// =============================================================================
// Hit Testing
// =============================================================================

export { GridHitTest, createGridHitTest } from './hit-test';
export type { GridHitTarget, GridHitTestConfig } from './hit-test';

// =============================================================================
// Features
// =============================================================================

export {
  DEFAULT_PIVOT_RENDERER_CONFIG,
  renderPivotTable,
  type PivotPosition,
  type PivotRenderData,
  type PivotRendererConfig,
} from './features/pivot-renderer';

// Table styles
export {
  ALL_STYLES,
  DARK_STYLES,
  DEFAULT_STYLE,
  LIGHT_STYLES,
  MEDIUM_STYLES,
  getTableStyleColors,
  type TableCellStyle,
  type TableStyleColors,
} from './features/table-styles';

// Outline renderer - row/column grouping outlines
export {
  OutlineHitTester,
  buildOutlineConfig,
  createOutlineHitTester,
  getColumnOutlineGutterHeight,
  getRowOutlineGutterWidth,
  getTotalColHeaderHeight,
  getTotalRowHeaderWidth,
  hitTestOutline,
  renderOutlines,
  type GroupingData,
  type OutlineHitTestResult,
  type OutlineRenderConfig,
  type OutlineRenderContext,
} from './features/outline-renderer';

// Formula range hit testing
export {
  calculateDraggedRange,
  getHandleCursor,
  hitTestFormulaRanges,
  type FormulaRangeDimensionProvider,
  type FormulaRangeHandleType,
  type FormulaRangeHitResult,
} from './features/formula-range-hit-test';

// Collaborator cursor rendering
export {
  renderCollaboratorCursors,
  type CollaboratorCursorData,
  type CollaboratorRenderContext,
} from './features/collaborator-cursor-renderer';

// Chart position utilities
export {
  calculateChartPixelPosition,
  type ChartPixelPosition,
  type ChartPosition,
} from './features/chart-position';

// =============================================================================
// Services
// =============================================================================

export {
  TextMeasurementServiceImpl,
  TextMeasurementServiceWithContext,
  computeSheetBounds,
  createTextMeasurementService,
  getTextMeasurementService,
  resetTextMeasurementService,
  type SheetBounds,
  type TextLayoutOptions,
  type TextLayoutResult,
} from './services/text-measurement-service';

// =============================================================================
// Overflow Index
// =============================================================================

export { OverflowIndex } from './overflow-index';

// =============================================================================
// Data Defaults
// =============================================================================

export {
  NULL_CELL_DATA_SOURCE,
  NULL_COLLABORATION_DATA_SOURCE,
  NULL_GROUPING_DATA_SOURCE,
  NULL_PAGE_BREAK_DATA_SOURCE,
  NULL_SELECTION_DATA_SOURCE,
  NULL_SHEET_DATA_SOURCE,
  NULL_TRACE_DATA_SOURCE,
} from './data/defaults';
