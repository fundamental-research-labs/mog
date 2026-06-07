import type { EncodingSpec, UnitSpec } from '../../../grammar/spec';
import type { ChartConfig, ChartData, ChartType, SeriesConfig } from '../../../types';
import { MARK_TYPE_MAP } from '../constants';
import { SERIES_INDEX_FIELD } from '../fields';
import { buildSeriesMark } from '../marks';
import { resolveSubTypeMarkProps } from '../subtypes';
import { withExcelCartesianGeometryMark } from '../excel-cartesian-geometry';

export function shouldBuildPerSeriesLineLayers(config: ChartConfig, data: ChartData): boolean {
  if (!isSimpleLineChartType(config.type)) return false;
  if (data.series.length <= 1) return false;

  const seriesConfigs = config.series ?? [];
  return data.series.some((series, index) =>
    hasPerSeriesLineStyle(seriesConfigForRenderedSeries(series, seriesConfigs, index)),
  );
}

export function buildPerSeriesLineLayers(
  config: ChartConfig,
  data: ChartData,
  encoding: EncodingSpec,
): UnitSpec[] {
  if (!encoding.x || !encoding.y) return [];

  const layers: UnitSpec[] = [];
  const seriesConfigs = config.series ?? [];
  const subProps = resolveSubTypeMarkProps(config);

  for (let index = 0; index < data.series.length; index += 1) {
    const series = data.series[index];
    const seriesConfig = seriesConfigForRenderedSeries(series, seriesConfigs, index);
    const seriesType = (seriesConfig?.type ?? series.type ?? config.type) as ChartType;
    const markType = MARK_TYPE_MAP[seriesType] ?? MARK_TYPE_MAP[config.type] ?? 'line';
    const mark = buildSeriesMark(
      markType,
      seriesConfig,
      sourceSeriesIndex(series, index),
      config.type,
      config,
    );
    if (subProps?.interpolate) mark.interpolate = subProps.interpolate;
    if (seriesConfig?.smooth === true) mark.interpolate = 'monotone';

    layers.push({
      mark: withExcelCartesianGeometryMark(mark, config, { yChannel: encoding.y }),
      encoding: {
        x: encoding.x,
        y: encoding.y,
      },
      transform: [{ type: 'filter', filter: { field: SERIES_INDEX_FIELD, equal: index } }],
    });
  }

  return layers;
}

function isSimpleLineChartType(type: ChartConfig['type']): boolean {
  return (
    type === 'line' ||
    type === 'line3d' ||
    type === 'lineMarkers' ||
    type === 'lineMarkersStacked' ||
    type === 'lineMarkersStacked100'
  );
}

function hasPerSeriesLineStyle(series: SeriesConfig | undefined): boolean {
  if (!series) return false;
  const line = series.format?.line;
  return Boolean(
    series.type !== undefined ||
    series.color !== undefined ||
    series.lineWidth !== undefined ||
    series.smooth !== undefined ||
    series.showMarkers !== undefined ||
    series.markerSize !== undefined ||
    series.markerStyle !== undefined ||
    series.format?.fill !== undefined ||
    line?.color !== undefined ||
    line?.width !== undefined ||
    line?.dashStyle !== undefined ||
    line?.transparency !== undefined ||
    line?.noFill !== undefined,
  );
}

function seriesConfigForRenderedSeries(
  series: ChartData['series'][number],
  seriesConfigs: SeriesConfig[],
  renderedIndex: number,
): SeriesConfig | undefined {
  const sourceIndex = sourceSeriesIndex(series, renderedIndex);
  return seriesConfigs[sourceIndex] ?? seriesConfigs[renderedIndex];
}

function sourceSeriesIndex(series: ChartData['series'][number], renderedIndex: number): number {
  return isFiniteNonNegativeInteger(series.sourceSeriesIndex)
    ? series.sourceSeriesIndex
    : renderedIndex;
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && Number.isFinite(value)
  );
}
