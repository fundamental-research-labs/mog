/**
 * Chart position helpers.
 *
 * CellId anchors resolve through ComputeBridge.getCellPosition() at render time.
 */

import { toCellId, type CellId } from '@mog-sdk/contracts/cell-identity';
import { type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';

import type { ChartFloatingObject } from '../../bridges/compute/compute-bridge';
import type { DocumentContext } from '../../context/types';
import {
  createChartMutationOptions,
  type ChartMutationOptionsInput,
} from './chart-mutation-context';
import { get, update } from './chart-store';
import {
  resolveStoredChartHeightCellSpan,
  resolveStoredChartWidthCellSpan,
} from './chart-size-units';

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
  admissionOptions?: ChartMutationOptionsInput,
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

  await update(
    ctx,
    sheetId,
    chartId,
    updates,
    admissionOptions ??
      createChartMutationOptions(ctx, {
        operationIdPrefix: 'charts.update',
        sheetIds: [sheetId],
      }),
  );
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
  const chartWidth = resolveStoredChartWidthCellSpan(chart) ?? 4;
  const chartHeight = resolveStoredChartHeightCellSpan(chart) ?? 10;

  if (!rawSheetId) {
    return { anchorRow, anchorCol, width: chartWidth, height: chartHeight };
  }
  const sheetId = toSheetId(rawSheetId);

  if (chart.anchorCellId) {
    const resolved = await resolveAnchorCellId(ctx, sheetId, toCellId(chart.anchorCellId));
    if (!resolved) {
      return { anchorRow, anchorCol, width: chartWidth, height: chartHeight };
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
