import type { SheetId } from '@mog-sdk/contracts/core';
import type { CellsBatchChangedEvent } from '@mog-sdk/contracts/events';

import {
  chartOwnerSheetId,
  chartReferencesCell,
  getAllChartsInWorkbook,
  getChartInvalidationsAffectedByRange,
} from './chart-reference-invalidation';
import type { ChartBridgeSubscriptionContext } from './chart-bridge-subscription-context';

/**
 * Handle a cell change - invalidate any charts that reference this cell.
 */
export async function handleCellChange(
  deps: ChartBridgeSubscriptionContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<void> {
  if (!deps.isLive()) return;

  const charts = await getAllChartsInWorkbook(deps.ctx);
  if (!deps.isLive()) return;

  for (const chart of charts) {
    if (!deps.isLive()) return;
    const referencesCell = await chartReferencesCell(deps.ctx, chart, sheetId, row, col);
    if (!deps.isLive()) return;
    if (referencesCell) {
      deps.invalidateChart(chart.id, chartOwnerSheetId(chart) ?? sheetId);
    }
  }
}

export async function handleCellsBatchChange(
  deps: ChartBridgeSubscriptionContext,
  sheetId: SheetId,
  changes: CellsBatchChangedEvent['changes'],
): Promise<void> {
  if (!deps.isLive() || changes.length === 0) return;

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

  const affected = await getChartInvalidationsAffectedByRange(
    deps.ctx,
    sheetId,
    {
      sheetId,
      startRow,
      startCol,
      endRow,
      endCol,
    },
    { isLive: deps.isLive },
  );
  if (!deps.isLive()) return;
  for (const chart of affected) {
    deps.invalidateChart(chart.chartId, chart.sheetId);
  }
}
