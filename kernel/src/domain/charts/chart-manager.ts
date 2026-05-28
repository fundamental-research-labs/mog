/**
 * Chart Manager (Spreadsheet-Specific)
 *
 * Standalone functions for chart-specific floating object operations.
 * Bridges the gap between the Charts domain module and the FloatingObjectManager.
 *
 * This is spreadsheet-specific because:
 * - Charts use cell-based positioning (anchorRow/Col, widthCells/heightCells)
 * - Position conversion requires dimension lookups (cell widths/heights)
 * - Charts domain module uses cell coordinates for storage
 *
 * Uses ComputeBridge for dimension queries. Functions that perform
 * dimension queries are async.
 *
 * Architecture:
 * - Charts are NOT stored in floatingObjects CRDT map
 * - Charts have their own Y.Map<ChartFloatingObject> per sheet
 * - This module provides conversion functions, not CRUD operations
 * - CRUD operations are in spreadsheet-model/src/charts.ts
 *
 * @see charts/src/types/chart-types.ts - For StoredChartConfig, ChartConfig
 * @see spreadsheet-model/src/charts.ts - For chart CRUD operations
 */

import type { StoredChartConfig } from '@mog/charts';
import type { ChartFloatingObject } from '../../bridges/compute/compute-bridge';
import { normalizeImportedComboChart } from '../../bridges/compute/chart-import-normalization';
import { pointInRect } from '@mog/geometry';
import type { FloatingObjectBase, ObjectPosition } from '@mog-sdk/contracts/floating-objects';
import { toCellId } from '@mog-sdk/contracts/cell-identity';
import { type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';

import type { ComputeBridge } from '../../bridges/compute/compute-bridge';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Chart represented as a FloatingObject for selection/interaction purposes.
 */
export interface ChartObject extends FloatingObjectBase {
  type: 'chart';
  chartId: string;
  chartType: string;
  chartConfig: StoredChartConfig;
}

/**
 * Chart position in cell coordinates (as stored in charts domain).
 */
export interface ChartPosition {
  anchorRow: number;
  anchorCol: number;
  widthCells: number;
  heightCells: number;
}

// =============================================================================
// TYPE GUARD
// =============================================================================

export function isChart(obj: { type: string }): obj is ChartObject {
  return obj.type === 'chart';
}

// =============================================================================
// POSITION CONVERSION UTILITIES (async, using ComputeBridge)
// =============================================================================

/**
 * Convert cell-based dimensions to pixel-based dimensions.
 *
 * Async — uses ComputeBridge for dimension queries.
 */
export async function cellsToPixels(
  anchorRow: number,
  anchorCol: number,
  widthCells: number,
  heightCells: number,
  containerId: SheetId,
  computeBridge: ComputeBridge,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const x = await computeBridge.getColPosition(containerId, anchorCol);
  const y = await computeBridge.getRowPosition(containerId, anchorRow);

  // Calculate width by summing column widths
  let width = 0;
  for (let col = anchorCol; col < anchorCol + widthCells; col++) {
    width += await computeBridge.getColWidthFromIndex(containerId, col);
  }

  // Calculate height by summing row heights
  let height = 0;
  for (let row = anchorRow; row < anchorRow + heightCells; row++) {
    height += await computeBridge.getRowHeightFromIndex(containerId, row);
  }

  return { x, y, width, height };
}

/**
 * Convert pixel-based position to cell-based position.
 *
 * Async — uses ComputeBridge for dimension queries.
 */
export async function pixelsToCells(
  x: number,
  y: number,
  width: number,
  height: number,
  containerId: SheetId,
  computeBridge: ComputeBridge,
): Promise<{ anchorRow: number; anchorCol: number; widthCells: number; heightCells: number }> {
  // Find anchor column and row using binary search via bridge
  const anchorCol = await computeBridge.getColAtPixel(containerId, x);
  const anchorRow = await computeBridge.getRowAtPixel(containerId, y);

  // Calculate widthCells by iterating from anchor
  let widthCells = 0;
  let widthAccum = 0;
  let col = anchorCol;
  while (widthAccum < width && col < 16384) {
    widthAccum += await computeBridge.getColWidthFromIndex(containerId, col);
    widthCells++;
    col++;
  }
  widthCells = Math.max(1, widthCells);

  // Calculate heightCells by iterating from anchor
  let heightCells = 0;
  let heightAccum = 0;
  let row = anchorRow;
  while (heightAccum < height && row < 1048576) {
    heightAccum += await computeBridge.getRowHeightFromIndex(containerId, row);
    heightCells++;
    row++;
  }
  heightCells = Math.max(1, heightCells);

  return { anchorRow, anchorCol, widthCells, heightCells };
}

// =============================================================================
// CONVERSION FUNCTIONS
// =============================================================================

/**
 * Convert a chart from the Charts domain to FloatingObject format.
 *
 * Async — uses ComputeBridge for dimension queries.
 */
export async function convertChartToFloatingObject(
  chart: ChartFloatingObject,
  ctx: { computeBridge: ComputeBridge | null },
): Promise<ChartObject | null> {
  const normalizedChart = normalizeImportedComboChart(chart);

  if (!normalizedChart.sheetId) {
    console.warn('[ChartManager] Chart has no sheetId, cannot convert to floating object');
    return null;
  }
  const containerId: SheetId = toSheetId(normalizedChart.sheetId);

  if (!ctx.computeBridge) {
    console.warn('[ChartManager] No compute bridge, cannot convert chart position');
    return null;
  }

  const anchorRow = normalizedChart.anchor.anchorRow;
  const anchorCol = normalizedChart.anchor.anchorCol;
  const widthCells = normalizedChart.widthCells ?? normalizedChart.width;
  const heightCells = normalizedChart.heightCells ?? normalizedChart.height;

  const pixelBounds = await cellsToPixels(
    anchorRow,
    anchorCol,
    widthCells,
    heightCells,
    containerId,
    ctx.computeBridge,
  );

  // Charts get anchorCellId from ChartFloatingObject (wire data).
  // Rust handles CellId resolution internally.
  const fromAnchor = {
    cellId: toCellId(normalizedChart.anchorCellId ?? 'cell-0-0'),
    xOffset: 0,
    yOffset: 0,
  };

  const position: ObjectPosition = {
    anchorType: 'oneCell',
    from: fromAnchor,
    x: pixelBounds.x,
    y: pixelBounds.y,
    width: pixelBounds.width,
    height: pixelBounds.height,
    rotation: 0,
  };

  const chartObject: ChartObject = {
    id: normalizedChart.id,
    type: 'chart',
    sheetId: containerId,
    containerId,
    chartId: normalizedChart.id,
    chartType: normalizedChart.chartType,
    chartConfig: normalizedChart as unknown as StoredChartConfig,
    position,
    anchor: position,
    zIndex: normalizedChart.zIndex ?? 0,
    locked: false,
    printable: true,
    name: normalizedChart.title ?? `Chart ${normalizedChart.id.slice(-4)}`,
    altText: normalizedChart.title,
    createdAt: normalizedChart.createdAt,
    updatedAt: normalizedChart.updatedAt,
  };

  return chartObject;
}

/**
 * Convert FloatingObject position back to chart position format.
 *
 * Async — uses ComputeBridge for dimension queries.
 */
export async function convertFloatingObjectToChartPosition(
  obj: ChartObject,
  ctx: { computeBridge: ComputeBridge | null },
): Promise<ChartPosition> {
  const { position, sheetId: containerId } = obj;

  if (!ctx.computeBridge) {
    console.warn('[ChartManager] No compute bridge, using fallback position');
    return {
      anchorRow: obj.chartConfig.anchorRow,
      anchorCol: obj.chartConfig.anchorCol,
      widthCells: obj.chartConfig.width,
      heightCells: obj.chartConfig.height,
    };
  }

  const x = position.x ?? 0;
  const y = position.y ?? 0;
  const width = position.width ?? 200;
  const height = position.height ?? 150;

  const cellPosition = await pixelsToCells(x, y, width, height, containerId, ctx.computeBridge);

  return {
    anchorRow: cellPosition.anchorRow,
    anchorCol: cellPosition.anchorCol,
    widthCells: cellPosition.widthCells,
    heightCells: cellPosition.heightCells,
  };
}

// =============================================================================
// CHART FILTERING UTILITIES
// =============================================================================

export function filterCharts(objects: Array<{ type: string }>): ChartObject[] {
  return objects.filter(isChart);
}

export function chartNeedsPositionUpdate(chart: ChartFloatingObject): boolean {
  return Boolean(chart.anchorCellId);
}

// =============================================================================
// CHART BOUNDS UTILITIES
// =============================================================================

/**
 * Async — uses ComputeBridge for dimension queries.
 */
export async function calculateChartPixelBounds(
  chart: ChartFloatingObject,
  containerId: SheetId,
  computeBridge: ComputeBridge,
): Promise<{ x: number; y: number; width: number; height: number }> {
  return cellsToPixels(
    chart.anchor.anchorRow,
    chart.anchor.anchorCol,
    chart.widthCells ?? chart.width,
    chart.heightCells ?? chart.height,
    containerId,
    computeBridge,
  );
}

/**
 * Async — uses ComputeBridge for dimension queries.
 */
export async function isPointInChart(
  chart: ChartFloatingObject,
  x: number,
  y: number,
  containerId: SheetId,
  computeBridge: ComputeBridge,
): Promise<boolean> {
  const bounds = await calculateChartPixelBounds(chart, containerId, computeBridge);
  return pointInRect({ x, y }, bounds);
}
