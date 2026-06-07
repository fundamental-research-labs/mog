import type { DataRow, UnitSpec } from '../../../grammar/spec';
import type { ChartConfig } from '../../../types';
import { DEFAULT_CATEGORY_COLORS } from '../../../utils/colors';
import {
  CATEGORY_FIELD,
  TREEMAP_FILL_FIELD,
  TREEMAP_X2_FIELD,
  TREEMAP_X_FIELD,
  TREEMAP_Y2_FIELD,
  TREEMAP_Y_FIELD,
} from '../fields';
import { categoryValueRows, positiveValue } from './category-value-rows';

export function buildTreemapLayers(
  config: ChartConfig,
  rows: DataRow[],
): {
  rows: DataRow[];
  layers: UnitSpec[];
} {
  const treemapRows = buildTreemapRows(config, rows);
  return {
    rows: treemapRows,
    layers: [
      {
        mark: {
          type: 'rect',
          coordinateSystem: 'plotFraction',
          xField: TREEMAP_X_FIELD,
          x2Field: TREEMAP_X2_FIELD,
          yField: TREEMAP_Y_FIELD,
          y2Field: TREEMAP_Y2_FIELD,
          fillField: TREEMAP_FILL_FIELD,
        },
      },
    ],
  };
}

export function buildTreemapRows(config: ChartConfig, rows: DataRow[]): DataRow[] {
  const sourceRows = categoryValueRows(rows);
  const total = sourceRows.reduce((sum, row) => sum + positiveValue(row), 0);
  if (total <= 0) return [];

  let x = 0;
  return sourceRows.map((row, index) => {
    const width = positiveValue(row) / total;
    const x2 = index === sourceRows.length - 1 ? 1 : x + width;
    const out = {
      ...row,
      [CATEGORY_FIELD]: row[CATEGORY_FIELD],
      [TREEMAP_X_FIELD]: x,
      [TREEMAP_X2_FIELD]: x2,
      [TREEMAP_Y_FIELD]: 0,
      [TREEMAP_Y2_FIELD]: 1,
      [TREEMAP_FILL_FIELD]: treemapColor(config, index),
    };
    x = x2;
    return out;
  });
}

function treemapColor(config: ChartConfig, index: number): string {
  return (
    config.colors?.[index] ??
    DEFAULT_CATEGORY_COLORS[index % DEFAULT_CATEGORY_COLORS.length] ??
    '#1f77b4'
  );
}
