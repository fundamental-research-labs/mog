/**
 * Chart floating-object bounds and hit-test helpers.
 */

import { pointInRect } from '@mog/geometry';
import type { SheetId } from '@mog-sdk/contracts/core';

import type { ChartFloatingObject, ComputeBridge } from '../../bridges/compute/compute-bridge';
import { cellsToPixels } from './chart-manager-dimensions';

export function chartNeedsPositionUpdate(chart: ChartFloatingObject): boolean {
  return Boolean(chart.anchorCellId);
}

/**
 * Async - uses ComputeBridge for dimension queries.
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
 * Async - uses ComputeBridge for dimension queries.
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
