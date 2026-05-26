/**
 * Grid Layers Factory
 *
 * Public API factory function that creates all grid layers with injected data
 * sources and returns them as a sorted array plus named references.
 *
 * Usage:
 * ```ts
 * const result = createGridLayers({
 *   positionIndex,
 *   mergeIndex,
 *   animationClock,
 *   cellData: myCellDataSource,
 *   selectionData: mySelectionDataSource,
 *   sheetData: mySheetDataSource,
 * });
 *
 * for (const layer of result.layers) {
 *   engine.addLayer(layer);
 * }
 * ```
 *
 * @module grid-renderer/factory
 */

import type { AnimationClock, CanvasLayer, TextMeasurer } from '@mog/canvas-engine';
import type {
  CellDataSource,
  CollaborationDataSource,
  GroupingDataSource,
  InteractiveElementCollector,
  PageBreakDataSource,
  SelectionDataSource,
  SheetDataSource,
  TraceDataSource,
} from '@mog-sdk/contracts/rendering';

import type { ViewportMergeIndex } from './coordinates/viewport-merge-index';
import type { ViewportPositionIndex } from './coordinates/viewport-position-index';
import type { CenterAcrossSpanProvider } from './cells/center-across';

import { BackgroundLayer } from './layers/background';
import { CellsLayer } from './layers/cells';
import { DividersLayer } from './layers/dividers';
import { HeadersLayer } from './layers/headers';
import { PageBreakLayer } from './layers/page-breaks';
import { RemoteCursorsLayer } from './layers/remote-cursors';
import { SelectionLayer } from './layers/selection';
import { StickyHeadersLayer } from './layers/sticky-headers';
import { TraceArrowsLayer } from './layers/trace-arrows';
import { UILayer } from './layers/ui';
import { ValidationCirclesLayer } from './layers/validation-circles';

import {
  NULL_CELL_DATA_SOURCE,
  NULL_COLLABORATION_DATA_SOURCE,
  NULL_GROUPING_DATA_SOURCE,
  NULL_PAGE_BREAK_DATA_SOURCE,
  NULL_SELECTION_DATA_SOURCE,
  NULL_SHEET_DATA_SOURCE,
  NULL_TRACE_DATA_SOURCE,
} from './data/defaults';

// =============================================================================
// Configuration
// =============================================================================

export interface GridLayersConfig {
  /** Viewport position index for row/col positions (required) */
  positionIndex: ViewportPositionIndex;
  /** Viewport merge index for merge lookups (required) */
  mergeIndex: ViewportMergeIndex;
  /** Animation clock for animated layers like marching ants (required) */
  animationClock: AnimationClock;
  /** Cell data source (values, formats, formulas) */
  cellData?: CellDataSource;
  /** Selection state (ranges, active cell, clipboard) */
  selectionData?: SelectionDataSource;
  /** Sheet properties (grid, theme, culture) */
  sheetData?: SheetDataSource;
  /** Collaboration data (remote cursors) */
  collaborationData?: CollaborationDataSource;
  /** Formula trace arrows */
  traceData?: TraceDataSource;
  /** Row/column grouping data */
  groupingData?: GroupingDataSource;
  /** Page break data */
  pageBreakData?: PageBreakDataSource;
  /** Text measurer for cell text rendering (required for CellsLayer) */
  textMeasurer?: TextMeasurer;
  /** Interactive element collector for hit-testable cell elements */
  interactiveElements?: InteractiveElementCollector;
  /** Optional binary cell reader for the cells layer hot path */
  binaryCellReader?: import('./layers/cells').BinaryCellReader;
  /** Per-viewport binary cell reader resolver */
  binaryCellReaderForViewport?: (
    viewportId: string,
  ) => import('./layers/cells').BinaryCellReader | undefined;
  /** Provider for precomputed Center Across Selection render spans */
  centerAcrossSpanProvider?: CenterAcrossSpanProvider;
}

// =============================================================================
// Result
// =============================================================================

export interface GridLayersResult {
  /** All layers sorted by z-index, ready for engine.addLayer() */
  readonly layers: ReadonlyArray<CanvasLayer>;

  /** Named references for direct access */
  readonly background: BackgroundLayer;
  readonly cells: CellsLayer | null;
  readonly selection: SelectionLayer;
  readonly ui: UILayer;
  readonly headers: HeadersLayer;
  readonly dividers: DividersLayer;
  readonly traceArrows: TraceArrowsLayer;
  readonly remoteCursors: RemoteCursorsLayer;
  readonly validationCircles: ValidationCirclesLayer;
  readonly pageBreaks: PageBreakLayer;
  readonly stickyHeaders: StickyHeadersLayer;

  /** Update all data sources at once */
  updateDataSources(config: Partial<GridLayersConfig>): void;

