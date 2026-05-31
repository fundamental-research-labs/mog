/**
 * Chart manager public types and guards.
 */

import type { StoredChartConfig } from '@mog/charts';
import type { FloatingObjectBase } from '@mog-sdk/contracts/floating-objects';

/**
 * Chart represented as a FloatingObject for selection/interaction purposes.
 */
export interface ChartObject extends FloatingObjectBase {
  type: 'chart';
  chartId: string;
  chartType: string;
  chartConfig: StoredChartConfig;
}

/**
 * Chart position in cell coordinates (as stored in charts domain).
 */
export interface ChartPosition {
  anchorRow: number;
  anchorCol: number;
  widthCells: number;
  heightCells: number;
}

export function isChart(obj: { type: string }): obj is ChartObject {
  return obj.type === 'chart';
}

export function filterCharts(objects: Array<{ type: string }>): ChartObject[] {
  return objects.filter(isChart);
}
