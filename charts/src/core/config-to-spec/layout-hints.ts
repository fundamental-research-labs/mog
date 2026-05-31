import type { ConfigSpec, EncodingSpec } from '../../grammar/spec';
import type { ChartConfig, ChartData } from '../../types';
import {
  estimateNominalYAxisLabelWidth,
  estimateSecondaryYAxisLabelWidth,
  estimateXAxisBottomMargin,
  estimateYAxisLabelWidth,
} from './layout-hints-axis';
import { dataTableLayoutHint } from './layout-hints-data-table';
import { manualLayoutFromValue } from './layout-hints-manual';

type LayoutHints = NonNullable<ConfigSpec['layoutHints']>;

export function buildLayoutHints(
  config: ChartConfig,
  encoding: EncodingSpec | undefined,
  data: ChartData | undefined,
): LayoutHints | undefined {
  const leftYAxisLabelWidth =
    estimateNominalYAxisLabelWidth(encoding, data) ?? estimateYAxisLabelWidth(encoding);
  const rightYAxisLabelWidth = estimateSecondaryYAxisLabelWidth(config, data);
  const bottomMargin = estimateXAxisBottomMargin(encoding);
  const manualPlotArea = manualLayoutFromValue(config.plotLayout ?? config.plotArea?.layout);
  const manualTitle = manualLayoutFromValue(config.titleLayout ?? config.chartTitle?.layout);
  const manualLegend = manualLayoutFromValue(config.legend?.layout);
  const dataTable = dataTableLayoutHint(config, data);

  if (
    leftYAxisLabelWidth === undefined &&
    rightYAxisLabelWidth === undefined &&
    bottomMargin === undefined &&
    manualPlotArea === undefined &&
    manualTitle === undefined &&
    manualLegend === undefined &&
    dataTable === undefined
  ) {
    return undefined;
  }

  return {
    ...(leftYAxisLabelWidth !== undefined
      ? { leftYAxisLabelWidth, yAxisLabelWidth: leftYAxisLabelWidth }
      : {}),
    ...(rightYAxisLabelWidth !== undefined ? { rightYAxisLabelWidth } : {}),
    ...(bottomMargin !== undefined ? { bottomMargin } : {}),
    ...(manualPlotArea !== undefined ? { manualPlotArea } : {}),
    ...(manualTitle !== undefined ? { manualTitle } : {}),
    ...(manualLegend !== undefined ? { manualLegend } : {}),
    ...(dataTable !== undefined ? { dataTable } : {}),
  };
}
