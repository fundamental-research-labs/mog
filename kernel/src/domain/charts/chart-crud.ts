/**
 * Charts Domain Module
 *
 * All operations delegated to ComputeBridge (Rust compute core).
 *
 * Write operations (create, update, remove) delegate to ComputeBridge.
 * MutationResultHandler drives event emission -- no manual event emission here.
 *
 * Read operations (get, getAll) delegate to ComputeBridge and return Promises.
 *
 * Position/range resolution helpers (getChartPosition, getChartDataRange)
 * resolve CellId anchors via ComputeBridge.getCellPosition().
 *
 */

import { toCellId, type CellId, type CellIdRange } from '@mog-sdk/contracts/cell-identity';
import { type CellRange, type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import { parseCellRange } from '@mog/spreadsheet-utils/a1';

import type { ChartFloatingObject } from '../../bridges/compute/compute-bridge';
import type { DocumentContext } from '../../context/types';

export type ChartRangeKind = 'dataRange' | 'categoryRange' | 'seriesRange';

export interface ResolvedChartRangeReference {
  kind: ChartRangeKind;
  range: CellRange;
  source: 'identity' | 'a1';
  ref?: string;
}

export interface ChartRangeDiagnostic {
  kind: ChartRangeKind;
  code: 'MISSING_REF' | 'MALFORMED_A1' | 'UNKNOWN_SHEET' | 'DELETED_CELLS' | 'NO_CHART_SHEET';
  ref?: string;
  sheetName?: string;
  message: string;
}

export interface ResolvedChartRangeReferences {
  dataRange: ResolvedChartRangeReference | null;
  categoryRange: ResolvedChartRangeReference | null;
  seriesRange: ResolvedChartRangeReference | null;
  diagnostics: ChartRangeDiagnostic[];
}

// =============================================================================
// Create Chart
// =============================================================================

/**
 * Create a new chart on a sheet.
 *
 * Delegates to ComputeBridge. The Rust compute core handles CellId creation,
 * data range identity, and all serialization.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param config - Chart configuration
 */
export async function create(
  ctx: DocumentContext,
  sheetId: SheetId,
  config: ChartFloatingObject,
): Promise<string | undefined> {
  const result = await ctx.computeBridge.createChart(sheetId, config);
  // Extract the actual chart ID assigned by the Rust engine (it may differ from config.id)
  const change = result?.floatingObjectChanges?.[0];
  return change?.objectId ?? change?.data?.id ?? config.id;
}

// =============================================================================
// Update Chart
// =============================================================================

/**
 * Update an existing chart's configuration.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param chartId - Chart ID
 * @param updates - Partial chart updates
 */
export async function update(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
  updates: Partial<ChartFloatingObject>,
): Promise<void> {
  await ctx.computeBridge.updateChart(sheetId, chartId, updates as ChartFloatingObject);
}

// =============================================================================
// Delete Chart
// =============================================================================

/**
 * Delete a chart from a sheet.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param chartId - Chart ID
 */
export async function remove(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
): Promise<void> {
  await ctx.computeBridge.deleteChart(sheetId, chartId);
}

// =============================================================================
// Get Chart
// =============================================================================

/**
 * Get a chart by ID.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param chartId - Chart ID
 * @returns Chart or null
 */
export async function get(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
): Promise<ChartFloatingObject | null> {
  // Bridge returns FloatingObject; chart methods always return chart-type objects
  return ctx.computeBridge.getChart(sheetId, chartId) as Promise<ChartFloatingObject | null>;
}

// =============================================================================
// Get All Charts
// =============================================================================

/**
 * Get all charts for a sheet.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @returns Array of charts
 */
export async function getAll(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<ChartFloatingObject[]> {
  // Bridge returns FloatingObject[]; chart methods always return chart-type objects
  return ctx.computeBridge.getAllCharts(sheetId) as Promise<ChartFloatingObject[]>;
}

// =============================================================================
// Update Chart Position
// =============================================================================

/**
 * Update chart position (for drag/resize).
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param chartId - Chart ID
 * @param position - New position
 */
export async function updatePosition(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
  position: { anchorRow: number; anchorCol: number; width: number; height: number },
): Promise<void> {
  const chart = await get(ctx, sheetId, chartId);
  if (!chart) return;

  const updates: Partial<ChartFloatingObject> = {
    anchor: {
      ...chart.anchor,
      anchorRow: position.anchorRow,
      anchorCol: position.anchorCol,
    },
    widthCells: position.width,
    heightCells: position.height,
  };

  await update(ctx, sheetId, chartId, updates);
}

// =============================================================================
// CellIdRange Resolution Helpers (Cell Identity Model)
// =============================================================================
// Resolve CellId-based anchors to concrete row/col positions at render time
// via ComputeBridge.getCellPosition(). This is cell position lookup, not chart CRUD.

/**
 * Resolve a CellIdRange to a position-based CellRange.
 *
 * Called at render/extraction time, NOT stored.
 * Positions are derived from ComputeBridge.getCellPosition().
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param range - CellIdRange with corner CellIds
 * @returns Position-based CellRange, or null if either corner cell was deleted
 */
export async function resolveCellIdRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellIdRange,
): Promise<CellRange | null> {
  const [topLeft, bottomRight] = await Promise.all([
    ctx.computeBridge.getCellPosition(sheetId, range.topLeftCellId),
    ctx.computeBridge.getCellPosition(sheetId, range.bottomRightCellId),
  ]);

  if (!topLeft || !bottomRight) return null;

  return {
    sheetId,
    startRow: topLeft.row,
    startCol: topLeft.col,
    endRow: bottomRight.row,
    endCol: bottomRight.col,
  };
}

function normalizedRange(range: CellRange, sheetId: SheetId): CellRange {
  return {
    sheetId,
    startRow: Math.min(range.startRow, range.endRow),
    startCol: Math.min(range.startCol, range.endCol),
    endRow: Math.max(range.startRow, range.endRow),
    endCol: Math.max(range.startCol, range.endCol),
  };
}

async function resolveSheetName(ctx: DocumentContext, sheetName: string): Promise<SheetId | null> {
  const sheetIds = await ctx.computeBridge.getSheetOrder();
  const names = await Promise.all(
    sheetIds.map(async (id) => ({
      id: toSheetId(id),
      name: await ctx.computeBridge.getSheetName(toSheetId(id)),
    })),
  );
  const exact = names.find((s) => s.name === sheetName);
  if (exact) return exact.id;
  const folded = sheetName.toLocaleLowerCase();
  return names.find((s) => s.name?.toLocaleLowerCase() === folded)?.id ?? null;
}

async function resolveA1ChartRange(
  ctx: DocumentContext,
  chartSheetId: SheetId | null,
  kind: ChartRangeKind,
  ref: string | undefined,
  diagnostics: ChartRangeDiagnostic[],
): Promise<ResolvedChartRangeReference | null> {
  if (!ref) {
    if (kind === 'dataRange') {
      diagnostics.push({
        kind,
        code: 'MISSING_REF',
        message: 'Chart has no data range reference',
      });
    }
    return null;
  }

  const parsed = parseCellRange(ref);
  if (!parsed) {
    diagnostics.push({
      kind,
      code: 'MALFORMED_A1',
      ref,
      message: `Chart ${kind} is not a valid Excel A1 range`,
    });
    return null;
  }

  let sheetId = chartSheetId;
  if (parsed.sheetName) {
    sheetId = await resolveSheetName(ctx, parsed.sheetName);
    if (!sheetId) {
      diagnostics.push({
        kind,
        code: 'UNKNOWN_SHEET',
        ref,
        sheetName: parsed.sheetName,
        message: `Chart ${kind} references unknown sheet "${parsed.sheetName}"`,
      });
      return null;
    }
  } else if (!sheetId) {
    diagnostics.push({
      kind,
      code: 'NO_CHART_SHEET',
      ref,
      message: `Chart ${kind} is unqualified and the chart has no owning sheet`,
    });
    return null;
  }

  return {
    kind,
    range: normalizedRange(parsed, sheetId),
    source: 'a1',
    ref,
  };
}

function firstSeriesCategoryRangeRef(chart: ChartFloatingObject): string | undefined {
  for (const series of chart.series ?? []) {
    const ref = series.categories?.trim();
    if (ref) return ref;
  }
  return undefined;
}

async function resolveChartRangeReference(
  ctx: DocumentContext,
  chartSheetId: SheetId | null,
  chart: ChartFloatingObject,
  kind: ChartRangeKind,
  diagnostics: ChartRangeDiagnostic[],
): Promise<ResolvedChartRangeReference | null> {
  const identity =
    kind === 'dataRange'
      ? chart.dataRangeIdentity
      : kind === 'categoryRange'
        ? chart.categoryRangeIdentity
        : chart.seriesRangeIdentity;

  if (identity) {
    if (!chartSheetId) {
      diagnostics.push({
        kind,
        code: 'NO_CHART_SHEET',
        message: `Chart ${kind} identity is sheet-relative and the chart has no owning sheet`,
      });
      return null;
    }

    const range = await resolveCellIdRange(ctx, chartSheetId, identity);
    if (!range) {
      diagnostics.push({
        kind,
        code: 'DELETED_CELLS',
        message: `Chart ${kind} references deleted cells`,
      });
      return null;
    }
    return { kind, range: normalizedRange(range, chartSheetId), source: 'identity' };
  }

  const ref =
    kind === 'dataRange'
      ? chart.dataRange
      : kind === 'categoryRange'
        ? chart.categoryRange || firstSeriesCategoryRangeRef(chart)
        : chart.seriesRange;
  return resolveA1ChartRange(ctx, chartSheetId, kind, ref, diagnostics);
}

/**
 * Resolve all chart A1/identity references to workbook-scoped ranges.
 *
 * A1 strings accept Excel absolute markers and optional sheet names. Unqualified
 * references resolve against the chart's owning sheet. The returned ranges carry
 * `sheetId` so extraction and invalidation can read the referenced sheet rather
 * than the active/chart sheet.
 */
export async function resolveChartRangeReferences(
  ctx: DocumentContext,
  chart: ChartFloatingObject,
): Promise<ResolvedChartRangeReferences> {
  const chartSheetId = chart.sheetId ? toSheetId(chart.sheetId) : null;
  const diagnostics: ChartRangeDiagnostic[] = [];
  const [dataRange, categoryRange, seriesRange] = await Promise.all([
    resolveChartRangeReference(ctx, chartSheetId, chart, 'dataRange', diagnostics),
    resolveChartRangeReference(ctx, chartSheetId, chart, 'categoryRange', diagnostics),
    resolveChartRangeReference(ctx, chartSheetId, chart, 'seriesRange', diagnostics),
  ]);

  return { dataRange, categoryRange, seriesRange, diagnostics };
}

/**
 * Resolve a chart's anchor CellId to position coordinates.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param anchorCellId - CellId of the anchor cell
 * @returns Position { row, col } or null if cell was deleted
 */
export async function resolveAnchorCellId(
  ctx: DocumentContext,
  sheetId: SheetId,
  anchorCellId: CellId,
): Promise<{ row: number; col: number } | null> {
  const pos = await ctx.computeBridge.getCellPosition(sheetId, anchorCellId);
  if (!pos) return null;

  return { row: pos.row, col: pos.col };
}

/**
 * Get chart position, resolving CellId anchor if present.
 *
 * This is the primary position accessor for rendering. It handles:
 * - twoCell mode: Chart resizes based on both anchor cells (endAnchorCellId)
 * - oneCell mode: Chart moves with anchor but maintains fixed size
 * - Legacy position-based charts (anchorRow/anchorCol)
 *
 * @param ctx - Store context
 * @param chart - Chart configuration
 * @returns Position { anchorRow, anchorCol, width, height } or null if anchor deleted
 */
export async function getChartPosition(
  ctx: DocumentContext,
  chart: ChartFloatingObject,
): Promise<{ anchorRow: number; anchorCol: number; width: number; height: number } | null> {
  const rawSheetId = chart.sheetId;
  const anchorRow = chart.anchor.anchorRow;
  const anchorCol = chart.anchor.anchorCol;
  const chartWidth = chart.widthCells ?? chart.width ?? 4;
  const chartHeight = chart.heightCells ?? chart.height ?? 10;

  if (!rawSheetId) {
    return { anchorRow, anchorCol, width: chartWidth, height: chartHeight };
  }
  const sheetId = toSheetId(rawSheetId);

  if (chart.anchorCellId) {
    const resolved = await resolveAnchorCellId(ctx, sheetId, toCellId(chart.anchorCellId));
    if (!resolved) {
      return null;
    }

    if (chart.anchor.anchorMode === 'twoCell' && chart.toAnchorCellId) {
      const endResolved = await resolveAnchorCellId(ctx, sheetId, toCellId(chart.toAnchorCellId));
      if (!endResolved) {
        return {
          anchorRow: resolved.row,
          anchorCol: resolved.col,
          width: chartWidth,
          height: chartHeight,
        };
      }

      const width = Math.max(1, endResolved.col - resolved.col + 1);
      const height = Math.max(1, endResolved.row - resolved.row + 1);

      return {
        anchorRow: resolved.row,
        anchorCol: resolved.col,
        width,
        height,
      };
    }

    return {
      anchorRow: resolved.row,
      anchorCol: resolved.col,
      width: chartWidth,
      height: chartHeight,
    };
  }

  return { anchorRow, anchorCol, width: chartWidth, height: chartHeight };
}

/**
 * Get chart data range, resolving CellIdRange if present.
 *
 * This is the primary data range accessor for data extraction. It handles both:
 * - New CellIdRange-based charts (dataRangeIdentity)
 * - Legacy A1-string-based charts (dataRange)
 *
 * @param ctx - Store context
 * @param chart - Chart configuration
 * @returns CellRange or null if range is invalid
 */
export async function getChartDataRange(
  ctx: DocumentContext,
  chart: ChartFloatingObject,
): Promise<CellRange | null> {
  const resolved = await resolveChartRangeReferences(ctx, chart);
  return resolved.dataRange?.range ?? null;
}

// =============================================================================
// Z-Order Mutations
// =============================================================================

/**
 * Get the maximum zIndex among all charts on a sheet.
 * Returns 0 if no charts exist or none have zIndex set.
 */
export async function getMaxZIndex(ctx: DocumentContext, sheetId: SheetId): Promise<number> {
  const charts = await getAll(ctx, sheetId);
  if (charts.length === 0) return 0;

  let maxZ = 0;
  for (const chart of charts) {
    const z = chart.zIndex ?? 0;
    if (z > maxZ) maxZ = z;
  }
  return maxZ;
}

/**
 * Get the minimum zIndex among all charts on a sheet.
 * Returns 0 if no charts exist or none have zIndex set.
 */
export async function getMinZIndex(ctx: DocumentContext, sheetId: SheetId): Promise<number> {
  const charts = await getAll(ctx, sheetId);
  if (charts.length === 0) return 0;

  let minZ = Infinity;
  for (const chart of charts) {
    const z = chart.zIndex ?? 0;
    if (z < minZ) minZ = z;
  }
  return minZ === Infinity ? 0 : minZ;
}

/**
 * Bring a chart to the front (highest zIndex).
 * Sets zIndex to max + 1 among all charts on the sheet.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param chartId - Chart ID to bring to front
 */
export async function bringToFront(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
): Promise<void> {
  const chart = await get(ctx, sheetId, chartId);
  if (!chart) return;

  const maxZ = await getMaxZIndex(ctx, sheetId);
  const currentZ = chart.zIndex ?? 0;

  if (currentZ < maxZ || maxZ === 0) {
    await update(ctx, sheetId, chartId, { zIndex: maxZ + 1 });
  }
}

/**
 * Send a chart to the back (lowest zIndex).
 * Sets zIndex to min - 1 among all charts on the sheet.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param chartId - Chart ID to send to back
 */
export async function sendToBack(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
): Promise<void> {
  const chart = await get(ctx, sheetId, chartId);
  if (!chart) return;

  const minZ = await getMinZIndex(ctx, sheetId);
  const currentZ = chart.zIndex ?? 0;

  if (currentZ > minZ || minZ === 0) {
    await update(ctx, sheetId, chartId, { zIndex: minZ - 1 });
  }
}

/**
 * Bring a chart forward by one layer.
 * Swaps zIndex with the next chart in z-order.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param chartId - Chart ID to bring forward
 */
export async function bringForward(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
): Promise<void> {
  const chart = await get(ctx, sheetId, chartId);
  if (!chart) return;

  const charts = await getAll(ctx, sheetId);
  const currentZ = chart.zIndex ?? 0;

  let nextChart: ChartFloatingObject | null = null;
  let nextZ = Infinity;

  for (const c of charts) {
    if (c.id === chartId) continue;
    const z = c.zIndex ?? 0;
    if (z > currentZ && z < nextZ) {
      nextZ = z;
      nextChart = c;
    }
  }

  if (nextChart) {
    await update(ctx, sheetId, chartId, { zIndex: nextZ });
    await update(ctx, sheetId, nextChart.id, { zIndex: currentZ });
  } else {
    const maxZ = await getMaxZIndex(ctx, sheetId);
    await update(ctx, sheetId, chartId, { zIndex: maxZ + 1 });
  }
}

/**
 * Send a chart backward by one layer.
 * Swaps zIndex with the previous chart in z-order.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param chartId - Chart ID to send backward
 */
export async function sendBackward(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
): Promise<void> {
  const chart = await get(ctx, sheetId, chartId);
  if (!chart) return;

  const charts = await getAll(ctx, sheetId);
  const currentZ = chart.zIndex ?? 0;

  let prevChart: ChartFloatingObject | null = null;
  let prevZ = -Infinity;

  for (const c of charts) {
    if (c.id === chartId) continue;
    const z = c.zIndex ?? 0;
    if (z < currentZ && z > prevZ) {
      prevZ = z;
      prevChart = c;
    }
  }

  if (prevChart) {
    await update(ctx, sheetId, chartId, { zIndex: prevZ });
    await update(ctx, sheetId, prevChart.id, { zIndex: currentZ });
  } else {
    const minZ = await getMinZIndex(ctx, sheetId);
    await update(ctx, sheetId, chartId, { zIndex: minZ - 1 });
  }
}

/**
 * Get charts sorted by zIndex (for rendering order).
 * Lower zIndex charts are rendered first (behind higher ones).
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @returns Charts sorted by zIndex ascending
 */
export async function getChartsInZOrder(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<ChartFloatingObject[]> {
  const charts = await getAll(ctx, sheetId);
  return [...charts].sort((a, b) => {
    const zA = a.zIndex ?? 0;
    const zB = b.zIndex ?? 0;
    if (zA !== zB) return zA - zB;
    return (a.createdAt ?? 0) - (b.createdAt ?? 0);
  });
}

// =============================================================================
// Chart-Table Integration
// =============================================================================

/**
 * Link a chart to a table's data range.
 *
 * When a chart is linked to a table:
 * - The chart's data range automatically expands/contracts with the table
 * - Series labels can use table column names
 * - The chart respects table filters (if supported)
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param chartId - Chart ID
 * @param tableId - Table ID to link to
 * @param options - Optional: specific columns to use
 */
export async function linkChartToTable(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
  tableId: string,
  options?: {
    /** Specific column names to use for data (defaults to all data columns) */
    dataColumns?: string[];
    /** Column name to use for categories/X-axis */
    categoryColumn?: string;
    /** Use column names as series labels */
    useColumnNamesAsLabels?: boolean;
  },
): Promise<void> {
  const chart = await get(ctx, sheetId, chartId);
  if (!chart) return;

  // Use the bridge's native linkChartToTable which properly persists the link
  // in the Rust engine. The manual sourceTableId update via updateChart does
  // not round-trip through the floating-object mapper correctly.
  await ctx.computeBridge.linkChartToTable(sheetId, chartId, tableId);

  // Also store optional column mapping metadata via update
  if (
    options?.dataColumns ||
    options?.categoryColumn ||
    options?.useColumnNamesAsLabels !== undefined
  ) {
    await update(ctx, sheetId, chartId, {
      tableDataColumns: options?.dataColumns,
      tableCategoryColumn: options?.categoryColumn,
      useTableColumnNamesAsLabels: options?.useColumnNamesAsLabels ?? true,
    });
  }
}

/**
 * Unlink a chart from its source table.
 *
 * The chart will keep its current data range but will no longer
 * auto-update when the table changes.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param chartId - Chart ID
 */
export async function unlinkChartFromTable(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
): Promise<void> {
  const chart = await get(ctx, sheetId, chartId);
  if (!chart) return;

  // Use the bridge's native unlinkChartFromTable for proper persistence
  await ctx.computeBridge.unlinkChartFromTable(sheetId, chartId);
}

/**
 * Check if a chart is linked to a table.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param chartId - Chart ID
 * @returns True if chart is linked to a table
 */
export async function isChartLinkedToTable(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
): Promise<boolean> {
  // Use the bridge's native isChartLinkedToTable which checks the Rust engine
  // state directly, rather than relying on sourceTableId surviving the
  // floating-object mapper round-trip.
  return ctx.computeBridge.isChartLinkedToTable(sheetId, chartId);
}

/**
 * Get the table ID that a chart is linked to.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param chartId - Chart ID
 * @returns Table ID or undefined if not linked
 */
export async function getChartSourceTableId(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
): Promise<string | undefined> {
  const chart = await get(ctx, sheetId, chartId);
  return chart?.sourceTableId;
}

/**
 * Get all charts linked to a specific table.
 *
 * Useful for updating charts when a table changes.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param tableId - Table ID
 * @returns Array of charts linked to this table
 */
export async function getChartsLinkedToTable(
  ctx: DocumentContext,
  sheetId: SheetId,
  tableId: string,
): Promise<ChartFloatingObject[]> {
  const charts = await getAll(ctx, sheetId);
  return charts.filter((chart) => chart.sourceTableId === tableId);
}

/**
 * Update chart data range from its linked table.
 *
 * Call this when a table's range changes (e.g., rows added/removed)
 * to update the chart's data range to match.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param chartId - Chart ID
 * @param tableRange - Current table range
 * @param tableColumns - Current table column names (for series labels)
 */
export async function refreshChartTableLink(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
  tableRange: CellRange,
  tableColumns: string[],
): Promise<void> {
  const chart = await get(ctx, sheetId, chartId);
  if (!chart || !chart.sourceTableId) return;

  const seriesNames = chart.useTableColumnNamesAsLabels ? tableColumns : undefined;

  await update(ctx, sheetId, chartId, {
    // Data range will be resolved by the compute core from tableRange
    dataRange: `${String.fromCharCode(65 + tableRange.startCol)}${tableRange.startRow + 2}:${String.fromCharCode(65 + tableRange.endCol)}${tableRange.endRow + 1}`,
    tableColumnNames: seriesNames,
  });
}
