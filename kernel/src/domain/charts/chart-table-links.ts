/**
 * Chart-table integration helpers.
 */

import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import { toA1 } from '@mog/spreadsheet-utils/a1';

import type { ChartFloatingObject } from '../../bridges/compute/compute-bridge';
import type { DocumentContext } from '../../context/types';
import {
  createChartMutationOptions,
  createGroupedChartMutationOptions,
  nextChartMutationOptions,
  type ChartMutationOptionsInput,
} from './chart-mutation-context';
import { get, getAll, update } from './chart-store';

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
  admissionOptions?: ChartMutationOptionsInput,
): Promise<void> {
  const chart = await get(ctx, sheetId, chartId);
  if (!chart) return;

  const nextOptions =
    admissionOptions ??
    createGroupedChartMutationOptions(ctx, {
      operationIdPrefix: 'charts.linkToTable',
      sheetIds: [sheetId],
    });

  // Use the bridge's native linkChartToTable which properly persists the link
  // in the Rust engine. The manual sourceTableId update via updateChart does
  // not round-trip through the floating-object mapper correctly.
  await ctx.computeBridge.linkChartToTable(
    sheetId,
    chartId,
    tableId,
    nextChartMutationOptions(nextOptions),
  );

  // Also store optional column mapping metadata via update
  if (
    options?.dataColumns ||
    options?.categoryColumn ||
    options?.useColumnNamesAsLabels !== undefined
  ) {
    await update(
      ctx,
      sheetId,
      chartId,
      {
        tableDataColumns: options?.dataColumns,
        tableCategoryColumn: options?.categoryColumn,
        useTableColumnNamesAsLabels: options?.useColumnNamesAsLabels ?? true,
      },
      nextOptions,
    );
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
  admissionOptions?: ChartMutationOptionsInput,
): Promise<void> {
  const chart = await get(ctx, sheetId, chartId);
  if (!chart) return;

  // Use the bridge's native unlinkChartFromTable for proper persistence
  await ctx.computeBridge.unlinkChartFromTable(
    sheetId,
    chartId,
    nextChartMutationOptions(admissionOptions) ??
      createChartMutationOptions(ctx, {
        operationIdPrefix: 'charts.unlinkFromTable',
        sheetIds: [sheetId],
      }),
  );
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
  admissionOptions?: ChartMutationOptionsInput,
): Promise<void> {
  const chart = await get(ctx, sheetId, chartId);
  if (!chart || !chart.sourceTableId) return;

  const seriesNames = chart.useTableColumnNamesAsLabels ? tableColumns : undefined;

  await update(
    ctx,
    sheetId,
    chartId,
    {
      // Data range will be resolved by the compute core from tableRange
      dataRange: `${toA1(tableRange.startRow + 1, tableRange.startCol)}:${toA1(tableRange.endRow, tableRange.endCol)}`,
      tableColumnNames: seriesNames,
    },
    admissionOptions ??
      createChartMutationOptions(ctx, {
        operationIdPrefix: 'charts.update',
        sheetIds: [sheetId],
      }),
  );
}
