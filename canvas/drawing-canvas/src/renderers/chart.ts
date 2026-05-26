/**
 * Chart Renderer
 *
 * Renders ChartScene objects by delegating to the IChartRenderBridge.
 * The bridge encapsulates all chart rendering logic (layout, axes, series, etc.)
 * so this renderer is a thin delegation layer with transform and error handling.
 *
 * Pure function with per-object error boundary.
 *
 * @module @mog/drawing-canvas/renderers/chart
 */

import type { IChartRenderBridge } from '../bridges/types';
import type { ChartScene } from '../scene/types';
import { withRenderContext } from './render-utils';

// =============================================================================
// Chart Renderer
// =============================================================================

/**
 * Render a ChartScene object to a Canvas2D context.
 *
 * Pipeline:
 * 1. Apply rotation and flip transforms
 * 2. Delegate to chartBridge.renderChart()
 * 3. Error boundary: render placeholder on failure
 */
export function renderChart(
  ctx: CanvasRenderingContext2D,
  obj: ChartScene,
  chartBridge: IChartRenderBridge,
): void {
  withRenderContext(ctx, obj, 'Chart', () => {
    // Delegate all chart rendering to the bridge
    chartBridge.renderChart(obj.data.chartId, ctx, obj.bounds);
  });
}
