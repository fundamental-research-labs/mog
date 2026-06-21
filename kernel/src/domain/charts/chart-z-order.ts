/**
 * Chart z-order operations.
 */

import type { SheetId } from '@mog-sdk/contracts/core';

import type { ChartFloatingObject } from '../../bridges/compute/compute-bridge';
import type { DocumentContext } from '../../context/types';
import { createGroupedChartMutationOptions } from './chart-mutation-context';
import { get, getAll, update } from './chart-store';

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
    await update(
      ctx,
      sheetId,
      chartId,
      { zIndex: maxZ + 1 },
      createGroupedChartMutationOptions(ctx, {
        operationIdPrefix: 'charts.bringToFront',
        sheetIds: [sheetId],
      }),
    );
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
    await update(
      ctx,
      sheetId,
      chartId,
      { zIndex: minZ - 1 },
      createGroupedChartMutationOptions(ctx, {
        operationIdPrefix: 'charts.sendToBack',
        sheetIds: [sheetId],
      }),
    );
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

  const nextOptions = createGroupedChartMutationOptions(ctx, {
    operationIdPrefix: 'charts.bringForward',
    sheetIds: [sheetId],
  });
  if (nextChart) {
    await update(ctx, sheetId, chartId, { zIndex: nextZ }, nextOptions);
    await update(ctx, sheetId, nextChart.id, { zIndex: currentZ }, nextOptions);
  } else {
    const maxZ = await getMaxZIndex(ctx, sheetId);
    await update(ctx, sheetId, chartId, { zIndex: maxZ + 1 }, nextOptions);
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

  const nextOptions = createGroupedChartMutationOptions(ctx, {
    operationIdPrefix: 'charts.sendBackward',
    sheetIds: [sheetId],
  });
  if (prevChart) {
    await update(ctx, sheetId, chartId, { zIndex: prevZ }, nextOptions);
    await update(ctx, sheetId, prevChart.id, { zIndex: currentZ }, nextOptions);
  } else {
    const minZ = await getMinZIndex(ctx, sheetId);
    await update(ctx, sheetId, chartId, { zIndex: minZ - 1 }, nextOptions);
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
