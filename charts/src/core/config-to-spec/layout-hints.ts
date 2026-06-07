import type { ConfigSpec, EncodingSpec } from '../../grammar/spec';
import type { ChartConfig, ChartData } from '../../types';
import {
  categoryAxisLabelsInsidePlot,
  estimateBarColumnAxisReservations,
  estimateNominalYAxisLabelWidth,
  estimatePathChartAxisReservations,
  estimateSecondaryYAxisLabelWidth,
  estimateXAxisBottomMargin,
  estimateYAxisLabelWidth,
} from './layout-hints-axis';
import { dataTableLayoutHint } from './layout-hints-data-table';
import { manualLayoutFromValue } from './layout-hints-manual';
import { pieDoughnutLayoutHintsForConfig } from './pie-doughnut-geometry';

type LayoutHints = NonNullable<ConfigSpec['layoutHints']>;

export function buildLayoutHints(
  config: ChartConfig,
  encoding: EncodingSpec | undefined,
  data: ChartData | undefined,
): LayoutHints | undefined {
  const leftYAxisLabelWidth =
    estimateNominalYAxisLabelWidth(encoding, data) ?? estimateYAxisLabelWidth(encoding);
  const rightYAxisLabelWidth = estimateSecondaryYAxisLabelWidth(config, data);
  const bottomMargin = estimateXAxisBottomMargin(encoding, data);
  const axisReservations =
    estimateBarColumnAxisReservations(config, encoding, data) ??
    estimatePathChartAxisReservations(config, encoding, data);
  const xAxisLabelsInsidePlot = categoryAxisLabelsInsidePlot('x', encoding, data);
  const yAxisLabelsInsidePlot = categoryAxisLabelsInsidePlot('y', encoding, data);
  const manualPlotArea = manualLayoutFromValue(config.plotLayout ?? config.plotArea?.layout);
  const manualTitle = manualLayoutFromValue(config.titleLayout ?? config.chartTitle?.layout);
  const manualLegend = manualLayoutFromValue(config.legend?.layout);
  const dataTable = dataTableLayoutHint(config, data);
  const pieDoughnut = pieDoughnutLayoutHintsForConfig(config, data);

  if (
    leftYAxisLabelWidth === undefined &&
    rightYAxisLabelWidth === undefined &&
    bottomMargin === undefined &&
    axisReservations === undefined &&
    !xAxisLabelsInsidePlot &&
    !yAxisLabelsInsidePlot &&
    manualPlotArea === undefined &&
    manualTitle === undefined &&
    manualLegend === undefined &&
    dataTable === undefined &&
    pieDoughnut === undefined
  ) {
    return undefined;
  }

  return {
    ...(leftYAxisLabelWidth !== undefined
      ? { leftYAxisLabelWidth, yAxisLabelWidth: leftYAxisLabelWidth }
      : {}),
    ...(rightYAxisLabelWidth !== undefined ? { rightYAxisLabelWidth } : {}),
    ...(bottomMargin !== undefined ? { bottomMargin } : {}),
    ...(axisReservations !== undefined ? { axisReservations } : {}),
    ...(xAxisLabelsInsidePlot ? { xAxisLabelsInsidePlot } : {}),
    ...(yAxisLabelsInsidePlot ? { yAxisLabelsInsidePlot } : {}),
    ...(manualPlotArea !== undefined ? { manualPlotArea } : {}),
    ...(manualTitle !== undefined ? { manualTitle } : {}),
    ...(manualLegend !== undefined ? { manualLegend } : {}),
    ...(dataTable !== undefined ? { dataTable } : {}),
    ...(pieDoughnut !== undefined ? { pieDoughnut } : {}),
  };
}
