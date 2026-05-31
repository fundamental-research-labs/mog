import type { DataRow, EncodingSpec, MarkType, Transform, UnitSpec } from '../../../grammar/spec';
import type { ChartConfig, ChartData, ChartType, SeriesConfig } from '../../../types';
import { buildAxisScaleSpec, mapAxisConfigToAxisSpec } from '../axis';
import { isBarLikeChartType } from '../bar-geometry';
import { MARK_TYPE_MAP } from '../constants';
import { buildEncoding } from '../encoding';
import {
  MARKER_FILL_FIELD,
  MARKER_SHAPE_FIELD,
  MARKER_SIZE_FIELD,
  MARKER_STROKE_FIELD,
  MARKER_VISIBLE_FIELD,
  SCATTER_X_FIELD,
  SERIES_FILL_FIELD,
  SERIES_INDEX_FIELD,
  SERIES_STROKE_FIELD,
  SERIES_STROKE_WIDTH_FIELD,
  VALUE_FIELD,
} from '../fields';
import { buildSeriesMark } from '../marks';
import { seriesConfigForDataSeries, seriesSourceIndex } from '../../series-identity';

/**
 * Build layers for combo and dual-axis charts where each series can own its
 * chart family, x-role, y-axis binding, line visibility, and marker overlay.
 */
export function buildComboLayers(
  config: ChartConfig,
  data: ChartData,
  _rows: DataRow[],
): UnitSpec[] {
  const layers: UnitSpec[] = [];
  const seriesConfigs = config.series ?? [];
  const baseEncoding = buildEncoding(config, data);
  const xEncoding = baseEncoding.x ?? { field: 'category', type: 'nominal' as const };
  const yEncoding = baseEncoding.y ?? { field: VALUE_FIELD, type: 'quantitative' as const };
  const emittedBarGroups = new Set<string>();

  for (let i = 0; i < data.series.length; i += 1) {
    const series = data.series[i];
    const seriesConf = seriesConfigForDataSeries(series, seriesConfigs, i);
    const sourceSeriesIndex = seriesSourceIndex(series, i);
    const fallbackComboType =
      config.type === 'combo' ? (i === 0 ? 'column' : 'line') : (config.type ?? 'line');
    const rawSeriesType = seriesConf?.type ?? series.type ?? fallbackComboType;
    if (!isSupportedChartType(rawSeriesType)) continue;

    const markType = MARK_TYPE_MAP[rawSeriesType];
    const encoding = buildSeriesEncoding({
      config,
      baseX: xEncoding,
      baseY: yEncoding,
      seriesConf,
      seriesYAxisIndex: series.yAxisIndex,
      seriesType: rawSeriesType,
    });
    const filter = seriesFilter(i);
    const showLine = effectiveShowLines(seriesConf, rawSeriesType, config);
    const showMarkers = effectiveShowMarkers(seriesConf, rawSeriesType, config, !showLine);

    if (markType === 'bar' && isBarLikeChartType(rawSeriesType)) {
      const yAxisIndex = normalizeYAxisIndex(seriesConf?.yAxisIndex ?? series.yAxisIndex);
      const groupKey = `bar:${yAxisIndex ?? 0}`;
      if (emittedBarGroups.has(groupKey)) continue;
      emittedBarGroups.add(groupKey);

      layers.push(
        buildBarGroupLayer({
          config,
          data,
          seriesConfigs,
          baseEncoding,
          encoding,
          yAxisIndex,
        }),
      );
      continue;
    }

    if (markType === 'point') {
      if (showLine) {
        layers.push(
          buildMainLayer('line', config, seriesConf, sourceSeriesIndex, rawSeriesType, encoding, filter),
        );
      }
      if (showMarkers) {
        layers.push(
          buildMarkerLayer(config, seriesConf, sourceSeriesIndex, rawSeriesType, encoding, filter),
        );
      }
      continue;
    }

    if ((markType === 'line' || markType === 'area') && !showLine) {
      if (showMarkers) {
        layers.push(
          buildMarkerLayer(config, seriesConf, sourceSeriesIndex, rawSeriesType, encoding, filter),
        );
      }
      continue;
    }

    layers.push(
      buildMainLayer(markType, config, seriesConf, sourceSeriesIndex, rawSeriesType, encoding, filter),
    );
    if ((markType === 'line' || markType === 'area') && showMarkers) {
      layers.push(
        buildMarkerLayer(config, seriesConf, sourceSeriesIndex, rawSeriesType, encoding, filter),
      );
    }
  }

  return layers;
}

