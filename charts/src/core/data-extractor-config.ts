/**
 * ChartConfig-based data extraction orchestration.
 */
import type { ChartConfig, ChartData } from '../types';
import {
  extractChartDataFromSeriesRefs,
  hasRenderableImportedSeriesData,
} from './data-extractor-imported';
import { type CellDataAccessor, type CellRange, tryParseRange } from './data-extractor-primitives';
import { extractChartDataFromRange } from './data-extractor-range';
import { withSeriesConfigIdentity } from './series-identity';

/**
 * Extract chart data from a cell range
 *
 * @param accessor - The cell data accessor
 * @param config - Chart configuration with data range
 * @returns Extracted chart data ready for rendering
 */
export function extractChartData(accessor: CellDataAccessor, config: ChartConfig): ChartData {
  const importedSeries = config.series
    ?.map((seriesConfig, index) => withSeriesConfigIdentity(seriesConfig, index))
    .filter(hasRenderableImportedSeriesData);
  if (importedSeries?.length) {
    return extractChartDataFromSeriesRefs(
      accessor,
      importedSeries,
      config.categoryLabelLevel,
      config.type,
    );
  }

  if (!config.dataRange) {
    return { categories: [], series: [] };
  }

  const dataRange = tryParseRange(config.dataRange);
  if (!dataRange) {
    return { categories: [], series: [] };
  }

  const categoryRange = tryParseRange(config.categoryRange);
  const seriesRange = tryParseRange(config.seriesRange);
  const options: {
    categoryRange?: CellRange;
    chartType?: ChartConfig['type'];
    seriesRange?: CellRange;
    seriesOrientation?: ChartConfig['seriesOrientation'];
  } = {};
  options.chartType = config.type;
  if (categoryRange) options.categoryRange = categoryRange;
  if (seriesRange) options.seriesRange = seriesRange;
  if (config.seriesOrientation) options.seriesOrientation = config.seriesOrientation;

  return extractChartDataFromRange(accessor, dataRange, options);
}
