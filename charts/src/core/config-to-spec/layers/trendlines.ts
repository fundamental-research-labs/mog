import type { DataRow, EncodingSpec, UnitSpec } from '../../../grammar/spec';
import type { ChartConfig, ChartData, TrendlineConfig } from '../../../types';
import { POINT_INDEX_FIELD, SERIES_FIELD, VALUE_FIELD } from '../fields';
import { buildTrendlineTransform, trendlineXFieldForChartType } from '../transforms';
import {
  normalizeTrendlines,
  sourceRows,
  trendlineResult,
  trendlineRows,
  usesComputedTrendlineRows,
} from './trendline-data';
import { buildTrendlineLabelLayer } from './trendline-labels';
import { buildTrendlineMark } from './trendline-mark';

export function buildTrendlineLayers(
  config: ChartConfig,
  data: ChartData,
  encoding: EncodingSpec,
  rows: DataRow[],
): UnitSpec[] {
  const layers: UnitSpec[] = [];
  const chartTrendlines = normalizeTrendlines(config.trendlines, config.trendline);
  for (const trendline of chartTrendlines) {
    layers.push(...buildTrendlineAndLabelLayers(config, encoding, rows, trendline));
  }

  for (let i = 0; i < data.series.length; i++) {
    const seriesName = data.series[i].name;
    const seriesConfig = config.series?.[i];
    for (const trendline of normalizeTrendlines(
      seriesConfig?.trendlines,
      seriesConfig?.trendline,
    )) {
      layers.push(...buildTrendlineAndLabelLayers(config, encoding, rows, trendline, seriesName));
    }
  }
  return layers;
}

function buildTrendlineAndLabelLayers(
  config: ChartConfig,
  encoding: EncodingSpec,
  rows: DataRow[],
  trendline: TrendlineConfig,
  seriesName?: string,
): UnitSpec[] {
  const layers: UnitSpec[] = [];
  const trendlineLayer = buildTrendlineLayer(config, encoding, rows, trendline, seriesName);
  if (trendlineLayer) layers.push(trendlineLayer);
  const labelLayer = buildTrendlineLabelLayer(config, rows, trendline, seriesName);
  if (labelLayer) layers.push(labelLayer);
  return layers;
}

function buildTrendlineLayer(
  config: ChartConfig,
  encoding: EncodingSpec,
  rows: DataRow[],
  trendline: TrendlineConfig,
  seriesName?: string,
): UnitSpec {
  const xField = trendlineXFieldForChartType(config.type);
  const mark = buildTrendlineMark(config, trendline);
  if (usesComputedTrendlineRows(trendline)) {
    const result = trendlineResult(sourceRows(rows, seriesName), xField, trendline);
    return {
      mark,
      data: { values: trendlineRows(result, xField) },
      encoding: trendlineEncoding(encoding, xField),
    };
  }

  const transform = [
    ...(seriesName
      ? [{ type: 'filter' as const, filter: { field: SERIES_FIELD, equal: seriesName } }]
      : []),
    ...buildTrendlineTransform(trendline, xField, VALUE_FIELD),
  ];
  return {
    mark,
    encoding: trendlineEncoding(encoding, xField),
    transform,
  };
}

function trendlineEncoding(encoding: EncodingSpec, xField: string): EncodingSpec {
  return {
    x:
      xField === POINT_INDEX_FIELD
        ? { field: POINT_INDEX_FIELD, type: 'quantitative' }
        : { ...encoding.x, field: xField, type: 'quantitative' },
    y: { ...encoding.y, field: VALUE_FIELD, type: 'quantitative' },
  };
}
