import type { ChartConfig } from '@mog/charts';

export function hasManualPlotLayout(config: ChartConfig): boolean {
  return Boolean(config.plotLayout || config.plotArea?.layout);
}

export function hasManualTitleLayout(config: ChartConfig): boolean {
  return Boolean(config.titleLayout || config.chartTitle?.layout);
}

export function hasManualLegendLayout(config: ChartConfig): boolean {
  return Boolean(config.legend?.layout);
}

export function pivotFieldButtonDiagnostic(config: ChartConfig): string {
  const flags = [
    config.showAllFieldButtons !== undefined ? 'showAllFieldButtons' : undefined,
    config.pivotOptions?.showAxisFieldButtons !== undefined ? 'showAxisFieldButtons' : undefined,
    config.pivotOptions?.showLegendFieldButtons !== undefined
      ? 'showLegendFieldButtons'
      : undefined,
    config.pivotOptions?.showReportFilterFieldButtons !== undefined
      ? 'showReportFilterFieldButtons'
      : undefined,
    config.pivotOptions?.showValueFieldButtons !== undefined ? 'showValueFieldButtons' : undefined,
  ].filter(Boolean);
  return flags.length > 0
    ? `pivot chart field buttons are preserved but not rendered (${flags.join(', ')})`
    : 'pivot chart field buttons are preserved but not rendered';
}

export function hasManualDataLabelLayout(config: ChartConfig): boolean {
  return Boolean(
    config.dataLabels?.layout ||
    config.series?.some(
      (series) =>
        series.dataLabels?.layout || series.points?.some((point) => point.dataLabel?.layout),
    ),
  );
}
