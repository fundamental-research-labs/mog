/**
 * useCharts Hook
 *
 * Manages chart state for the spreadsheet with Yjs collaboration support.
 *
 * State architecture:
 * - Yjs: Chart configs (persistent, collaborative)
 * - UI Store: Selection, editing mode (ephemeral)
 *
 * Architecture:
 * - Reads: Worksheet API (listCharts, batchGetCellPositions)
 * - Writes: Worksheet API (addChart, updateChart, removeChart)
 * - Cell data: Worksheet viewport (sync) for chart data extraction
 * - Subscriptions: ws.on() for chart CRUD and cell change notifications
 *
 * @module hooks/use-charts
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  CellDataAccessor,
  ChartData,
  ChartType,
  SerializedChart,
  StoredChartConfig,
} from '@mog/charts';
import { extractChartData, extractChartDataFromRange, parseRange } from '@mog/charts';

import type { ChartPosition } from '@mog/grid-renderer';
import type { WorksheetWithInternals } from '@mog-sdk/contracts/api';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import { parseCellRange } from '@mog/spreadsheet-utils/a1';
import type { ChartDefinition } from '../../components/charts/chart-types';
import {
  normalizeStoredChartConfig,
  normalizeStoredChartConfigUpdate,
  type StoredChartConfigCreateDraft,
  type StoredChartConfigUpdateDraft,
} from '../../adapters/charts/chart-config-adapter';

import { useWorkbook } from '../../infra/context';
import { useChartUI } from './use-chart';

// =============================================================================
// Types
// =============================================================================

export interface UseChartsOptions {
  /** Current sheet ID */
  sheetId: SheetId;
}

export interface UseChartsReturn {
  /** Charts for the current sheet (with resolved data) */
  charts: ChartDefinition[];

  /** Currently selected chart ID */
  selectedChartId: string | null;

  /** Currently editing chart ID */
  editingChartId: string | null;

  /** Add a new chart */
  addChart: (config: StoredChartConfigCreateDraft) => string;

  /** Update a chart */
  updateChart: (chartId: string, updates: StoredChartConfigUpdateDraft) => void;

  /** Update chart position */
  updateChartPosition: (chartId: string, position: ChartPosition) => void;

  /** Remove a chart */
  removeChart: (chartId: string) => void;

  /** Select a chart */
  selectChart: (chartId: string | null) => void;

  /** Start editing a chart */
  startEditingChart: (chartId: string | null) => void;

  /** Stop editing chart */
  stopEditingChart: () => void;

  /** Create a chart from data range with optional subType and config overrides */
  createChartFromSelection: (
    type: ChartType,
    dataRange: string,
    subType?: string,
    configOverrides?: StoredChartConfigUpdateDraft,
  ) => string;

  /** Delete the selected chart */
  deleteSelectedChart: () => void;
}

// =============================================================================
// Per-Chart Data Memoization Cache
// =============================================================================

/**
 * Cache entry for chart definition memoization.
 *
 * ARCHITECTURE: We cache the full definition to prevent chart renderer flicker.
 * The cache is keyed by chart ID and stores:
 * - The serialized chart reference (for identity comparison)
 * - The data version (for detecting cell value changes)
 * - The full definition (to reuse config/data objects)
 *
 * This enables position-only updates to reuse the same config/data objects,
 * which prevents chart renderer from re-initializing during drag operations.
 */
interface ChartDefCacheEntry {
  /** Serialized chart reference (for identity comparison) */
  serialized: SerializedChart;
  /** Data version when computed (for detecting cell value changes) */
  dataVersion: number;
  /** Cached chart definition (with config and data) */
  definition: ChartDefinition;
}

/**
 * Check if a chart update is position-only (no config/data changes).
 * Used to determine if we can reuse cached config/data objects.
 */
