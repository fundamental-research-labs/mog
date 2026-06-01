import type { ChartConfig } from '@mog/charts';
import type { ResolvedChartSpecSnapshot } from '@mog-sdk/contracts/data/charts';

type ResolvedSnapshotSeries = ResolvedChartSpecSnapshot['resolved']['series'];

export function hasPictureMarkers(config: ChartConfig): boolean {
  return Boolean(
    config.series?.some(
      (series) =>
        series.markerStyle === 'picture' ||
        series.points?.some((point) => point.markerStyle === 'picture'),
    ),
  );
}

export function comboScatterSeriesDiagnostics(
  config: ChartConfig,
  series: ResolvedSnapshotSeries,
): string[] {
  const diagnostics: string[] = [];
  if (config.type === 'combo') {
    const xRoles = new Set(series.map((item) => item.xRole).filter(Boolean));
    if (xRoles.size > 1) {
      diagnostics.push(
        'combo chart mixes category and quantitative x roles; layers are rendered with per-series x encodings where possible',
      );
    }
  }

  for (const item of series) {
    if (item.type && item.renderLayerCount === 0) {
      diagnostics.push(
        `series ${item.sourceSeriesIndex} uses unsupported chart type "${item.type}" and is not rendered as a combo layer`,
      );
    }
    if (
      item.xRole === 'quantitative' &&
      !item.categories.some(
        (category, index) => typeof category === 'number' && item.values[index] !== null,
      )
    ) {
      diagnostics.push(
        `series ${item.sourceSeriesIndex} has no valid numeric x/y points for scatter rendering`,
      );
    }
    if (
      (item.type === 'scatter' || item.xRole === 'quantitative') &&
      item.showLines === false &&
      item.showMarkers === false &&
      item.markerStyle !== 'picture'
    ) {
      diagnostics.push(`series ${item.sourceSeriesIndex} has no visible line or marker channel`);
    }
  }

  return diagnostics;
}

export function hasSourceLinkedDataLabelFormatWithoutModeledFormat(config: ChartConfig): boolean {
  return dataLabelConfigs(config).some(
    (label) => label.linkNumberFormat === true && !label.numberFormat && !label.format,
  );
}

function dataLabelConfigs(config: ChartConfig): NonNullable<ChartConfig['dataLabels']>[] {
  const labels: NonNullable<ChartConfig['dataLabels']>[] = [];
  if (config.dataLabels) labels.push(config.dataLabels);
  for (const series of config.series ?? []) {
    if (series.dataLabels) labels.push(series.dataLabels);
    for (const point of series.points ?? []) {
      if (point.dataLabel) labels.push(point.dataLabel);
    }
  }
  return labels;
}
