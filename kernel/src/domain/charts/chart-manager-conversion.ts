/**
 * Conversion helpers between chart-domain objects and floating-object views.
 */

import type { StoredChartConfig } from '@mog/charts';
import { toCellId } from '@mog-sdk/contracts/cell-identity';
import { type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { ObjectPosition } from '@mog-sdk/contracts/floating-objects';

import { normalizeImportedComboChart } from '../../bridges/compute/chart-import-normalization';
import type { ChartFloatingObject, ComputeBridge } from '../../bridges/compute/compute-bridge';
import { chartAnchorToPixels, pixelsToCells } from './chart-manager-dimensions';
import {
  DEFAULT_CHART_HEIGHT_PX,
  DEFAULT_CHART_WIDTH_PX,
  resolveStoredChartHeightCellSpan,
  resolveStoredChartHeightPixels,
  resolveStoredChartWidthCellSpan,
  resolveStoredChartWidthPixels,
} from './chart-size-units';
import type { ChartObject, ChartPosition } from './chart-manager-types';

/**
 * Convert a chart from the Charts domain to FloatingObject format.
 *
 * Async - uses ComputeBridge for dimension queries.
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

  const anchorPixels = await chartAnchorToPixels(
    anchorRow,
    anchorCol,
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
    x: anchorPixels.x,
    y: anchorPixels.y,
    width: resolveStoredChartWidthPixels(normalizedChart) ?? DEFAULT_CHART_WIDTH_PX,
    height: resolveStoredChartHeightPixels(normalizedChart) ?? DEFAULT_CHART_HEIGHT_PX,
    rotation: normalizedChart.rotation ?? 0,
    flipH: normalizedChart.flipH ?? false,
    flipV: normalizedChart.flipV ?? false,
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
    locked: normalizedChart.locked ?? false,
    printable: normalizedChart.printable ?? true,
    name: normalizedChart.name || normalizedChart.title || `Chart ${normalizedChart.id.slice(-4)}`,
    altText: normalizedChart.title,
    createdAt: normalizedChart.createdAt,
    updatedAt: normalizedChart.updatedAt,
    ...(normalizedChart.visible === false ? { visible: false } : {}),
  };

  return chartObject;
}

/**
 * Convert FloatingObject position back to chart position format.
 *
 * Async - uses ComputeBridge for dimension queries.
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
      widthCells:
        resolveStoredChartWidthCellSpan({
          width: position.width,
          widthCells: (obj.chartConfig as StoredChartConfig & { widthCells?: number }).widthCells,
        }) ?? 4,
      heightCells:
        resolveStoredChartHeightCellSpan({
          height: position.height,
          heightCells: (obj.chartConfig as StoredChartConfig & { heightCells?: number })
            .heightCells,
        }) ?? 10,
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
