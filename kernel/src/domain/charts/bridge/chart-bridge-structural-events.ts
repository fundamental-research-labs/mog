import type { SheetId } from '@mog-sdk/contracts/core';

import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';
import { getAll as getAllCharts, update as updateChart } from '../chart-store';
import type { ChartBridgeSubscriptionContext } from './chart-bridge-subscription-context';
import {
  buildStructuralRangeUpdate,
  type StructuralRangeUpdate,
} from './chart-structural-range-updates';

/**
 * Handle rows inserted - update legacy A1-string chart ranges for affected charts.
 */
export async function handleRowsInserted(
  deps: ChartBridgeSubscriptionContext,
  sheetId: SheetId,
  startRow: number,
  count: number,
): Promise<void> {
  if (!deps.isLive()) return;
  const charts = await getAllCharts(deps.ctx, sheetId);
  if (!deps.isLive()) return;

  for (const chart of charts) {
    if (!deps.isLive()) return;
    const result = buildStructuralRangeUpdate(chart, 'row', 'insert', startRow, count);
    await commitStructuralRangeUpdate(deps, sheetId, chart, result);
  }
}

/**
 * Handle rows deleted - update legacy A1-string chart ranges for affected charts.
 */
export async function handleRowsDeleted(
  deps: ChartBridgeSubscriptionContext,
  sheetId: SheetId,
  startRow: number,
  count: number,
): Promise<void> {
  if (!deps.isLive()) return;
  const charts = await getAllCharts(deps.ctx, sheetId);
  if (!deps.isLive()) return;

  for (const chart of charts) {
    if (!deps.isLive()) return;
    const result = buildStructuralRangeUpdate(chart, 'row', 'delete', startRow, count);
    await commitStructuralRangeUpdate(deps, sheetId, chart, result);
  }
}

/**
 * Handle columns inserted - update legacy A1-string chart ranges for affected charts.
 */
export async function handleColumnsInserted(
  deps: ChartBridgeSubscriptionContext,
  sheetId: SheetId,
  startCol: number,
  count: number,
): Promise<void> {
  if (!deps.isLive()) return;
  const charts = await getAllCharts(deps.ctx, sheetId);
  if (!deps.isLive()) return;

  for (const chart of charts) {
    if (!deps.isLive()) return;
    const result = buildStructuralRangeUpdate(chart, 'column', 'insert', startCol, count);
    await commitStructuralRangeUpdate(deps, sheetId, chart, result);
  }
}

/**
 * Handle columns deleted - update legacy A1-string chart ranges for affected charts.
 */
export async function handleColumnsDeleted(
  deps: ChartBridgeSubscriptionContext,
  sheetId: SheetId,
  startCol: number,
  count: number,
): Promise<void> {
  if (!deps.isLive()) return;
  const charts = await getAllCharts(deps.ctx, sheetId);
  if (!deps.isLive()) return;

  for (const chart of charts) {
    if (!deps.isLive()) return;
    const result = buildStructuralRangeUpdate(chart, 'column', 'delete', startCol, count);
    await commitStructuralRangeUpdate(deps, sheetId, chart, result);
  }
}

async function commitStructuralRangeUpdate(
  deps: ChartBridgeSubscriptionContext,
  sheetId: SheetId,
  chart: ChartFloatingObject,
  result: StructuralRangeUpdate,
): Promise<void> {
  const hasUpdates = Object.keys(result.updates).length > 0;
  if (!hasUpdates && !result.invalidate) return;

  if (hasUpdates) {
    await updateChart(deps.ctx, sheetId, chart.id, result.updates);
    if (!deps.isLive()) return;
  }

  deps.invalidateChart(chart.id, sheetId);
}