function buildSeriesEncoding(input: {
  config: ChartConfig;
  baseX: NonNullable<EncodingSpec['x']>;
  baseY: NonNullable<EncodingSpec['y']>;
  seriesConf: SeriesConfig | undefined;
  seriesYAxisIndex: 0 | 1 | undefined;
  seriesType: ChartType;
}): EncodingSpec {
  const yAxisIndex = normalizeYAxisIndex(input.seriesConf?.yAxisIndex ?? input.seriesYAxisIndex);
  const encoding: EncodingSpec = {
    x: isQuantitativeXSeries(input.seriesConf, input.seriesType, input.config)
      ? quantitativeXEncoding(input.baseX)
      : { ...input.baseX },
    y: { ...input.baseY, field: VALUE_FIELD, type: 'quantitative' },
  };

  if (yAxisIndex === 1) {
    const secondaryAxis =
      input.config.axis?.secondaryValueAxis ?? input.config.axis?.secondaryYAxis;
    const secondaryAxisSpec = secondaryAxis
      ? mapAxisConfigToAxisSpec(secondaryAxis, input.config, 'secondaryValueAxis')
      : {};
    encoding.y = {
      field: VALUE_FIELD,
      type: 'quantitative',
      axis: {
        ...secondaryAxisSpec,
        orient: 'right',
        grid: secondaryAxisSpec.grid ?? false,
        title: secondaryAxisSpec.title ?? secondaryAxis?.title ?? null,
      },
    };
    if (secondaryAxis) {
      const scaleSpec = buildAxisScaleSpec(secondaryAxis, false);
      if (scaleSpec) encoding.y.scale = scaleSpec;
    }
  }

  return encoding;
}

function quantitativeXEncoding(baseX: NonNullable<EncodingSpec['x']>): NonNullable<EncodingSpec['x']> {
  return {
    field: SCATTER_X_FIELD,
    type: 'quantitative',
    axis: baseX.axis,
    scale: { zero: false, nice: true, ...(baseX.scale ?? {}) },
  };
}

function buildMainLayer(
  markType: MarkType,
  config: ChartConfig,
  seriesConf: SeriesConfig | undefined,
  seriesIndex: number,
  seriesType: ChartType,
  encoding: EncodingSpec,
  filter: Transform,
): UnitSpec {
  const mark = buildSeriesMark(markType, seriesConf, seriesIndex, seriesType, config);
  delete mark.point;
  if (markType === 'line' && (seriesConf?.smooth ?? config.smoothLines)) {
    mark.interpolate = 'monotone';
  }
  return {
    mark,
    encoding,
    transform: [filter],
  };
}

function buildMarkerLayer(
  config: ChartConfig,
  seriesConf: SeriesConfig | undefined,
  seriesIndex: number,
  seriesType: ChartType,
  encoding: EncodingSpec,
  filter: Transform,
): UnitSpec {
  const mark = buildSeriesMark('point', seriesConf, seriesIndex, seriesType, config);
  return {
    mark: { ...mark, type: 'point', strokeWidth: mark.strokeWidth ?? 1 },
    encoding: {
      x: encoding.x,
      y: encoding.y,
      size: { field: MARKER_SIZE_FIELD, type: 'quantitative', legend: null },
      shape: { field: MARKER_SHAPE_FIELD, type: 'nominal', legend: null },
      fill: { field: MARKER_FILL_FIELD, type: 'nominal', legend: null },
      stroke: { field: MARKER_STROKE_FIELD, type: 'nominal', legend: null },
    },
    transform: [filter, { type: 'filter', filter: { field: MARKER_VISIBLE_FIELD, equal: true } }],
  };
}

