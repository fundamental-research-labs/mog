import type { ChartConfig } from '@mog/charts';

type ChartSeriesConfig = NonNullable<ChartConfig['series']>[number];

export type SeriesMarkFamily = 'bar' | 'line' | 'area' | 'point' | 'other';

export function effectiveSeriesXRole(
  config: ChartConfig,
  series: ChartSeriesConfig | undefined,
  seriesType: string | undefined,
): 'category' | 'quantitative' | undefined {
  if (series?.xRole) return series.xRole;
  if (
    config.type === 'scatter' ||
    config.type === 'bubble' ||
    seriesType === 'scatter' ||
    seriesType === 'bubble'
  ) {
    return 'quantitative';
  }
  return series?.categories ? 'category' : undefined;
}

export function estimatedRenderLayerCount(
  config: ChartConfig,
  series: ChartSeriesConfig | undefined,
  seriesType: string | undefined,
  index: number,
): number {
  const type =
    seriesType ?? (config.type === 'combo' ? (index === 0 ? 'column' : 'line') : config.type);
  if (!isKnownRenderableSeriesType(type)) return 0;
  const markFamily = seriesMarkFamily(type);
  const showLines = effectiveSeriesShowLines(config, series, type);
  const showMarkers = effectiveSeriesShowMarkers(series, type, config.type, !showLines);
  if (markFamily === 'point') return (showLines ? 1 : 0) + (showMarkers ? 1 : 0);
  if (markFamily === 'line' || markFamily === 'area') {
    return (showLines ? 1 : 0) + (showMarkers ? 1 : 0);
  }
  return 1;
}

export function effectiveSeriesShowLines(
  config: ChartConfig,
  series: ChartSeriesConfig | undefined,
  seriesType: string,
): boolean {
  if (series?.showLines !== undefined) return series.showLines;
  if (seriesType === 'scatter' || seriesType === 'bubble') return config.showLines === true;
  const markFamily = seriesMarkFamily(seriesType);
  return markFamily === 'line' || markFamily === 'area';
}

export function effectiveSeriesShowMarkers(
  series: ChartSeriesConfig | undefined,
  seriesType: string | undefined,
  chartType: ChartConfig['type'],
  defaultValue = false,
): boolean {
  if (series?.markerStyle === 'none') return false;
  if (series?.showMarkers !== undefined) return series.showMarkers;
  if (series?.markerStyle !== undefined || series?.markerSize !== undefined) return true;
  if (
    series?.points?.some(
      (point) =>
        point.markerStyle !== undefined ||
        point.markerSize !== undefined ||
        point.markerBackgroundColor !== undefined ||
        point.markerForegroundColor !== undefined,
    )
  ) {
    return true;
  }
  return (
    chartType === 'lineMarkers' ||
    seriesType === 'lineMarkers' ||
    seriesType === 'lineMarkersStacked' ||
    seriesType === 'lineMarkersStacked100' ||
    defaultValue
  );
}

export function seriesMarkFamily(seriesType: string | undefined): SeriesMarkFamily {
  switch (seriesType) {
    case 'bar':
    case 'column':
    case 'bar3d':
    case 'column3d':
    case 'bar3D':
    case 'column3D':
    case 'cylinderColClustered':
    case 'cylinderColStacked':
    case 'cylinderColStacked100':
    case 'cylinderBarClustered':
    case 'cylinderBarStacked':
    case 'cylinderBarStacked100':
    case 'cylinderCol':
    case 'coneColClustered':
    case 'coneColStacked':
    case 'coneColStacked100':
    case 'coneBarClustered':
    case 'coneBarStacked':
    case 'coneBarStacked100':
    case 'coneCol':
    case 'pyramidColClustered':
    case 'pyramidColStacked':
    case 'pyramidColStacked100':
    case 'pyramidBarClustered':
    case 'pyramidBarStacked':
    case 'pyramidBarStacked100':
    case 'pyramidCol':
      return 'bar';
    case 'line':
    case 'line3d':
    case 'line3D':
    case 'lineMarkers':
    case 'lineMarkersStacked':
    case 'lineMarkersStacked100':
      return 'line';
    case 'area':
    case 'area3d':
    case 'area3D':
      return 'area';
    case 'scatter':
    case 'bubble':
    case 'bubble3DEffect':
      return 'point';
    default:
      return 'other';
  }
}

export function isKnownRenderableSeriesType(seriesType: string | undefined): boolean {
  return seriesMarkFamily(seriesType) !== 'other';
}