  /** Dispose all layers */
  dispose(): void;
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create all grid layers with injected data sources.
 *
 * Data sources default to null/empty implementations if not provided,
 * which makes the factory safe to call before data is available.
 *
 * The returned `layers` array is sorted by z-index and ready to be
 * added to a canvas engine instance.
 */
export function createGridLayers(config: GridLayersConfig): GridLayersResult {
  const { positionIndex, mergeIndex, animationClock } = config;

  const cellData = config.cellData ?? NULL_CELL_DATA_SOURCE;
  const selectionData = config.selectionData ?? NULL_SELECTION_DATA_SOURCE;
  const sheetData = config.sheetData ?? NULL_SHEET_DATA_SOURCE;
  const collaborationData = config.collaborationData ?? NULL_COLLABORATION_DATA_SOURCE;
  const traceData = config.traceData ?? NULL_TRACE_DATA_SOURCE;
  const groupingData = config.groupingData ?? NULL_GROUPING_DATA_SOURCE;
  const pageBreakData = config.pageBreakData ?? NULL_PAGE_BREAK_DATA_SOURCE;
  const textMeasurer = config.textMeasurer;
  const interactiveElementCollector = config.interactiveElements;

  // Create each layer with the appropriate data sources
  // z-index 0
  const background = new BackgroundLayer({
    sheet: sheetData,
    dimensions: positionIndex,
  });

  // z-index 100 (only created when textMeasurer is provided)
  const cells = textMeasurer
    ? new CellsLayer({
        cellData,
        sheetData,
        selectionData,
        positionIndex,
        mergeIndex,
        textMeasurer,
        interactiveElements: interactiveElementCollector,
        binaryCellReader: config.binaryCellReader,
        binaryCellReaderForViewport: config.binaryCellReaderForViewport,
        centerAcrossSpanProvider: config.centerAcrossSpanProvider,
      })
    : null;

  // z-index 125
  const validationCircles = new ValidationCirclesLayer(cellData, positionIndex, {}, sheetData);

  // z-index 150
  const pageBreaks = new PageBreakLayer(pageBreakData, positionIndex);

  // z-index 850 (above headers at 800 so selection border overlays header background)
  const selection = new SelectionLayer(selectionData, positionIndex, mergeIndex, sheetData);

  // z-index 250
  const traceArrows = new TraceArrowsLayer(traceData, positionIndex);

  // z-index 300
  const remoteCursors = new RemoteCursorsLayer(collaborationData, positionIndex);

  // z-index 400
  const ui = new UILayer(selectionData, sheetData, positionIndex, animationClock);

  // z-index 700
  const stickyHeaders = new StickyHeadersLayer(cellData, positionIndex);

  // z-index 800
  const headers = new HeadersLayer(sheetData, positionIndex, selectionData, groupingData);

  // z-index 900
  const dividers = new DividersLayer();

  // Collect all layers and sort by z-index
  const allLayers: (CanvasLayer | null)[] = [
    background, // z: 0
    cells, // z: 100 (null if no textMeasurer)
    validationCircles, // z: 125
    pageBreaks, // z: 150
    selection, // z: 850
    traceArrows, // z: 250
    remoteCursors, // z: 300
    ui, // z: 400
    stickyHeaders, // z: 700
    headers, // z: 800
    dividers, // z: 900
  ];
  const layers = allLayers
    .filter((l): l is CanvasLayer => l !== null)
    .sort((a, b) => a.zIndex - b.zIndex);

  return {
    layers,
    background,
    cells,
    selection,
    ui,
    headers,
    dividers,
    traceArrows,
    remoteCursors,
    validationCircles,
    pageBreaks,
    stickyHeaders,

    updateDataSources(update: Partial<GridLayersConfig>): void {
      if (update.sheetData) {
        background.setSheet(update.sheetData);
        cells?.updateDataSources({ sheetData: update.sheetData });
        validationCircles.setSheetData(update.sheetData);
        selection.setSheetData(update.sheetData);
        ui.setSheetData(update.sheetData);
        headers.setSheet(update.sheetData);
      }
      if (update.positionIndex) {
        background.setDimensions(update.positionIndex);
        cells?.updateDataSources({ positionIndex: update.positionIndex });
        validationCircles.setDimensions(update.positionIndex);
        pageBreaks.setDimensions(update.positionIndex);
        traceArrows.setDimensions(update.positionIndex);
        remoteCursors.setDimensions(update.positionIndex);
        stickyHeaders.setDimensions(update.positionIndex);
        headers.setPositionIndex(update.positionIndex);
      }
      if (update.mergeIndex) {
        cells?.updateDataSources({ mergeIndex: update.mergeIndex });
      }
      if (update.cellData) {
        cells?.updateDataSources({ cellData: update.cellData });
        validationCircles.setCellData(update.cellData);
        stickyHeaders.setCellData(update.cellData);
      }
      if (update.selectionData) {
        cells?.updateDataSources({ selectionData: update.selectionData });
        headers.setSelection(update.selectionData);
      }
      if (update.traceData) {
        traceArrows.setTraceData(update.traceData);
      }
      if (update.collaborationData) {
        remoteCursors.setCollaboration(update.collaborationData);
      }
      if (update.groupingData) {
        headers.setGrouping(update.groupingData);
      }
      if (update.pageBreakData) {
        pageBreaks.setPageBreakData(update.pageBreakData);
      }
      if (update.textMeasurer && cells) {
        cells.updateDataSources({ textMeasurer: update.textMeasurer });
      }
      if (update.interactiveElements && cells) {
        cells.updateDataSources({ interactiveElements: update.interactiveElements });
      }
      if (update.binaryCellReader !== undefined && cells) {
        cells.updateDataSources({ binaryCellReader: update.binaryCellReader });
      }
      if (update.binaryCellReaderForViewport !== undefined && cells) {
        cells.updateDataSources({
          binaryCellReaderForViewport: update.binaryCellReaderForViewport ?? undefined,
        });
      }
      if (update.centerAcrossSpanProvider !== undefined && cells) {
        cells.updateDataSources({
          centerAcrossSpanProvider: update.centerAcrossSpanProvider,
        });
      }
    },

    dispose(): void {
      for (const layer of layers) {
        layer.dispose();
      }
    },
  };
}