function buildBarGroupLayer(input: {
  config: ChartConfig;
  data: ChartData;
  seriesConfigs: SeriesConfig[];
  baseEncoding: EncodingSpec;
  encoding: EncodingSpec;
  yAxisIndex: 0 | 1 | undefined;
}): UnitSpec {
  const memberIndices = input.data.series
    .map((series, index) => {
      const seriesConf = seriesConfigForDataSeries(series, input.seriesConfigs, index);
      const fallbackComboType =
        input.config.type === 'combo' ? (index === 0 ? 'column' : 'line') : input.config.type;
      const rawSeriesType = seriesConf?.type ?? series.type ?? fallbackComboType;
      const yAxisIndex = normalizeYAxisIndex(seriesConf?.yAxisIndex ?? series.yAxisIndex);
      return { index, rawSeriesType, yAxisIndex };
    })
    .filter(
      (item) =>
        isSupportedChartType(item.rawSeriesType) &&
        isBarLikeChartType(item.rawSeriesType) &&
        (item.yAxisIndex ?? 0) === (input.yAxisIndex ?? 0),
    )
    .map((item) => item.index);

  return {
    mark: {
      type: 'bar',
      fillField: SERIES_FILL_FIELD,
      strokeField: SERIES_STROKE_FIELD,
      strokeWidthField: SERIES_STROKE_WIDTH_FIELD,
    },
    encoding: {
      ...input.encoding,
      ...(input.baseEncoding.color
        ? { color: { ...input.baseEncoding.color, legend: null } }
        : {}),
      ...(input.baseEncoding.opacity ? { opacity: { ...input.baseEncoding.opacity } } : {}),
    },
    transform: [{ type: 'filter', filter: { field: SERIES_INDEX_FIELD, oneOf: memberIndices } }],
  };
}

function seriesFilter(seriesIndex: number): Transform {
  return { type: 'filter', filter: { field: SERIES_INDEX_FIELD, equal: seriesIndex } };
}

function normalizeYAxisIndex(value: number | undefined): 0 | 1 | undefined {
  if (value === 0 || value === 1) return value;
  return undefined;
}

function isSupportedChartType(value: string | undefined): value is ChartType {
  return !!value && Object.prototype.hasOwnProperty.call(MARK_TYPE_MAP, value);
}

function isQuantitativeXSeries(
  seriesConf: SeriesConfig | undefined,
  seriesType: ChartType,
  config: ChartConfig,
): boolean {
  if (seriesConf?.xRole === 'quantitative') return true;
  if (seriesConf?.xRole === 'category') return false;
  return config.type === 'scatter' || config.type === 'bubble' || seriesType === 'scatter' || seriesType === 'bubble';
}

function effectiveShowLines(
  seriesConf: SeriesConfig | undefined,
  seriesType: ChartType,
  config: ChartConfig,
): boolean {
  if (seriesConf?.showLines !== undefined) return seriesConf.showLines;
  if (seriesType === 'scatter' || seriesType === 'bubble') return config.showLines === true;
  const markType = MARK_TYPE_MAP[seriesType];
  return markType === 'line' || markType === 'area';
}

function effectiveShowMarkers(
  seriesConf: SeriesConfig | undefined,
  seriesType: ChartType,
  config: ChartConfig,
  defaultValue: boolean,
): boolean {
  if (seriesConf?.markerStyle === 'none') return false;
  if (seriesConf?.showMarkers !== undefined) return seriesConf.showMarkers;
  if (seriesConf?.markerStyle !== undefined || seriesConf?.markerSize !== undefined) return true;
  if (
    seriesConf?.points?.some(
      (point) =>
        point.markerStyle !== undefined ||
        point.markerSize !== undefined ||
        point.markerBackgroundColor !== undefined ||
        point.markerForegroundColor !== undefined,
    )
  ) {
    return true;
  }
  return isMarkerDefaultSeries(seriesType, config.type) || defaultValue;
}

function isMarkerDefaultSeries(seriesType: ChartType, chartType: ChartConfig['type']): boolean {
  return (
    chartType === 'lineMarkers' ||
    seriesType === 'lineMarkers' ||
    seriesType === 'lineMarkersStacked' ||
    seriesType === 'lineMarkersStacked100'
  );
}
