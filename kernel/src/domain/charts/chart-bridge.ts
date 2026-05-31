/**
 * Chart Bridge
 *
 * Bridges the standalone charts library (@mog/charts) to the engine.
 * This bridge handles:
 * - Compiled marks caching (invalidated on data/spec changes)
 * - EventBus subscriptions for reactive updates
 * - Error state management
 * - Data resolution from CellIdRange to actual values
 *
 * Paint is synchronous — see `renderCached` / `onCacheUpdate` /
 * `ensureCompiled`. Mark compilation is async (data fetch + extract +
 * compile, all real work) but never executes on the paint path; the cache
 * breaks the coupling. The shape mirrors `ImageCache.getImage` / `onLoad`
 * for pictures: async producer, sync consumer, listener-driven repaint.
 *
 * Do NOT re-async `renderCached`: the canvas dispatch loop is sync and
 * applies a `(viewport.x, viewport.y)` translate around every floating
 * object's paint. An async paint method's `await` chain resolves after the
 * engine has restored that translate, and the chart paints in the wrong
 * canvas frame. The async chart paint canvas-state invariant depends on
 * this remaining synchronous.
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md (sections 7, 8)
 */

import {
  collectMarks,
  compile,
  configToSpec,
  extractChartData,
  extractChartDataFromRange,
  type CellDataAccessor,
  type ChartData,
  type CompileResult,
  type DataRow,
} from '@mog/charts';
import type {
  ChartBounds,
  ChartDataResult,
  ChartError,
  ChartErrorCode,
  ChartLayoutRect,
  ChartLayoutSnapshot,
  ChartMark,
  ChartRenderSnapshot,
  IChartBridge,
} from '@mog-sdk/contracts/bridges';
import { type CellRange, type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type {
  AxisType,
  ChartConfig,
  ChartExportOptionsSnapshot,
  ChartType,
} from '@mog-sdk/contracts/data/charts';
import type {
  CellChangedEvent,
  CellsBatchChangedEvent,
  ChartUpdatedEvent,
  FloatingObjectCreatedEvent,
  FloatingObjectDeletedEvent,
  FloatingObjectUpdatedEvent,
  RowsInsertedEvent,
  RowsDeletedEvent,
  ColumnsInsertedEvent,
  ColumnsDeletedEvent,
  SheetDeletedEvent,
} from '@mog-sdk/contracts/events';
import { parseCellRange, cellRangeToA1 } from '@mog/spreadsheet-utils/a1';
import { getValue } from '../cells/cell-reads';
import { get as getChart, getAll as getAllCharts, update as updateChart } from './chart-store';
import {
  resolveChartRangeReferences,
  type ResolvedChartRangeReferences,
} from './chart-range-references';
import type { ChartFloatingObject } from '../../bridges/compute/compute-bridge';
import { normalizeImportedComboChart } from '../../bridges/compute/chart-import-normalization';
import {
  wireToAxisConfig,
  wireToDataLabelConfig,
  wireToLegendConfig,
  wireToSeriesConfigArray,
} from './chart-type-converters';
import { hasImportStatus, isChartPayload } from './bridge/import-render-status';
import { normalizeChartDataForRendering } from './bridge/chart-render-data-normalizer';
import { isPositionOnlyUpdate } from './bridge/position-only-update';
import {
  buildResolvedChartSpecSnapshot,
  defaultExportOptionsForSize,
  hashJson,
} from './bridge/resolved-spec-snapshot';
import {
  renderChartError,
  renderChartMarks,
  renderChartPlaceholder,
} from './bridge/chart-renderer';
import { ChartRenderCache } from './bridge/chart-render-cache';
import {
  applyWorkbookThemeColors,
  loadWorkbookThemeColorPalette,
  type ChartWorkbookThemeColorPalette,
  type WorkbookThemeBridge,
} from './bridge/theme-colors';
import {
  isCellHidden,
  loadHiddenVisibility,
  withHiddenSeriesFiltered,
  type HiddenCellVisibility,
  type HiddenDimensionBridge,
} from './bridge/hidden-visibility';

import type { DocumentContext } from '../../context/types';

export { isPositionOnlyUpdate } from './bridge/position-only-update';

// =============================================================================
// Chart Layout Types — the narrow ChartLayoutSnapshot used by this
// bridge now lives in contracts so IChartBridge can declare the same return
// type. See contracts/src/bridges/chart-bridge.ts.
// =============================================================================

/**
 * Normalize wire AxisData to populate legacy aliases that the charts rendering
 * package reads (xAxis/yAxis/secondaryYAxis and per-axis type/show).
 */
function normalizeAxisForRendering(axis: NonNullable<ChartConfig['axis']>): ChartConfig['axis'] {
  const normAxis = (a: (typeof axis)['categoryAxis']) =>
    a
      ? { ...a, type: (a.type ?? a.axisType) as AxisType | undefined, show: a.show ?? a.visible }
      : a;
  return {
    ...axis,
    xAxis: normAxis(axis.categoryAxis ?? axis.xAxis),
    yAxis: normAxis(axis.valueAxis ?? axis.yAxis),
    secondaryYAxis: normAxis(axis.secondaryValueAxis ?? axis.secondaryYAxis),
  };
}

/**
 * Convert a ChartFloatingObject to a ChartConfig for passing to the charts library.
 * Provides defaults for required fields that are optional in the gen type.
 */
function toChartConfig(chart: ChartFloatingObject): ChartConfig {
  const normalizedChart = normalizeImportedComboChart(chart);
  return {
    type: (normalizedChart.chartType ?? 'bar') as ChartType,
    anchorRow: normalizedChart.anchor.anchorRow,
    anchorCol: normalizedChart.anchor.anchorCol,
    width: normalizedChart.widthCells ?? normalizedChart.width ?? 4,
    height: normalizedChart.heightCells ?? normalizedChart.height ?? 10,
    dataRange: normalizedChart.dataRange ?? '',
    seriesRange: normalizedChart.seriesRange,
    categoryRange: normalizedChart.categoryRange,
    seriesOrientation: normalizedChart.seriesOrientation as ChartConfig['seriesOrientation'],
    title: normalizedChart.title,
    subtitle: normalizedChart.subtitle,
    // Narrow wire shapes to public *Config at the boundary — see
    // chart-type-converters.ts for why this is not a cast.
    legend: normalizedChart.legend ? wireToLegendConfig(normalizedChart.legend) : undefined,
    axis: normalizedChart.axis
      ? normalizeAxisForRendering(wireToAxisConfig(normalizedChart.axis))
      : undefined,
    colors: normalizedChart.colors,
    series: normalizedChart.series ? wireToSeriesConfigArray(normalizedChart.series) : undefined,
    dataLabels: normalizedChart.dataLabels
      ? wireToDataLabelConfig(normalizedChart.dataLabels)
      : undefined,
    pieSlice: normalizedChart.pieSlice,
    trendline: Array.isArray(normalizedChart.trendline)
      ? normalizedChart.trendline[0]
      : normalizedChart.trendline,
    trendlines: normalizedChart.trendline,
    showLines: normalizedChart.showLines,
    smoothLines: normalizedChart.smoothLines,
    radarFilled: normalizedChart.radarFilled,
    radarMarkers: normalizedChart.radarMarkers,
    waterfall: normalizedChart.waterfall as ChartConfig['waterfall'],
    displayBlanksAs: normalizedChart.displayBlanksAs as ChartConfig['displayBlanksAs'],
    plotVisibleOnly: normalizedChart.plotVisibleOnly,
    gapWidth: normalizedChart.gapWidth,
    overlap: normalizedChart.overlap,
    doughnutHoleSize: normalizedChart.doughnutHoleSize,
    firstSliceAngle: normalizedChart.firstSliceAngle,
    bubbleScale: normalizedChart.bubbleScale,
    splitType: normalizedChart.splitType as ChartConfig['splitType'],
    splitValue: normalizedChart.splitValue,
    style: normalizedChart.style,
    chartFormat: normalizedChart.chartFormat as ChartConfig['chartFormat'],
    plotFormat: normalizedChart.plotFormat as ChartConfig['plotFormat'],
    titleFormat: normalizedChart.titleFormat as ChartConfig['titleFormat'],
    subType: normalizedChart.subType as ChartConfig['subType'],
    extra: normalizedChart.ooxml,
  };
}

type ChartRenderData = {
  config: ChartConfig;
  data: ChartData;
};

// =============================================================================
// Chart WASM acceleration (optional — injected by compute-bridge)
// =============================================================================

/** Typed interface for chart WASM exports injected from compute-bridge. */
export interface ChartWasmExports {
  /** Index signature for compatibility with generic WASM module loaders. */
  [fn_name: string]: (...args: unknown[]) => unknown;
  chart_apply_transforms: (data: unknown, transforms: unknown) => unknown;
  chart_compute_regression: (
    points: unknown,
    method: unknown,
    degree: unknown,
    options: unknown,
  ) => unknown;
  chart_compute_stacking: (inputs: unknown, mode: unknown) => unknown;
  chart_compute_bins: (values: unknown, maxbins: unknown, step: unknown, nice: unknown) => unknown;
  chart_compute_statistics: (values: unknown) => unknown;
  chart_compute_density: (values: unknown, bandwidth: unknown, steps: unknown) => unknown;
}

let chartWasmExports: ChartWasmExports | null = null;

/**
 * Initialize the chart WASM backend.
 * Called by compute-bridge after loading @mog-sdk/wasm.
 */
export function initChartWasm(exports: ChartWasmExports): void {
  chartWasmExports = exports;
}

/**
 * Check if chart WASM module is available.
 */
function isChartWasmAvailable(): boolean {
  return chartWasmExports !== null;
}

/**
 * Try to apply transforms via WASM. Returns transformed DataRow[] or null if WASM unavailable.
 */
function tryWasmTransforms(data: DataRow[], transforms: unknown[]): DataRow[] | null {
  if (!isChartWasmAvailable()) return null;

  try {
    const result = chartWasmExports!.chart_apply_transforms(data, transforms);
    return result as DataRow[];
  } catch (err) {
    console.warn('[ChartBridge] WASM transform failed, falling back to TS:', err);
    return null;
  }
}

// =============================================================================
// Layout Extraction
// =============================================================================

/**
 * Extract a ChartLayoutSnapshot from a CompileResult.
 *
 * Converts the compiler's absolute pixel layout into normalized (0-1) coordinates
 * relative to the total chart dimensions, which is what the OfficeJS-style
 * getPlotAreaLayout / getLegendLayout / getTitleLayout APIs return.
 */
function extractLayoutSnapshot(result: CompileResult): ChartLayoutSnapshot | null {
  const layout = result.layout;
  if (!layout) return null;

  const totalW = layout.width || 1;
  const totalH = layout.height || 1;

  const normalize = (
    rect: { x: number; y: number; width: number; height: number } | undefined,
  ): ChartLayoutRect | undefined => {
    if (!rect) return undefined;
    return {
      left: rect.x / totalW,
      top: rect.y / totalH,
      width: rect.width / totalW,
      height: rect.height / totalH,
    };
  };

  const plotArea = normalize(layout.plotArea);
  if (!plotArea) return null;

  return {
    plotArea,
    legend: normalize(layout.legend),
    title: normalize(layout.title),
    // dataLabels: The compile result doesn't provide a separate data labels region;
    // this would need mark-level bounding box computation in a future iteration.
    dataLabels: undefined,
  };
}

// =============================================================================
// Re-export types from contracts for backward compatibility
// =============================================================================

// Re-export chart types from contracts
export type { ChartBounds, ChartDataResult, ChartError, ChartErrorCode, ChartMark };

// =============================================================================
// Chart Bridge Class
// =============================================================================

/**
 * Chart Bridge
 *
 * Connects the standalone charts library to the engine's reactive system.
 *
 * Key responsibilities:
 * 1. Cache compiled marks (invalidate on data/spec changes)
 * 2. Subscribe to cell and chart change events
 * 3. Resolve CellIdRange to actual cell data
 * 4. Provide render API for ChartLayer
 */
export class ChartBridge implements IChartBridge {
  private readonly renderCache = new ChartRenderCache();

  /** Cleanup functions for event subscriptions */
  private cleanups: Array<() => void> = [];

  /** Whether the bridge has been started */
  private started = false;

  /** Workbook theme color palette used to resolve imported chart scheme colors. */
  private workbookThemeColorPalettePromise: Promise<ChartWorkbookThemeColorPalette | null> | null =
    null;

  constructor(private ctx: DocumentContext) {}

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Start the chart bridge - subscribe to events for reactive updates.
   *
   * @returns Cleanup function to stop the bridge
   */
  start(): () => void {
    if (this.started) {
      return () => this.stop();
    }
    this.started = true;
    this.renderCache.start();

    this.setupSubscriptions();

    return () => this.stop();
  }

  /**
   * Stop the chart bridge and clean up subscriptions.
   */
  stop(): void {
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
    this.renderCache.stop();
    this.workbookThemeColorPalettePromise = null;
    this.started = false;
  }

  /**
   * Destroy the bridge - alias for stop().
   */
  destroy(): void {
    this.stop();
  }

  // ===========================================================================
  // Event Subscriptions
  // ===========================================================================

  /**
   * Set up EventBus subscriptions for reactive chart updates.
   */
  private setupSubscriptions(): void {
    // Event-bus seam: event payloads carry sheetId as raw string (see
    // CellChangedEvent / CellsBatchChangedEvent). Brand at subscription entry
    // until a follow-up round migrates event types to SheetId.
    const unsubCell = this.ctx.eventBus.on<CellChangedEvent>('cell:changed', (event) => {
      void this.handleCellChange(toSheetId(event.sheetId), event.row, event.col);
    });
    this.cleanups.push(unsubCell);

    const unsubBatch = this.ctx.eventBus.on<CellsBatchChangedEvent>(
      'cells:batch-changed',
      (event) => {
        void this.handleCellsBatchChange(toSheetId(event.sheetId), event.changes);
      },
    );
    this.cleanups.push(unsubBatch);

    // Subscribe to chart updates (emitted by handleFloatingObjectChanges for chart config changes)
    const unsubChart = this.ctx.eventBus.on<ChartUpdatedEvent>('chart:updated', (event) => {
      this.invalidateChart(event.chartId, toSheetId(event.sheetId));
    });
    this.cleanups.push(unsubChart);

    const unsubTheme = this.ctx.eventBus.on('workbook:theme-changed', () => {
      this.workbookThemeColorPalettePromise = null;
      this.clearAllCaches();
    });
    this.cleanups.push(unsubTheme);

    // Subscribe to floating object events for chart-type objects.
    // This handles the live mutation path: when charts are created or updated
    // as floating objects, we invalidate the marks cache so the next render
    // fetches fresh data from ComputeBridge.
    //
    // The handlers also maintain `chartSheetIndex` so the sync paint path
    // (`renderCached`) can resolve chartId → sheetId in O(1) without awaiting.
    const unsubFoCreated = this.ctx.eventBus.on<FloatingObjectCreatedEvent>(
      'floatingObject:created',
      (event) => {
        if (event.objectType === 'chart' || isChartPayload(event.data)) {
          const eventSheetId = toSheetId(event.sheetId);
          this.renderCache.setSheetId(event.objectId, eventSheetId);
          if (!this.syncImportRenderStatus(event.objectId, event.data, eventSheetId)) {
            this.invalidateChart(event.objectId, eventSheetId);
          }
        }
      },
    );
    this.cleanups.push(unsubFoCreated);

    const unsubFoUpdated = this.ctx.eventBus.on<FloatingObjectUpdatedEvent>(
      'floatingObject:updated',
      (event) => {
        if (isChartPayload(event.data)) {
          // Forward-looking: charts cannot move between sheets in the current
          // API (no setFloatingObjectSheetId surface), but if a cross-sheet
          // move is added later it will arrive here as `event.sheetId !==
          // chartSheetIndex.get(objectId)`. The conditional re-set costs
          // nothing today and prevents silent index drift if that lands.
          const eventSheetId = toSheetId(event.sheetId);
          if (this.renderCache.getSheetId(event.objectId) !== eventSheetId) {
            this.renderCache.setSheetId(event.objectId, eventSheetId);
          }
          const importStatusPayload = hasImportStatus(event.changes) ? event.changes : event.data;
          const hasTerminalImportStatus = this.syncImportRenderStatus(
            event.objectId,
            importStatusPayload,
            eventSheetId,
          );
          if (hasTerminalImportStatus) return;

          // Skip cache invalidation for position-only changes (drag/resize).
          // Position fields don't affect compiled marks (data, axes, series, etc.).
          // changedFields comes from Rust via the JSON update keys —
          // e.g. moveChart -> ["anchorRow", "anchorCol"], resizeChart -> ["width", "height"].
          const fields = event.changedFields ?? [];
          if (!isPositionOnlyUpdate(fields)) {
            this.invalidateChart(event.objectId, eventSheetId);
          }
        }
      },
    );
    this.cleanups.push(unsubFoUpdated);

    // Cleanup on chart deletion: drop the index entry and every cache slot,
    // otherwise renderCached's ensureCompiled would chase a vanished chart.
    const unsubFoDeleted = this.ctx.eventBus.on<FloatingObjectDeletedEvent>(
      'floatingObject:deleted',
      (event) => {
        if (event.objectType === 'chart') {
          const eventSheetId = toSheetId(event.sheetId);
          this.renderCache.deleteSheetId(event.objectId);
          this.renderCache.deleteChartCaches(event.objectId, eventSheetId);
        }
      },
    );
    this.cleanups.push(unsubFoDeleted);

    // Cascade clear on sheet deletion: every chart on the deleted sheet must
    // be evicted from the index and from every cache. Without this, a stale
    // chartId → vanished-sheetId entry survives and renderCached's
    // ensureCompiled would call getMarks against a sheet that no longer
    // exists.
    const unsubSheetDeleted = this.ctx.eventBus.on<SheetDeletedEvent>('sheet:deleted', (event) => {
      const deletedSheetId = toSheetId(event.sheetId);
      const orphanedChartIds = this.renderCache.chartIdsForSheet(deletedSheetId);
      for (const chartId of orphanedChartIds) {
        this.renderCache.deleteSheetId(chartId);
        this.renderCache.deleteChartCaches(chartId, deletedSheetId);
      }
    });
    this.cleanups.push(unsubSheetDeleted);

    // Subscribe to structural changes (row/column insert/delete) to keep A1-string
    // dataRange references in sync. Charts that use dataRangeIdentity (CellIdRange)
    // auto-expand via the Rust engine; only legacy A1-string dataRange charts need
    // this JS-side adjustment.
    const unsubRowsInserted = this.ctx.eventBus.on<RowsInsertedEvent>('rows:inserted', (event) => {
      void this.handleRowsInserted(toSheetId(event.sheetId), event.startRow, event.count);
    });
    this.cleanups.push(unsubRowsInserted);

    const unsubRowsDeleted = this.ctx.eventBus.on<RowsDeletedEvent>('rows:deleted', (event) => {
      void this.handleRowsDeleted(toSheetId(event.sheetId), event.startRow, event.count);
    });
    this.cleanups.push(unsubRowsDeleted);

    const unsubColsInserted = this.ctx.eventBus.on<ColumnsInsertedEvent>(
      'columns:inserted',
      (event) => {
        void this.handleColumnsInserted(toSheetId(event.sheetId), event.startCol, event.count);
      },
    );
    this.cleanups.push(unsubColsInserted);

    const unsubColsDeleted = this.ctx.eventBus.on<ColumnsDeletedEvent>(
      'columns:deleted',
      (event) => {
        void this.handleColumnsDeleted(toSheetId(event.sheetId), event.startCol, event.count);
      },
    );
    this.cleanups.push(unsubColsDeleted);
  }

  /**
   * Handle a cell change - invalidate any charts that reference this cell.
   */
  private async handleCellChange(sheetId: SheetId, row: number, col: number): Promise<void> {
    // Guard: bail if the bridge was stopped (e.g., during document disposal)
    // while this fire-and-forget handler was already dispatched.
    if (!this.started) return;

    const charts = await this.getAllChartsInWorkbook();
    for (const chart of charts) {
      if (await this.chartReferencesCell(chart, sheetId, row, col)) {
        this.invalidateChart(chart.id, sheetId);
      }
    }
  }

  private async handleCellsBatchChange(
    sheetId: SheetId,
    changes: Array<{ row: number; col: number }>,
  ): Promise<void> {
    if (!this.started || changes.length === 0) return;

    let startRow = Number.POSITIVE_INFINITY;
    let startCol = Number.POSITIVE_INFINITY;
    let endRow = Number.NEGATIVE_INFINITY;
    let endCol = Number.NEGATIVE_INFINITY;

    for (const change of changes) {
      startRow = Math.min(startRow, change.row);
      startCol = Math.min(startCol, change.col);
      endRow = Math.max(endRow, change.row);
      endCol = Math.max(endCol, change.col);
    }

    const affected = await this.getChartsAffectedByRange(sheetId, {
      sheetId,
      startRow,
      startCol,
      endRow,
      endCol,
    });
    for (const chartId of affected) {
      this.invalidateChart(chartId);
    }
  }

  private async getAllChartsInWorkbook(): Promise<ChartFloatingObject[]> {
    const sheetIds = await this.ctx.computeBridge.getSheetOrder();
    const perSheet = await Promise.all(
      sheetIds.map((id) => getAllCharts(this.ctx, toSheetId(id))),
    );
    return perSheet.flat();
  }

  /**
   * Check if a chart's data range includes a specific cell.
   */
  private async chartReferencesCell(
    chart: ChartFloatingObject,
    sheetId: SheetId,
    row: number,
    col: number,
  ): Promise<boolean> {
    const resolved = await resolveChartRangeReferences(this.ctx, chart);
    const ranges = [
      resolved.dataRange,
      resolved.categoryRange,
      resolved.seriesRange,
      ...resolved.seriesReferences.flatMap((series) => [series.values, series.categories]),
    ];

    return ranges.some((entry) => {
      const range = entry?.range;
      return (
        range?.sheetId === sheetId &&
        row >= range.startRow &&
        row <= range.endRow &&
        col >= range.startCol &&
        col <= range.endCol
      );
    });
  }

  /**
   * Handle rows inserted — update A1-string dataRange for affected charts.
   *
   * Excel semantics:
   *   at < startRow          → shift entire range down by count
   *   startRow < at ≤ endRow → expand endRow by count (insertion strictly inside)
   *   at > endRow            → no change
   * Charts using dataRangeIdentity auto-expand via the Rust engine; skip them.
   */
  private async handleRowsInserted(
    sheetId: SheetId,
    startRow: number,
    count: number,
  ): Promise<void> {
    if (!this.started) return;
    const charts = await getAllCharts(this.ctx, sheetId);
    for (const chart of charts) {
      if (chart.dataRangeIdentity || !chart.dataRange) continue;
      const range = parseCellRange(chart.dataRange);
      if (!range) continue;

      if (startRow < range.startRow) {
        // Insertion before range — shift range down
        const newRange = {
          ...range,
          startRow: range.startRow + count,
          endRow: range.endRow + count,
        };
        await updateChart(this.ctx, sheetId, chart.id, { dataRange: cellRangeToA1(newRange) });
        this.invalidateChart(chart.id, sheetId);
      } else if (startRow > range.startRow && startRow <= range.endRow) {
        // Insertion strictly inside range — expand endRow
        const newRange = { ...range, endRow: range.endRow + count };
        await updateChart(this.ctx, sheetId, chart.id, { dataRange: cellRangeToA1(newRange) });
        this.invalidateChart(chart.id, sheetId);
      }
      // Insertion at startRow or after endRow: no change
    }
  }

  /**
   * Handle rows deleted — update A1-string dataRange for affected charts.
   *
   * Deleted rows: [startRow, startRow + count - 1] (inclusive, 0-indexed).
   *   delEnd < rangeStart   → shift range up by count
   *   delStart > rangeEnd   → no change
   *   otherwise             → shrink range by the overlap, clip start if needed
   */
  private async handleRowsDeleted(
    sheetId: SheetId,
    startRow: number,
    count: number,
  ): Promise<void> {
    if (!this.started) return;
    const charts = await getAllCharts(this.ctx, sheetId);
    for (const chart of charts) {
      if (chart.dataRangeIdentity || !chart.dataRange) continue;
      const range = parseCellRange(chart.dataRange);
      if (!range) continue;

      const delEnd = startRow + count - 1;

      if (delEnd < range.startRow) {
        // Deletion entirely before range — shift range up
        const newRange = {
          ...range,
          startRow: range.startRow - count,
          endRow: range.endRow - count,
        };
        await updateChart(this.ctx, sheetId, chart.id, { dataRange: cellRangeToA1(newRange) });
        this.invalidateChart(chart.id);
      } else if (startRow > range.endRow) {
        // Deletion entirely after range — no change
      } else {
        // Deletion overlaps range
        const overlapStart = Math.max(startRow, range.startRow);
        const overlapEnd = Math.min(delEnd, range.endRow);
        const deletedWithin = overlapEnd - overlapStart + 1;

        const newStartRow = startRow < range.startRow ? startRow : range.startRow;
        const newEndRow = range.endRow - deletedWithin;

        if (newEndRow < newStartRow) {
          // Entire range was deleted — just invalidate, keep stale range
          this.invalidateChart(chart.id, sheetId);
          continue;
        }

        const newRange = { ...range, startRow: newStartRow, endRow: newEndRow };
        await updateChart(this.ctx, sheetId, chart.id, { dataRange: cellRangeToA1(newRange) });
        this.invalidateChart(chart.id, sheetId);
      }
    }
  }

  /**
   * Handle columns inserted — update A1-string dataRange for affected charts.
   * Same semantics as handleRowsInserted but for columns.
   */
  private async handleColumnsInserted(
    sheetId: SheetId,
    startCol: number,
    count: number,
  ): Promise<void> {
    if (!this.started) return;
    const charts = await getAllCharts(this.ctx, sheetId);
    for (const chart of charts) {
      if (chart.dataRangeIdentity || !chart.dataRange) continue;
      const range = parseCellRange(chart.dataRange);
      if (!range) continue;

      if (startCol < range.startCol) {
        // Insertion before range — shift range right
        const newRange = {
          ...range,
          startCol: range.startCol + count,
          endCol: range.endCol + count,
        };
        await updateChart(this.ctx, sheetId, chart.id, { dataRange: cellRangeToA1(newRange) });
        this.invalidateChart(chart.id, sheetId);
      } else if (startCol > range.startCol && startCol <= range.endCol) {
        // Insertion strictly inside range — expand endCol
        const newRange = { ...range, endCol: range.endCol + count };
        await updateChart(this.ctx, sheetId, chart.id, { dataRange: cellRangeToA1(newRange) });
        this.invalidateChart(chart.id, sheetId);
      }
    }
  }

  /**
   * Handle columns deleted — update A1-string dataRange for affected charts.
   * Same semantics as handleRowsDeleted but for columns.
   */
  private async handleColumnsDeleted(
    sheetId: SheetId,
    startCol: number,
    count: number,
  ): Promise<void> {
    if (!this.started) return;
    const charts = await getAllCharts(this.ctx, sheetId);
    for (const chart of charts) {
      if (chart.dataRangeIdentity || !chart.dataRange) continue;
      const range = parseCellRange(chart.dataRange);
      if (!range) continue;

      const delEnd = startCol + count - 1;

      if (delEnd < range.startCol) {
        // Deletion entirely before range — shift range left
        const newRange = {
          ...range,
          startCol: range.startCol - count,
          endCol: range.endCol - count,
        };
        await updateChart(this.ctx, sheetId, chart.id, { dataRange: cellRangeToA1(newRange) });
        this.invalidateChart(chart.id, sheetId);
      } else if (startCol > range.endCol) {
        // Deletion entirely after range — no change
      } else {
        // Deletion overlaps range
        const overlapStart = Math.max(startCol, range.startCol);
        const overlapEnd = Math.min(delEnd, range.endCol);
        const deletedWithin = overlapEnd - overlapStart + 1;

        const newStartCol = startCol < range.startCol ? startCol : range.startCol;
        const newEndCol = range.endCol - deletedWithin;

        if (newEndCol < newStartCol) {
          this.invalidateChart(chart.id, sheetId);
          continue;
        }

        const newRange = { ...range, startCol: newStartCol, endCol: newEndCol };
        await updateChart(this.ctx, sheetId, chart.id, { dataRange: cellRangeToA1(newRange) });
        this.invalidateChart(chart.id, sheetId);
      }
    }
  }

  /**
   * Invalidate a chart's compiled marks cache.
   * Note: layoutCache also follows the same stale pattern — we keep stale layouts
   * available during async recompilation, and getMarks() replaces both caches.
   */
  invalidateChart(chartId: string, sheetId?: SheetId): void {
    this.renderCache.invalidateChart(chartId, sheetId);
  }

  /**
   * Check if a chart is dirty (needs recompilation).
   */
  isChartDirty(chartId: string, sheetId?: SheetId): boolean {
    return this.renderCache.isChartDirty(chartId, sheetId);
  }

  /**
   * Clear the dirty flag for a chart after rendering.
   */
  clearDirtyFlag(chartId: string, sheetId?: SheetId): void {
    this.renderCache.clearDirtyFlag(chartId, sheetId);
  }

  // ===========================================================================
  // Data Resolution
  // ===========================================================================

  /**
   * Resolve chart data from CellIdRange to actual values.
   *
   * This converts the CRDT-safe CellIdRange references to actual cell data
   * that can be passed to the charts library for rendering.
   *
   * @param sheetId - Sheet containing the chart
   * @param chartId - Chart ID
   * @returns Resolved data or error
   */
  async resolveChartData(sheetId: SheetId, chartId: string): Promise<ChartDataResult> {
    const chart = await getChart(this.ctx, sheetId, chartId);
    if (!chart) {
      return {
        success: false,
        error: {
          code: 'CHART_NOT_FOUND',
          message: 'Chart not found',
          chartId,
        },
      };
    }

    const resolvedRanges = await resolveChartRangeReferences(this.ctx, chart);
    const chartRenderDataOrError = await this.resolveChartDataForRendering(
      chart,
      resolvedRanges,
      chartId,
    );
    if ('code' in chartRenderDataOrError) {
      return {
        success: false,
        error: chartRenderDataOrError,
      };
    }

    const data = this.chartDataToRows(chartRenderDataOrError.data);

    if (data.length === 0) {
      return {
        success: false,
        error: {
          code: 'EMPTY_DATA',
          message: 'Chart data range is empty',
          chartId,
        },
      };
    }

    return { success: true, data };
  }

  private chartDataToRows(data: ChartData): Record<string, unknown>[] {
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < (data.categories?.length || 0); i++) {
      const category = data.categories[i];
      for (const series of data.series) {
        const point = series.data[i];
        if (!point) continue;
        rows.push({
          category: String(category),
          value: point.y,
          series: series.name,
        });
      }
    }
    return rows;
  }

  // ===========================================================================
  // Mark Compilation
  // ===========================================================================

  /**
   * Get compiled marks for a chart.
   *
   * Returns cached marks if available, otherwise compiles the chart spec.
   *
   * @param sheetId - Sheet ID
   * @param chartId - Chart ID
   * @returns Compiled marks or error
   */
  async getMarks(sheetId: SheetId, chartId: string): Promise<ChartMark[] | ChartError> {
    const cacheState = this.renderCache.getCompileState(chartId, sheetId);
    // Started-gate at function entry: a caller landing here after stop()
    // (e.g. an in-flight ensureCompiled racing a bridge teardown) must NOT
    // mutate caches or add to pendingCompilations. Without this, the
    // pending-check short-circuit at the top of subsequent calls would
    // perpetually return stale, since pendingCompilations would never clear.
    if (!this.started) {
      if (cacheState.marks) return cacheState.marks;
      return {
        code: 'CHART_NOT_FOUND',
        message: 'Chart bridge is stopped',
        chartId,
      };
    }

    // Check error cache first
    if (cacheState.error) {
      return cacheState.error;
    }

    // Check marks cache
    if (cacheState.marks && !cacheState.isDirty) {
      return cacheState.marks;
    }

    // If a recompilation is already in flight, return stale marks to avoid blank frames.
    // The in-flight compilation will update the cache when it resolves.
    // NOTE: this short-circuit deliberately does NOT fire onCacheUpdate
    // listeners — only the in-flight compile's real cache-commit fires them.
    // Firing here would loop: renderCached → ensureCompiled → getMarks →
    // pending short-circuit → listener → markDirty('drawing') → next frame
    // → renderCached again → loop until the original compile resolves.
    if (cacheState.marks && cacheState.isCompilePending) {
      return cacheState.marks;
    }

    this.renderCache.beginCompilation(chartId, sheetId);

    // Get chart spec
    const chart = await getChart(this.ctx, sheetId, chartId);
    if (!chart) {
      const error: ChartError = {
        code: 'CHART_NOT_FOUND',
        message: 'Chart not found',
        chartId,
      };
      this.commitError(chartId, error, sheetId);
      return error;
    }

    const resolvedRanges = await resolveChartRangeReferences(this.ctx, chart);
    const chartRenderDataOrError = await this.resolveChartDataForRendering(
      chart,
      resolvedRanges,
      chartId,
    );
    if ('code' in chartRenderDataOrError) {
      this.commitError(chartId, chartRenderDataOrError, sheetId);
      return chartRenderDataOrError;
    }
    const { config, data: chartData } = chartRenderDataOrError;

    if (chartData.series.length === 0) {
      const error: ChartError = {
        code: 'EMPTY_DATA',
        message: 'Chart data range is empty',
        chartId,
      };
      this.commitError(chartId, error, sheetId);
      return error;
    }

    // Convert to ChartSpec and compile
    const spec = configToSpec(config, chartData);

    // Try WASM-accelerated transforms if available
    const specDataValues =
      spec.data && 'values' in spec.data ? (spec.data.values as DataRow[]) : [];
    const wasmData = spec.transform ? tryWasmTransforms(specDataValues, spec.transform) : null;

    let compileResult;
    if (wasmData) {
      // WASM already applied transforms — compile without them
      compileResult = compile({ ...spec, transform: undefined, data: { values: wasmData } });
    } else {
      // Fallback: let compile() handle transforms in TS
      compileResult = compile(spec);
    }

    // Flatten all marks into a single array
    const marks = collectMarks(compileResult) as ChartMark[];

    const layoutSnapshot = extractLayoutSnapshot(compileResult);

    // Real cache commit — fires listeners so the renderer dirties the
    // drawing layer and the next frame paints from cache instead of the
    // placeholder. commitMarks bails if stop() ran mid-compile.
    this.commitMarks(chartId, marks, sheetId, layoutSnapshot);

    return marks;
  }

  /**
   * Commit a marks outcome to the cache and notify cache-update listeners.
   *
   * Gated on `started`: if stop() ran mid-compile, the caches were cleared
   * and we must not re-pollute them. The pendingCompilations cleanup is
   * mirrored by stop() so the bridge is fully reset on teardown.
   */
  private commitMarks(
    chartId: string,
    marks: ChartMark[],
    sheetId?: SheetId,
    layout?: ChartLayoutSnapshot | null,
  ): void {
    this.renderCache.commitMarks(chartId, marks, { sheetId, layout });
  }

  /**
   * Commit an error outcome to the cache and notify listeners.
   *
   * Without firing listeners on errors, a chart whose first compile fails
   * (CHART_NOT_FOUND or EMPTY_DATA) would paint "Chart loading…" forever:
   * renderCached → ensureCompiled → errorCache populated → no signal → the
   * placeholder freezes until something else dirties the drawing layer.
   */
  private commitError(chartId: string, error: ChartError, sheetId?: SheetId): void {
    this.renderCache.commitError(chartId, error, sheetId);
  }

  private syncImportRenderStatus(chartId: string, payload: unknown, sheetId?: SheetId): boolean {
    return this.renderCache.syncImportRenderStatus(chartId, payload, sheetId);
  }

  /**
   * Compile marks for a chart at specific pixel dimensions.
   *
   * Unlike getMarks(), this does NOT use or update the marks/layout cache.
   * It performs a one-off compilation at the requested dimensions, which is
   * needed for image export (marks are dimension-dependent).
   *
   * @param sheetId - Sheet ID
   * @param chartId - Chart ID
   * @param width - Target width in pixels
   * @param height - Target height in pixels
   * @returns Compiled marks or error
   */
  async getMarksAtSize(
    sheetId: SheetId,
    chartId: string,
    width: number,
    height: number,
  ): Promise<ChartMark[] | ChartError> {
    const snapshot = await this.compileChartRenderSnapshotAtSize(
      sheetId,
      chartId,
      width,
      height,
      defaultExportOptionsForSize(width, height),
    );
    if ('code' in snapshot) return snapshot;
    return snapshot.marks;
  }

  async getRenderSnapshotAtSize(
    sheetId: SheetId,
    chartId: string,
    width: number,
    height: number,
    exportOptions: ChartExportOptionsSnapshot,
  ): Promise<ChartRenderSnapshot | ChartError> {
    return this.compileChartRenderSnapshotAtSize(sheetId, chartId, width, height, exportOptions);
  }

  private async compileChartRenderSnapshotAtSize(
    sheetId: SheetId,
    chartId: string,
    width: number,
    height: number,
    exportOptions: ChartExportOptionsSnapshot,
  ): Promise<ChartRenderSnapshot | ChartError> {
    const chart = await getChart(this.ctx, sheetId, chartId);
    if (!chart) {
      return {
        code: 'CHART_NOT_FOUND',
        message: 'Chart not found',
        chartId,
      };
    }

    const resolvedRanges = await resolveChartRangeReferences(this.ctx, chart);
    const chartRenderDataOrError = await this.resolveChartDataForRendering(
      chart,
      resolvedRanges,
      chartId,
    );
    if ('code' in chartRenderDataOrError) {
      return chartRenderDataOrError;
    }
    const { config, data: chartData } = chartRenderDataOrError;

    if (chartData.series.length === 0) {
      return {
        code: 'EMPTY_DATA',
        message: 'Chart data range is empty',
        chartId,
      };
    }

    const spec = configToSpec(config, chartData);

    // Try WASM-accelerated transforms if available
    const specDataValues =
      spec.data && 'values' in spec.data ? (spec.data.values as DataRow[]) : [];
    const wasmData = spec.transform ? tryWasmTransforms(specDataValues, spec.transform) : null;
    const compilerPathId = wasmData ? 'wasm-transforms+ts-grammar' : 'ts-grammar';
    const compileInput = wasmData
      ? { ...spec, transform: undefined, data: { values: wasmData } }
      : spec;

    // Compile at the target dimensions (override via CompileOptions)
    const compileResult = compile(compileInput, undefined, { width, height });

    // Flatten all marks into a single array (same as getMarks)
    const marks = collectMarks(compileResult) as ChartMark[];

    return {
      marks,
      resolvedChartSpec: buildResolvedChartSpecSnapshot({
        chart,
        sheetId,
        config,
        chartData,
        resolvedRanges,
        exportOptions,
        compilerPathId,
        compilerInputHash: hashJson({
          chartId,
          sheetId,
          config,
          chartData,
          resolvedRanges,
          compileInput,
        }),
      }),
    };
  }

  /**
   * Create a CellDataAccessor for the charts library.
   * Pre-fetches cell values into a map since the charts library expects sync access.
   */
  private async createCellAccessor(
    ranges: Array<CellRange | null | undefined>,
    options?: {
      defaultSheetId?: SheetId;
      sheetAliases?: Map<string, string>;
      hiddenVisibility?: HiddenCellVisibility;
    },
  ): Promise<CellDataAccessor> {
    const valueMap = new Map<string, ReturnType<CellDataAccessor['getValue']>>();
    const seen = new Set<string>();

    for (const range of ranges) {
      if (!range?.sheetId) continue;
      for (let row = range.startRow; row <= range.endRow; row++) {
        for (let col = range.startCol; col <= range.endCol; col++) {
          const key = `${range.sheetId},${row},${col}`;
          if (seen.has(key)) continue;
          seen.add(key);

          if (isCellHidden(range.sheetId, row, col, options?.hiddenVisibility)) {
            valueMap.set(key, null);
            continue;
          }

          const value = await getValue(this.ctx, toSheetId(range.sheetId), row, col);
          // CellError values are converted to null for chart data extraction.
          let chartValue: ReturnType<CellDataAccessor['getValue']>;
          if (value && typeof value === 'object' && 'type' in value) {
            chartValue = null;
          } else {
            chartValue = (value ?? null) as ReturnType<CellDataAccessor['getValue']>;
          }
          valueMap.set(key, chartValue);
        }
      }
    }

    return {
      getValue: (row: number, col: number, sheetId?: string) => {
        const resolvedSheetId = sheetId
          ? (options?.sheetAliases?.get(sheetId) ?? sheetId)
          : options?.defaultSheetId;
        if (!resolvedSheetId) return null;
        if (isCellHidden(resolvedSheetId, row, col, options?.hiddenVisibility)) return null;
        return valueMap.get(`${resolvedSheetId},${row},${col}`) ?? null;
      },
    };
  }

  private async resolveChartDataForRendering(
    chart: ChartFloatingObject,
    resolvedRanges: ResolvedChartRangeReferences,
    chartId: string,
  ): Promise<ChartRenderData | ChartError> {
    const config = toChartConfig(chart);
    const hasExplicitSeriesValues = config.series?.some((series) => series.values?.trim());

    if (hasExplicitSeriesValues) {
      const seriesRanges = resolvedRanges.seriesReferences.flatMap((series) => [
        series.values?.range,
        series.categories?.range,
      ]);
      const hiddenVisibility = config.plotVisibleOnly
        ? await loadHiddenVisibility(
            seriesRanges,
            this.ctx.computeBridge as HiddenDimensionBridge | undefined,
          )
        : undefined;
      const renderConfig = hiddenVisibility
        ? withHiddenSeriesFiltered(config, resolvedRanges, hiddenVisibility)
        : config;
      const valueRanges = resolvedRanges.seriesReferences
        .map((series) => series.values?.range)
        .filter(Boolean);

      if (valueRanges.length === 0) {
        return {
          code: 'DATA_UNAVAILABLE',
          message:
            resolvedRanges.diagnostics[0]?.message ?? 'Chart series value ranges are unavailable',
          chartId,
        };
      }

      const accessor = await this.createCellAccessor(seriesRanges, {
        defaultSheetId: chart.sheetId ? toSheetId(chart.sheetId) : undefined,
        sheetAliases: this.seriesSheetAliases(resolvedRanges),
        hiddenVisibility,
      });
      const data = extractChartData(accessor, renderConfig);
      const themedConfig = await this.withWorkbookThemeColors(renderConfig);
      return {
        config: themedConfig,
        data: normalizeChartDataForRendering(data, themedConfig),
      };
    }

    const dataRange = resolvedRanges.dataRange?.range;
    if (!dataRange) {
      return {
        code: 'DATA_UNAVAILABLE',
        message: resolvedRanges.diagnostics[0]?.message ?? 'Chart data range is unavailable',
        chartId,
      };
    }

    const dataRanges = [
      dataRange,
      resolvedRanges.categoryRange?.range,
      resolvedRanges.seriesRange?.range,
    ];
    const hiddenVisibility = config.plotVisibleOnly
      ? await loadHiddenVisibility(
          dataRanges,
          this.ctx.computeBridge as HiddenDimensionBridge | undefined,
        )
      : undefined;
    const cellAccessor = await this.createCellAccessor(dataRanges, { hiddenVisibility });
    const data = extractChartDataFromRange(cellAccessor, dataRange, {
      categoryRange: resolvedRanges.categoryRange?.range,
      seriesRange: resolvedRanges.seriesRange?.range,
      seriesOrientation: chart.seriesOrientation as ChartConfig['seriesOrientation'],
    });
    const themedConfig = await this.withWorkbookThemeColors(config);
    return {
      config: themedConfig,
      data: normalizeChartDataForRendering(data, themedConfig),
    };
  }

  private async withWorkbookThemeColors(config: ChartConfig): Promise<ChartConfig> {
    return applyWorkbookThemeColors(config, () => this.getWorkbookThemeColorPalette());
  }

  private async getWorkbookThemeColorPalette(): Promise<ChartWorkbookThemeColorPalette | null> {
    this.workbookThemeColorPalettePromise ??= loadWorkbookThemeColorPalette(
      this.ctx.computeBridge as WorkbookThemeBridge | undefined,
    );
    return this.workbookThemeColorPalettePromise;
  }

  private seriesSheetAliases(
    resolvedRanges: ResolvedChartRangeReferences,
  ): Map<string, string> {
    const aliases = new Map<string, string>();
    for (const series of resolvedRanges.seriesReferences) {
      for (const reference of [series.values, series.categories]) {
        const parsed = reference?.ref ? parseCellRange(reference.ref) : null;
        if (parsed?.sheetName && reference?.range.sheetId) {
          aliases.set(parsed.sheetName, String(reference.range.sheetId));
        }
      }
    }
    return aliases;
  }

  // ===========================================================================
  // Render API
  // ===========================================================================
  //
  // Paint is synchronous and reads from cache only. Mark compilation is async
  // (data fetch + extract + compile) but lives off the paint path; the cache
  // breaks the coupling. See ImageCache.getImage / onLoad for the pattern
  // template — async producer, sync consumer, listener-driven repaint.
  //
  // The previous async `render()` returned a Promise that the canvas dispatch
  // loop discarded. By the time the await chain resolved, the engine had
  // already restored its `(viewport.x, viewport.y)` translate, so the chart's
  // own `ctx.translate(bounds.x, bounds.y)` landed in canvas-pixel space
  // without the viewport offset and the chart painted in the wrong frame.
  // `withRenderContext`'s rotation/flip were also dropped because they were
  // restored before the chart painted. The sync contract restores both.

  /**
   * Synchronous render from cache. See {@link IChartBridge.renderCached}.
   */
  renderCached(
    chartId: string,
    ctx: CanvasRenderingContext2D,
    bounds: ChartBounds,
    sheetId?: SheetId,
  ): void {
    const paintState = this.renderCache.getPaintState(chartId, sheetId);
    if (paintState.importRenderStatus) {
      renderChartError(ctx, bounds, {
        code: 'RENDER_FAILED',
        message: paintState.importRenderStatus.message,
        chartId,
        details: { importStatus: paintState.importRenderStatus.raw },
      });
      return;
    }

    if (!paintState.resolvedSheetId) {
      // First-paint case: floatingObject:created hasn't been delivered yet,
      // OR the chart was already deleted. Either way paint a placeholder; the
      // recovery path is the existing floating-object-pipeline call into
      // sheet-coordinator.ts which dirties the drawing layer once the event
      // lands. ensureCompiled would no-op anyway without a sheetId.
      renderChartPlaceholder(ctx, bounds, 'Chart loading…');
      return;
    }

    if (paintState.error) {
      // Error precedence over loading: a known error state must not retry on
      // every frame. invalidateChart() clears errorCache when the upstream
      // fix lands (data range edited, etc.) and recovery happens normally.
      renderChartError(ctx, bounds, paintState.error);
      return;
    }

    if (!paintState.marks) {
      // Cold-cache path: placeholder + background recompile. The compile
      // commit fires onCacheUpdate, the renderer dirties the drawing layer,
      // the next frame paints real marks from cache.
      renderChartPlaceholder(ctx, bounds, 'Chart loading…');
      if (!paintState.isCompilePending) {
        void this.ensureCompiled(chartId, paintState.resolvedSheetId);
      }
      return;
    }

    if (paintState.isDirty && !paintState.isCompilePending) {
      // Stale-but-show: paint stale marks this frame, kick a background
      // recompile. Mirrors getMarks's pendingCompilations stale-return at
      // the top of getMarks() and avoids a placeholder flash on every cell
      // edit affecting a chart's data range.
      void this.ensureCompiled(chartId, paintState.resolvedSheetId);
    }

    renderChartMarks(ctx, paintState.marks, bounds);
  }

  /**
   * Subscribe to cache-update notifications. See {@link IChartBridge.onCacheUpdate}.
   */
  onCacheUpdate(listener: (chartId: string) => void): () => void {
    return this.renderCache.onCacheUpdate(listener);
  }

  /**
   * Trigger compilation if dirty or absent. See {@link IChartBridge.ensureCompiled}.
   */
  async ensureCompiled(chartId: string, sheetId?: SheetId): Promise<void> {
    const resolvedSheetId = this.renderCache.resolveSheetId(chartId, sheetId);
    if (!resolvedSheetId) return;
    await this.getMarks(resolvedSheetId, chartId);
  }

  // ===========================================================================
  // Layout Retrieval
  // ===========================================================================

  /**
   * Get the layout snapshot for a chart.
   *
   * Returns a cached layout if available. If the chart is dirty (needs recompilation),
   * triggers getMarks() first to recompile and populate the layout cache.
   *
   * @param sheetId - Sheet ID
   * @param chartId - Chart ID
   * @returns Layout snapshot or null if chart not found / has no layout
   */
  async getLayout(sheetId: SheetId, chartId: string): Promise<ChartLayoutSnapshot | null> {
    // If layout is cached and chart is not dirty, return it directly
    const cached = this.renderCache.getFreshLayout(chartId, sheetId);
    if (cached) {
      return cached;
    }

    // Trigger recompilation which will populate the layout cache
    const marksOrError = await this.getMarks(sheetId, chartId);
    if ('code' in marksOrError) {
      return null;
    }

    return this.renderCache.getCachedLayout(chartId, sheetId) ?? null;
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Get charts that are affected by changes in a specific cell range.
   *
   * Useful for determining which charts need re-rendering after a batch update.
   */
  async getChartsAffectedByRange(sheetId: SheetId, range: CellRange): Promise<string[]> {
    const charts = await this.getAllChartsInWorkbook();
    const affected: string[] = [];

    for (const chart of charts) {
      const resolved = await resolveChartRangeReferences(this.ctx, chart);
      const ranges = [resolved.dataRange, resolved.categoryRange, resolved.seriesRange];
      const overlaps = ranges.some((entry) => {
        const chartRange = entry?.range;
        return (
          chartRange?.sheetId === sheetId &&
          range.startRow <= chartRange.endRow &&
          range.endRow >= chartRange.startRow &&
          range.startCol <= chartRange.endCol &&
          range.endCol >= chartRange.startCol
        );
      });

      if (overlaps) {
        affected.push(chart.id);
      }
    }

    return affected;
  }

  /**
   * Get all dirty charts that need re-rendering.
   */
  getDirtyCharts(): string[] {
    return this.renderCache.getDirtyChartKeys();
  }

  /**
   * Clear all caches. Useful for testing or full refresh.
   *
   * Fires onCacheUpdate listeners with the sentinel chartId `'*'` so the
   * renderer dirties the drawing layer. Without this signal, on-screen marks
   * would freeze (we have no marks in cache, but the renderer wouldn't know
   * to re-paint until something else dirtied it).
   */
  clearAllCaches(): void {
    this.workbookThemeColorPalettePromise = null;
    this.renderCache.clearAllCaches();
  }

  // ===========================================================================
  // Headless Image Export
  // ===========================================================================

  // TODO(06-CONSUMERS): Headless chart image export is not yet implemented.
  // The `exportChartImage` operation in chart-operations.ts currently returns
  // a "not implemented" error because it requires a canvas context
  // (OffscreenCanvas or DOM canvas) which is not available in headless/kernel
  // mode. To support server-side chart image export:
  //   1. Use OffscreenCanvas (available in Web Workers and Node 18+)
  //   2. Call getMarks() to compile the chart, then renderChartMarks() to an
  //      OffscreenCanvas, then canvas.toDataURL() / canvas.toBlob()
  //   3. Wire this through chart-operations.ts exportChartImage()
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new ChartBridge instance.
 *
 * @param ctx - Store context
 * @returns ChartBridge instance (not started)
 */
export function createChartBridge(ctx: DocumentContext): ChartBridge {
  return new ChartBridge(ctx);
}