function isOnlyPositionChange(prev: SerializedChart, next: SerializedChart): boolean {
  // Position fields that can change during drag
  if (
    prev.anchorRow !== next.anchorRow ||
    prev.anchorCol !== next.anchorCol ||
    prev.width !== next.width ||
    prev.height !== next.height
  ) {
    // Check if non-position fields are the same (data config that affects chart content)
    return (
      prev.type === next.type &&
      prev.subType === next.subType &&
      prev.title === next.title &&
      prev.dataRange === next.dataRange &&
      prev.seriesRange === next.seriesRange &&
      prev.categoryRange === next.categoryRange
    );
  }
  return false;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Create a CellDataAccessor that reads from Worksheet viewport (sync).
 * Replaced Cells.getDisplayValue with ws.viewport.getCellData.
 */
function createCellAccessor(
  ws: WorksheetWithInternals,
  _sheetId: string,
  sourceSheets?: Map<string, WorksheetWithInternals>,
): CellDataAccessor {
  return {
    getValue(row: number, col: number, sheetRef?: string) {
      const sourceWs = sheetRef ? (sheetRef === _sheetId ? ws : sourceSheets?.get(sheetRef)) : ws;
      if (!sourceWs) {
        return '';
      }
      // Use Worksheet viewport for sync cell reads
      const vpCell = sourceWs.viewport.getCellData(row, col);
      if (vpCell?.value != null) {
        // Return typed value directly — number stays number, string stays string
        if (typeof vpCell.value === 'number') return vpCell.value;
        if (typeof vpCell.value === 'string') return vpCell.value;
      }
      return '';
    },
  };
}

function collectChartSourceSheetNames(chart: StoredChartConfig): string[] {
  const refs = [
    chart.dataRange,
    chart.seriesRange,
    chart.categoryRange,
    ...(chart.series ?? []).flatMap((series) => [
      series.values,
      series.categories,
      series.bubbleSize,
    ]),
  ];
  const names = new Set<string>();
  for (const ref of refs) {
    if (!ref) continue;
    const parsed = parseCellRange(ref);
    if (parsed?.sheetName) {
      names.add(parsed.sheetName);
    }
  }
  return [...names];
}

async function resolveChartSourceSheets(
  wb: ReturnType<typeof useWorkbook>,
  chart: StoredChartConfig,
): Promise<Map<string, WorksheetWithInternals>> {
  const sourceSheets = new Map<string, WorksheetWithInternals>();
  await Promise.all(
    collectChartSourceSheetNames(chart).map(async (sheetName) => {
      try {
        sourceSheets.set(sheetName, await wb.getSheet(sheetName));
      } catch {
        // Missing sheet references are handled as blank chart values at render time.
      }
    }),
  );
  return sourceSheets;
}

/**
 * Resolve a CellId anchor to position coordinates using Worksheet API.
 */
async function resolveAnchorCellId(
  ws: WorksheetWithInternals,
  anchorCellId: string,
): Promise<{ row: number; col: number } | null> {
  const positions = await ws._internal.batchGetCellPositions([anchorCellId]);
  return positions.get(anchorCellId) ?? null;
}

/**
 * Get chart position, resolving CellId anchor if present.
 *
 * Handles twoCell mode, oneCell mode, and legacy position-based charts.
 */
async function getChartPosition(
  ws: WorksheetWithInternals,
  chart: StoredChartConfig,
): Promise<{ anchorRow: number; anchorCol: number; width: number; height: number } | null> {
  const sheetId = chart.sheetId;
  if (!sheetId) {
    return {
      anchorRow: chart.anchorRow,
      anchorCol: chart.anchorCol,
      width: chart.width,
      height: chart.height,
    };
  }

  if (chart.anchorCellId) {
    const resolved = await resolveAnchorCellId(ws, chart.anchorCellId);
    if (!resolved) return null;

    if (chart.anchorMode === 'twoCell' && chart.endAnchorCellId) {
      const endResolved = await resolveAnchorCellId(ws, chart.endAnchorCellId);
      if (!endResolved) {
        return {
          anchorRow: resolved.row,
          anchorCol: resolved.col,
          width: chart.width,
          height: chart.height,
        };
      }
      const width = Math.max(1, endResolved.col - resolved.col + 1);
      const height = Math.max(1, endResolved.row - resolved.row + 1);
      return { anchorRow: resolved.row, anchorCol: resolved.col, width, height };
    }

    return {
      anchorRow: resolved.row,
      anchorCol: resolved.col,
      width: chart.width,
      height: chart.height,
    };
  }

  return {
    anchorRow: chart.anchorRow,
    anchorCol: chart.anchorCol,
    width: chart.width,
    height: chart.height,
  };
}

/**
 * Get chart data range, resolving CellIdRange if present.
 */
async function getChartDataRange(
  ws: WorksheetWithInternals,
  chart: StoredChartConfig,
): Promise<CellRange | null> {
  const sheetId = chart.sheetId;
  if (!sheetId) {
    if (!chart.dataRange) return null;
    return parseCellRange(chart.dataRange);
  }

  if (chart.dataRangeIdentity) {
    const identity = chart.dataRangeIdentity;
    const positions = await ws._internal.batchGetCellPositions([
      identity.topLeftCellId,
      identity.bottomRightCellId,
    ]);
    const topLeft = positions.get(identity.topLeftCellId);
    const bottomRight = positions.get(identity.bottomRightCellId);
    if (!topLeft || !bottomRight) return null;
    return {
      sheetId,
      startRow: topLeft.row,
      startCol: topLeft.col,
      endRow: bottomRight.row,
      endCol: bottomRight.col,
    };
  }

  if (!chart.dataRange) return null;
  return parseCellRange(chart.dataRange);
}

/**
 * Convert a SerializedChart to a ChartDefinition with extracted data.
 *
 * Uses getChartPosition to resolve CellId-based anchors to positions.
 * This ensures charts move correctly when rows/cols are inserted/deleted.
 */
async function serializedToChartDefinition(
  wb: ReturnType<typeof useWorkbook>,
  ws: WorksheetWithInternals,
  serialized: SerializedChart,
): Promise<ChartDefinition> {
  // Resolve chart position using CellId if available
  const resolvedPosition = await getChartPosition(ws, serialized);

  // If position couldn't be resolved (anchor cell deleted), use stored position
  const anchorRow = resolvedPosition?.anchorRow ?? serialized.anchorRow;
  const anchorCol = resolvedPosition?.anchorCol ?? serialized.anchorCol;
  const width = resolvedPosition?.width ?? serialized.width;
  const height = resolvedPosition?.height ?? serialized.height;

  // Build chart config for data extraction
  const config: StoredChartConfig = {
    id: serialized.id,
    type: serialized.type,
    anchorRow,
    anchorCol,
    width,
    height,
    dataRange: serialized.dataRange,
    seriesRange: serialized.seriesRange,
    categoryRange: serialized.categoryRange,
    seriesOrientation: serialized.seriesOrientation,
    title: serialized.title,
    subtitle: serialized.subtitle,
    legend: serialized.legend,
    axis: serialized.axis,
    colors: serialized.colors,
    series: serialized.series,
    dataLabels: serialized.dataLabels,
    subType: serialized.subType,
  };

  // Extract chart data using resolved data range
  const dataRange = await getChartDataRange(ws, serialized);
  const sourceSheets = await resolveChartSourceSheets(wb, serialized);
  const cellAccessor = createCellAccessor(ws, serialized.sheetId ?? '', sourceSheets);
  let data: ChartData;

  if (dataRange && serialized.dataRangeIdentity) {
    // Use resolved CellIdRange for data extraction
    // This is the CRDT-safe path - data range automatically expands when rows/cols inserted
    data = extractChartDataFromRange(cellAccessor, dataRange, {
      seriesOrientation: serialized.seriesOrientation,
      // TODO: Also resolve series/category ranges when they use CellIdRange
    });
  } else {
    // Fallback to legacy A1-string extraction
    data = extractChartData(cellAccessor, config);
  }

  // Build chart position for overlay manager
  const position: ChartPosition = {
    anchorRow,
    anchorCol,
    widthCells: width,
    heightCells: height,
  };

  return {
    id: serialized.id,
    type: serialized.type,
    position,
    config,
    data,
  };
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook for managing charts in the spreadsheet with Yjs collaboration
 */
export function useCharts({ sheetId }: UseChartsOptions): UseChartsReturn {
  const wb = useWorkbook();

  // Get UI state from XState chart machine via useChartUI()
  const {
    selectedChartId,
    editingChartId,
    selectChart: selectChartAction,
    deselectChart,
    startEditing: startEditingAction,
    stopEditing: stopEditingAction,
    deleteSelectedChart: deleteSelectedChartAction,
  } = useChartUI();

  // Local state for charts from Yjs (updated via subscription)
  // Charts are sorted by z-order for correct rendering
  const [serializedCharts, setSerializedCharts] = useState<SerializedChart[]>([]);

  // Version counter to trigger re-render when cell data changes
  const [dataVersion, setDataVersion] = useState(0);

  // Per-chart memoization cache (persists across renders)
  // Prevents recreating ChartDefinition objects when only position changes
  // or when unrelated charts are modified
  const chartDefCache = useRef(new Map<string, ChartDefCacheEntry>());

  // Subscribe to chart changes
  // IMPORTANT: Re-fetch charts when sheetId changes (subscription may not fire immediately)
  useEffect(() => {
    let cancelled = false;
    // Get a unique ID for this hook instance
    const hookId = Math.random().toString(36).slice(2, 6);
    console.log(`[useCharts:${hookId}] subscribing to charts for sheet:`, sheetId);

    const ws = wb.getSheetById(sheetId);

    // Fetch all charts via Worksheet API and sort by z-order
    const fetchCharts = async () => {
      const allCharts = await ws.charts.list();
      if (cancelled) return;
      // Sort by z-order (matching getChartsInZOrder behavior)
      const sortedCharts = [...(allCharts as SerializedChart[])].sort((a, b) => {
        const zA = a.zIndex ?? 0;
        const zB = b.zIndex ?? 0;
        if (zA !== zB) return zA - zB;
        return (a.createdAt ?? 0) - (b.createdAt ?? 0);
      });
      console.log(
        `[useCharts:${hookId}] initial fetch for sheet:`,
        sortedCharts.length,
        sortedCharts.map((c: SerializedChart) => c.id),
      );
      setSerializedCharts(sortedCharts);
    };
    void fetchCharts();

    // Subscribe for future updates via ws.on()
    // Listen to all chart CRUD events to refresh chart list
    const chartHandler = () => {
      void (async () => {
        const allCharts = await ws.charts.list();
        if (cancelled) return;
        const sortedCharts = [...(allCharts as SerializedChart[])].sort((a, b) => {
          const zA = a.zIndex ?? 0;
          const zB = b.zIndex ?? 0;
          if (zA !== zB) return zA - zB;
          return (a.createdAt ?? 0) - (b.createdAt ?? 0);
        });
        console.log(
          `[useCharts:${hookId}] charts updated:`,
          sortedCharts.length,
          sortedCharts.map((c: SerializedChart) => c.id),
        );
        setSerializedCharts(sortedCharts);
      })();
    };

    const chartEvents = ['chart:created', 'chart:updated', 'chart:deleted', 'chart:moved'] as const;
    const unsubscribes = chartEvents.map((e) => ws.on(e, chartHandler));

    return () => {
      cancelled = true;
      console.log(`[useCharts:${hookId}] unsubscribing`);
      unsubscribes.forEach((u) => u());
    };
  }, [sheetId, wb]);

  // Subscribe to cell changes for all chart data ranges (reactive data binding)
  useEffect(() => {
    if (serializedCharts.length === 0) return;

    // Debounce updates to 60fps (16ms)
    let updateTimeout: ReturnType<typeof setTimeout> | null = null;
    const debouncedUpdate = () => {
      if (updateTimeout) clearTimeout(updateTimeout);
      updateTimeout = setTimeout(() => {
        setDataVersion((v) => v + 1);
      }, 16);
    };

    // Subscribe to cell change events via ws.on() (sheet-scoped)
    const ws = wb.getSheetById(sheetId);
    const unsubCell = ws.on('cellChanged', debouncedUpdate);
    const unsubBatch = ws.on('cells:batch-changed', debouncedUpdate);

    return () => {
      if (updateTimeout) clearTimeout(updateTimeout);
      unsubCell();
      unsubBatch();
    };
  }, [sheetId, serializedCharts, wb]);

  // Convert serialized charts to ChartDefinitions with resolved data
  // Per-chart memoization: only recompute charts that actually changed
  // This prevents chart renderer flicker when dragging charts (position-only updates)
  const [charts, setCharts] = useState<ChartDefinition[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function resolveCharts(): Promise<void> {
      const ws = wb.getSheetById(sheetId);
      const cache = chartDefCache.current;

      // Track which chart IDs are still present (for cache cleanup)
      const currentIds = new Set(serializedCharts.map((c) => c.id));

      // Clean up deleted charts from cache
      for (const id of cache.keys()) {
        if (!currentIds.has(id)) {
          cache.delete(id);
        }
      }

      const definitions = await Promise.all(
        serializedCharts.map(async (serialized) => {
          const cached = cache.get(serialized.id);

          if (cached) {
            // Case 1: Full cache hit - same serialized reference AND same dataVersion
            // Yjs maintains object identity when unchanged, so reference equality works
            if (cached.serialized === serialized && cached.dataVersion === dataVersion) {
              return cached.definition;
            }

            // Case 2: Position-only change - reuse config/data, update position only
            // This is the KEY fix for chart flickering during drag operations
            // chart renderer won't re-initialize because config/data objects are stable
            if (
              cached.dataVersion === dataVersion &&
              isOnlyPositionChange(cached.serialized, serialized)
            ) {
              // Create new definition with same config/data but updated position
              const newPosition: ChartPosition = {
                anchorRow: serialized.anchorRow,
                anchorCol: serialized.anchorCol,
                widthCells: serialized.width,
                heightCells: serialized.height,
              };

              const definition: ChartDefinition = {
                id: serialized.id,
                type: serialized.type,
                position: newPosition,
                config: cached.definition.config, // REUSE - prevents chart renderer flicker!
                data: cached.definition.data, // REUSE - prevents chart renderer flicker!
              };

              // Update cache with new serialized reference but same config/data
              cache.set(serialized.id, { serialized, dataVersion, definition });
              return definition;
            }
          }

          // Case 3: Cache miss - compute new definition
          // This happens when: new chart, config changed, or data changed
          // Pass ws for CellId resolution
          const definition = await serializedToChartDefinition(wb, ws, serialized);
          cache.set(serialized.id, { serialized, dataVersion, definition });
          return definition;
        }),
      );

      if (!cancelled) {
        setCharts(definitions);
      }
    }

    void resolveCharts();

    return () => {
      cancelled = true;
    };
  }, [serializedCharts, sheetId, wb, dataVersion]);

  // Add chart via Worksheet API (fire-and-forget)
  const addChart = useCallback(
    (config: StoredChartConfigCreateDraft): string => {
      const id = `chart-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const fullConfig = normalizeStoredChartConfig({ ...config, id });
      const ws = wb.getSheetById(sheetId);
      void ws.charts.add(fullConfig);
      return id;
    },
    [sheetId, wb],
  );

  // Update chart via Worksheet API (fire-and-forget)
  const updateChart = useCallback(
    (chartId: string, updates: StoredChartConfigUpdateDraft) => {
      const ws = wb.getSheetById(sheetId);
      void ws.charts.update(chartId, normalizeStoredChartConfigUpdate(updates));
    },
    [sheetId, wb],
  );

  // Update chart position via Worksheet API (fire-and-forget)
  const updateChartPosition = useCallback(
    (chartId: string, position: ChartPosition) => {
      const ws = wb.getSheetById(sheetId);
      void ws.charts.update(chartId, {
        anchorRow: position.anchorRow,
        anchorCol: position.anchorCol,
        width: position.widthCells,
        height: position.heightCells,
      });
    },
    [sheetId, wb],
  );

  // Remove chart via Worksheet API (fire-and-forget)
  const removeChart = useCallback(
    (chartId: string) => {
      const ws = wb.getSheetById(sheetId);
      void ws.charts.remove(chartId);

      // Clear selection if removed chart was selected
      if (selectedChartId === chartId) {
        deselectChart();
      }
    },
    [sheetId, wb, selectedChartId, deselectChart],
  );

  // Select chart
  const selectChart = useCallback(
    (chartId: string | null) => {
      if (chartId) {
        selectChartAction(chartId);
      } else {
        deselectChart();
      }
    },
    [selectChartAction, deselectChart],
  );

  // Start editing chart
  const startEditingChart = useCallback(
    (chartId: string | null) => {
      if (chartId) {
        // First select the chart, then start editing
        // The chart machine handles this: SELECT -> START_EDIT
        selectChartAction(chartId);
        startEditingAction();
      } else {
        stopEditingAction();
      }
    },
    [selectChartAction, startEditingAction, stopEditingAction],
  );

  // Stop editing chart
  const stopEditingChart = useCallback(() => {
    stopEditingAction();
  }, [stopEditingAction]);

  // Create chart from selection
  const createChartFromSelection = useCallback(
    (
      type: ChartType,
      dataRange: string,
      subType?: string,
      configOverrides?: StoredChartConfigUpdateDraft,
    ): string => {
      // Parse range to get positioning
      const range = parseRange(dataRange);

      // Position chart below and to the right of data
      const config: StoredChartConfigCreateDraft = {
        type,
        anchorRow: range.endRow + 2,
        anchorCol: range.startCol,
        width: 8, // cells
        height: 12, // cells
        dataRange,
        title: `${type.charAt(0).toUpperCase() + type.slice(1)} Chart`,
        legend: {
          show: true,
          position: 'bottom',
        },
        // Apply subType if provided (for variants like clustered, stacked, etc.)
        ...(subType ? { subType: subType as StoredChartConfig['subType'] } : {}),
        // Apply any additional config overrides (e.g., showMarkers for line charts)
        ...configOverrides,
      };

      return addChart(config);
    },
    [addChart],
  );

  // Delete selected chart
  const deleteSelectedChart = useCallback(() => {
    deleteSelectedChartAction();
  }, [deleteSelectedChartAction]);

  return {
    charts,
    selectedChartId,
    editingChartId,
    addChart,
    updateChart,
    updateChartPosition,
    removeChart,
    selectChart,
    startEditingChart,
    stopEditingChart,
    createChartFromSelection,
    deleteSelectedChart,
  };
}

// Re-export types for convenience
export type { ChartDefinition, ChartPosition, SerializedChart };
