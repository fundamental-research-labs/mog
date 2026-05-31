import type { ChartConfig, ChartData, ChartType, SeriesConfig } from '../../../types';
import { isBarLikeChartType } from '../bar-geometry';
import { MARK_TYPE_MAP } from '../constants';

export function resolveComboSeriesType(
  config: ChartConfig,
  series: ChartData['series'][number],
  seriesConf: SeriesConfig | undefined,
  index: number,
): string | undefined {
  const fallbackComboType =
    config.type === 'combo' ? (index === 0 ? 'column' : 'line') : (config.type ?? 'line');
  return seriesConf?.type ?? series.type ?? fallbackComboType;
}

export function shouldGroupAsBarSeries(seriesType: string | undefined): seriesType is ChartType {
  return isSupportedChartType(seriesType) && isBarLikeChartType(seriesType);
}

export function normalizeYAxisIndex(value: number | undefined): 0 | 1 | undefined {
  if (value === 0 || value === 1) return value;
  return undefined;
}

export function isSupportedChartType(value: string | undefined): value is ChartType {
  return !!value && Object.prototype.hasOwnProperty.call(MARK_TYPE_MAP, value);
}

export function isQuantitativeXSeries(
  seriesConf: SeriesConfig | undefined,
  seriesType: ChartType,
  config: ChartConfig,
): boolean {
  if (seriesConf?.xRole === 'quantitative') return true;
  if (seriesConf?.xRole === 'category') return false;
  return (
    config.type === 'scatter' ||
    config.type === 'bubble' ||
    seriesType === 'scatter' ||
    seriesType === 'bubble'
  );
}

export function effectiveShowLines(
  seriesConf: SeriesConfig | undefined,
  seriesType: ChartType,
  config: ChartConfig,
): boolean {
  if (seriesConf?.showLines !== undefined) return seriesConf.showLines;
  if (seriesType === 'scatter' || seriesType === 'bubble') return config.showLines === true;
  const markType = MARK_TYPE_MAP[seriesType];
  return markType === 'line' || markType === 'area';
}

export function effectiveShowMarkers(
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
