/**
 * Chart floating-object bounds and hit-test helpers.
 */

import { pointInRect } from '@mog/geometry';
import type { SheetId } from '@mog-sdk/contracts/core';

import type { ChartFloatingObject, ComputeBridge } from '../../bridges/compute/compute-bridge';
import { chartAnchorToPixels } from './chart-manager-dimensions';
import {
  DEFAULT_CHART_HEIGHT_PX,
  DEFAULT_CHART_WIDTH_PX,
  resolveStoredChartHeightPixels,
  resolveStoredChartWidthPixels,
} from './chart-size-units';

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
  const anchor = await chartAnchorToPixels(
    chart.anchor.anchorRow,
    chart.anchor.anchorCol,
    containerId,
    computeBridge,
  );

  return {
    ...anchor,
    width: resolveStoredChartWidthPixels(chart) ?? DEFAULT_CHART_WIDTH_PX,
    height: resolveStoredChartHeightPixels(chart) ?? DEFAULT_CHART_HEIGHT_PX,
  };
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
