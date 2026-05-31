import {
  chartDataToRows as chartDataToCoreRows,
  seriesSourceIndex,
  seriesSourceKey,
  type ChartConfig,
  type ChartData,
} from '@mog/charts';

export function chartDataToRows(data: ChartData, config?: ChartConfig): Record<string, unknown>[] {
  if (config) {
    return chartDataToCoreRows(data, config).map(withPublicCompatibilityFields);
  }

  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < (data.categories?.length || 0); i++) {
    const category = data.categories[i];
    for (let seriesIndex = 0; seriesIndex < data.series.length; seriesIndex += 1) {
      const series = data.series[seriesIndex];
      const point = series.data[i];
      if (!point) continue;
      if (point.valueState === 'hidden') continue;
      const row: Record<string, unknown> = {
        category: String(category),
        x: point.x,
        y: point.y,
        value: point.y,
        series: series.name,
        sourceSeriesIndex: seriesSourceIndex(series, seriesIndex),
        sourceSeriesKey: seriesSourceKey(series, seriesIndex),
      };
      if (point.size !== undefined) row.size = point.size;
      if (point.open !== undefined) row.open = point.open;
      if (point.high !== undefined) row.high = point.high;
      if (point.low !== undefined) row.low = point.low;
      if (point.close !== undefined) row.close = point.close;
      if (point.volume !== undefined) row.volume = point.volume;
      rows.push(row);
    }
  }
  return rows;
}

function withPublicCompatibilityFields(row: Record<string, unknown>): Record<string, unknown> {
  const next = { ...row };
  if (!('x' in next) && 'category' in next) next.x = next.category;
  if (!('y' in next) && 'value' in next) next.y = next.value;
  return next;
}
