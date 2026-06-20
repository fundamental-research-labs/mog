import { detectSeriesOrientation } from '@mog/charts';
import type { Chart, SeriesConfig } from '@mog-sdk/contracts/data/charts';
import type { ChartSourceBindingAppModel } from '@mog-sdk/contracts/data/chart-app-model';
import { parseCellRange } from '@mog/spreadsheet-utils/a1';

function hasRenderablePointCache(cache: SeriesConfig['valueCache']): boolean {
  return Boolean(cache && ((cache.pointCount ?? 0) > 0 || cache.points.length > 0));
}

export function hasRenderableExplicitSeriesData(series: SeriesConfig): boolean {
  return Boolean(series.values?.trim()) || hasRenderablePointCache(series.valueCache);
}

function seriesBindingKind(series: readonly SeriesConfig[]): ChartSourceBindingAppModel['kind'] {
  const renderable = series.filter(hasRenderableExplicitSeriesData);
  if (renderable.length === 0) return 'partial';
  if (renderable.some((item) => item.valueSourceKind === 'literal')) return 'literalSeries';
  if (renderable.some((item) => hasRenderablePointCache(item.valueCache) && !item.values?.trim())) {
    return 'cacheBackedSeries';
  }
  return 'explicitSeries';
}

function orientationForDataRange(chart: Chart): ChartSourceBindingAppModel['orientation'] {
  if (chart.seriesOrientation) return chart.seriesOrientation;
  const parsed = parseCellRange(chart.dataRange ?? '');
  return parsed ? detectSeriesOrientation(parsed) : undefined;
}

export function chartSourceBindingFromChart(chart: Chart): ChartSourceBindingAppModel {
  const explicitSeries = chart.series ?? [];
  const renderableSeriesCount = explicitSeries.filter(hasRenderableExplicitSeriesData).length;
  if (explicitSeries.length > 0 && renderableSeriesCount > 0) {
    const kind = seriesBindingKind(explicitSeries);
    return {
      kind,
      orientation: chart.seriesOrientation,
      dataRange: chart.dataRange || undefined,
      categoryRange: chart.categoryRange,
      seriesRange: chart.seriesRange,
      explicitSeriesCount: explicitSeries.length,
      renderableSeriesCount,
      supportsOrientationSwitch: false,
      diagnostics: [
        'explicit-series-source-takes-precedence-over-series-orientation',
      ],
    };
  }

  if (chart.dataRange) {
    return {
      kind: explicitSeries.length > 0 ? 'partial' : 'range',
      orientation: orientationForDataRange(chart),
      dataRange: chart.dataRange,
      categoryRange: chart.categoryRange,
      seriesRange: chart.seriesRange,
      explicitSeriesCount: explicitSeries.length || undefined,
      renderableSeriesCount,
      supportsOrientationSwitch: explicitSeries.length === 0,
      diagnostics:
        explicitSeries.length > 0
          ? ['series-metadata-present-without-renderable-explicit-values']
          : [],
    };
  }

  return {
    kind: 'unsupported',
    explicitSeriesCount: explicitSeries.length || undefined,
    renderableSeriesCount,
    supportsOrientationSwitch: false,
    diagnostics: ['chart-has-no-renderable-source-binding'],
  };
}

export function toggleSeriesOrientation(
  orientation: ChartSourceBindingAppModel['orientation'],
): 'rows' | 'columns' {
  return orientation === 'rows' ? 'columns' : 'rows';
}
