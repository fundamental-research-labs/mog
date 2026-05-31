import type { EncodingSpec, MarkSpec, UnitSpec } from '../../../grammar/spec';
import type { ChartConfig, ChartData, TrendlineConfig } from '../../../types';
import { POINT_INDEX_FIELD, SERIES_FIELD, VALUE_FIELD } from '../fields';
import { buildTrendlineTransform, trendlineXFieldForChartType } from '../transforms';

export function buildTrendlineLayers(
  config: ChartConfig,
  data: ChartData,
  encoding: EncodingSpec,
): UnitSpec[] {
  const layers: UnitSpec[] = [];
  const chartTrendlines = normalizeTrendlines(config.trendlines, config.trendline);
  for (const trendline of chartTrendlines) {
    layers.push(buildTrendlineLayer(config, encoding, trendline));
  }

  for (let i = 0; i < data.series.length; i++) {
    const seriesName = data.series[i].name;
    const seriesConfig = config.series?.[i];
    for (const trendline of normalizeTrendlines(seriesConfig?.trendlines, seriesConfig?.trendline)) {
      layers.push(buildTrendlineLayer(config, encoding, trendline, seriesName));
    }
  }
  return layers;
}

function buildTrendlineLayer(
  config: ChartConfig,
  encoding: EncodingSpec,
  trendline: TrendlineConfig,
  seriesName?: string,
): UnitSpec {
  const xField = trendlineXFieldForChartType(config.type);
  const mark: MarkSpec = {
    type: 'line',
    stroke: trendline.color,
    strokeWidth: trendline.lineWidth ?? trendline.lineFormat?.width ?? 2,
    strokeDash: trendline.lineFormat?.dashStyle && trendline.lineFormat.dashStyle !== 'solid' ? [4, 4] : undefined,
  };
  const transform = [
    ...(seriesName ? [{ type: 'filter' as const, filter: { field: SERIES_FIELD, equal: seriesName } }] : []),
    ...buildTrendlineTransform(trendline, xField, VALUE_FIELD),
  ];
  return {
    mark,
    encoding: {
      x:
        xField === POINT_INDEX_FIELD
          ? { field: POINT_INDEX_FIELD, type: 'quantitative' }
          : { ...encoding.x, field: xField, type: 'quantitative' },
      y: { ...encoding.y, field: VALUE_FIELD, type: 'quantitative' },
    },
    transform,
  };
}

function normalizeTrendlines(
  trendlines: TrendlineConfig[] | undefined,
  singular: TrendlineConfig | undefined,
): TrendlineConfig[] {
  return [...(trendlines ?? []), ...(singular ? [singular] : [])].filter(
    (trendline) => trendline.show !== false,
  );
}
