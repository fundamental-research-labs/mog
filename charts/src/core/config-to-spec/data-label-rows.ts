import type { DataRow } from '../../grammar/spec';
import type { ChartConfig, ChartData, PointFormat, SeriesConfig } from '../../types';
import {
  buildPieLabelGeometries as buildPieLabelGeometriesForData,
  percentageForValue as percentageForLabelValue,
  seriesTotal as totalSeriesValues,
} from './data-label-geometry';
import { applyDataLabelToRow } from './data-label-row';

export interface PieLabelGeometry {
  cos: number;
  sin: number;
  innerRadiusRatio: number;
}

export function applyDataLabel(
  row: DataRow,
  context: {
    config?: ChartConfig;
    seriesConfig?: SeriesConfig;
    seriesName: string;
    sourceSeriesIndex: number;
    pointIndex: number;
    category: string | number;
    value: number;
    bubbleSize?: number;
    percentage?: number;
    pieLabelGeometry?: PieLabelGeometry;
  },
  pointFormat: PointFormat | undefined,
): void {
  applyDataLabelToRow(row, context, pointFormat);
}

export function seriesTotal(values: Array<{ y: number } | undefined>): number {
  return totalSeriesValues(values);
}

export function percentageForValue(value: number, total: number): number | undefined {
  return percentageForLabelValue(value, total);
}

export function buildPieLabelGeometries(
  data: ChartData,
  config?: ChartConfig,
): PieLabelGeometry[][] {
  return buildPieLabelGeometriesForData(data, config);
}
