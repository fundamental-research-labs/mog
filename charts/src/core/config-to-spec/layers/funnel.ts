import type { DataRow, UnitSpec } from '../../../grammar/spec';
import type { ChartConfig } from '../../../types';
import {
  CATEGORY_FIELD,
  FUNNEL_FILL_FIELD,
  FUNNEL_X2_FIELD,
  FUNNEL_X_FIELD,
  FUNNEL_Y2_FIELD,
  FUNNEL_Y_FIELD,
  SERIES_INDEX_FIELD,
  VALUE_FIELD,
} from '../fields';

const DEFAULT_FUNNEL_COLORS = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948'];

export function buildFunnelLayers(
  config: ChartConfig,
  rows: DataRow[],
): {
  rows: DataRow[];
  layers: UnitSpec[];
} {
  const funnelRows = buildFunnelRows(config, rows);
  return {
    rows: funnelRows,
    layers: [
      {
        mark: {
          type: 'rect',
          coordinateSystem: 'plotFraction',
          xField: FUNNEL_X_FIELD,
          x2Field: FUNNEL_X2_FIELD,
          yField: FUNNEL_Y_FIELD,
          y2Field: FUNNEL_Y2_FIELD,
          fillField: FUNNEL_FILL_FIELD,
          stroke: '#ffffff',
          strokeWidth: 1,
        },
      },
    ],
  };
}

export function buildFunnelRows(config: ChartConfig, rows: DataRow[]): DataRow[] {
  const sourceRows = firstSeriesRows(rows);
  const maxValue = sourceRows.reduce((max, row) => Math.max(max, positiveValue(row)), 0);
  const rowCount = sourceRows.length;
  if (rowCount === 0) return [];

  const rowHeight = 1 / rowCount;
  const rowGap = Math.min(0.025, rowHeight * 0.18);

  return sourceRows.map((row, index) => {
    const width = maxValue > 0 ? positiveValue(row) / maxValue : 0;
    const x = (1 - width) / 2;
    const y = index * rowHeight + rowGap / 2;
    return {
      ...row,
      [CATEGORY_FIELD]: row[CATEGORY_FIELD],
      [FUNNEL_X_FIELD]: x,
      [FUNNEL_X2_FIELD]: 1 - x,
      [FUNNEL_Y_FIELD]: y,
      [FUNNEL_Y2_FIELD]: (index + 1) * rowHeight - rowGap / 2,
      [FUNNEL_FILL_FIELD]: funnelColor(config, index),
    };
  });
}

function firstSeriesRows(rows: DataRow[]): DataRow[] {
  return rows.filter((row) => row[SERIES_INDEX_FIELD] === 0 && positiveValue(row) > 0);
}

function positiveValue(row: DataRow): number {
  const value = row[VALUE_FIELD];
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function funnelColor(config: ChartConfig, index: number): string {
  return config.colors?.[index] ?? DEFAULT_FUNNEL_COLORS[index % DEFAULT_FUNNEL_COLORS.length];
}
