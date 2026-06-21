/**
 * Chart store operations.
 *
 * All operations delegate to ComputeBridge. MutationResultHandler drives event
 * emission for write operations; this module does not emit events manually.
 */

import type { SheetId } from '@mog-sdk/contracts/core';

import type { ChartFloatingObject } from '../../bridges/compute/compute-bridge';
import type { DocumentContext } from '../../context/types';
import {
  createChartMutationOptions,
  nextChartMutationOptions,
  type ChartMutationOptionsInput,
} from './chart-mutation-context';

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
  admissionOptions?: ChartMutationOptionsInput,
): Promise<string | undefined> {
  const result = await ctx.computeBridge.createChart(
    sheetId,
    config,
    chartStoreMutationOptions(ctx, sheetId, 'charts.create', admissionOptions),
  );
  // Extract the actual chart ID assigned by the Rust engine (it may differ from config.id)
  const change = result?.floatingObjectChanges?.[0];
  return change?.objectId ?? change?.data?.id ?? config.id;
}

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
  admissionOptions?: ChartMutationOptionsInput,
): Promise<void> {
  await ctx.computeBridge.updateChart(
    sheetId,
    chartId,
    updates as ChartFloatingObject,
    chartStoreMutationOptions(ctx, sheetId, 'charts.update', admissionOptions),
  );
}

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
  admissionOptions?: ChartMutationOptionsInput,
): Promise<void> {
  await ctx.computeBridge.deleteChart(
    sheetId,
    chartId,
    chartStoreMutationOptions(ctx, sheetId, 'charts.delete', admissionOptions),
  );
}

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

function chartStoreMutationOptions(
  ctx: DocumentContext,
  sheetId: SheetId,
  operationIdPrefix: string,
  admissionOptions: ChartMutationOptionsInput,
) {
  return (
    nextChartMutationOptions(admissionOptions) ??
    createChartMutationOptions(ctx, {
      operationIdPrefix,
      sheetIds: [sheetId],
    })
  );
}
