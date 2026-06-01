import type { DataRow, UnitSpec } from '../../../grammar/spec';
import type { ChartConfig, ChartData, ChartDataPoint } from '../../../types';
import { CATEGORY_FIELD, VALUE_FIELD } from '../fields';

const PARETO_CUMULATIVE_PERCENT_FIELD = '__mogParetoCumulativePercent';

interface ParetoRow extends DataRow {
  [CATEGORY_FIELD]: string;
  [VALUE_FIELD]: number;
  [PARETO_CUMULATIVE_PERCENT_FIELD]: number;
  __mogParetoSourceIndex: number;
}

export function buildParetoLayers(
  config: ChartConfig,
  data: ChartData,
): {
  rows: DataRow[];
  layers: UnitSpec[];
} {
  const rows = buildParetoRows(data);
  const categoryDomain = rows.map((row) => row[CATEGORY_FIELD]);
  const barColor = config.colors?.[0] ?? '#4e79a7';
  const lineColor = config.colors?.[1] ?? '#d62728';

  return {
    rows,
    layers: [
      {
        mark: { type: 'bar', fill: barColor },
        encoding: {
          x: {
            field: CATEGORY_FIELD,
            type: 'nominal',
            scale: { domain: categoryDomain },
          },
          y: {
            field: VALUE_FIELD,
            type: 'quantitative',
            axis: config.axis?.valueAxis
              ? undefined
              : {
                  title: data.series[0]?.name ?? 'Value',
                },
          },
        },
      },
      {
        mark: { type: 'line', stroke: lineColor, strokeWidth: 2 },
        encoding: {
          x: {
            field: CATEGORY_FIELD,
            type: 'nominal',
            scale: { domain: categoryDomain },
          },
          y: {
            field: PARETO_CUMULATIVE_PERCENT_FIELD,
            type: 'quantitative',
            scale: { domain: [0, 100], zero: true, nice: false },
            axis: {
              orient: 'right',
              title: 'Cumulative %',
              grid: false,
            },
          },
        },
      },
    ],
  };
}

export function buildParetoRows(data: ChartData): ParetoRow[] {
  const rows = firstSeriesValues(data).sort((a, b) => {
    const valueOrder = b.value - a.value;
    return valueOrder === 0 ? a.index - b.index : valueOrder;
  });
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  let runningTotal = 0;

  return rows.map((row) => {
    runningTotal += row.value;
    return {
      [CATEGORY_FIELD]: String(row.category),
      [VALUE_FIELD]: row.value,
      [PARETO_CUMULATIVE_PERCENT_FIELD]: total > 0 ? (runningTotal / total) * 100 : 0,
      __mogParetoSourceIndex: row.index,
    };
  });
}

function firstSeriesValues(data: ChartData): Array<{
  category: string | number;
  value: number;
  index: number;
}> {
  const series = data.series[0];
  if (!series) return [];

  return series.data.flatMap((point, index) => {
    const value = finitePointValue(point);
    if (value === undefined) return [];
    const category = data.categories?.[index] ?? point.x ?? index + 1;
    return [{ category, value, index }];
  });
}

function finitePointValue(point: ChartDataPoint | undefined): number | undefined {
  if (!point || (point.valueState !== undefined && point.valueState !== 'value')) return undefined;
  return typeof point.y === 'number' && Number.isFinite(point.y) ? point.y : undefined;
}
