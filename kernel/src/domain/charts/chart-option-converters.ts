import type {
  BoxplotConfigData,
  HierarchyChartConfigData,
  HistogramConfigData,
  RegionMapConfigData,
  UpDownBarsData,
  WaterfallOptions,
} from '../../bridges/compute/compute-types.gen';

import type {
  BoxplotConfig,
  HierarchyChartConfig,
  HistogramConfig,
  RegionMapConfig,
  UpDownBarsConfig,
  WaterfallConfig,
} from '@mog-sdk/contracts/data/charts';

import { chartFormatToWire, wireToChartFormat } from './chart-format-converters';

export function wireToUpDownBarsConfig(
  w: UpDownBarsData | undefined,
): UpDownBarsConfig | undefined {
  if (!w) return undefined;
  return {
    gapWidth: w.gapWidth,
    upFormat: wireToChartFormat(w.upFormat),
    downFormat: wireToChartFormat(w.downFormat),
  };
}

export function upDownBarsConfigToWire(
  c: UpDownBarsConfig | undefined,
): UpDownBarsData | undefined {
  if (!c) return undefined;
  return {
    gapWidth: c.gapWidth,
    upFormat: chartFormatToWire(c.upFormat),
    downFormat: chartFormatToWire(c.downFormat),
  };
}

export function wireToWaterfallConfig(
  w: WaterfallOptions | undefined,
): WaterfallConfig | undefined {
  if (!w) return undefined;
  return {
    subtotalIndices: w.subtotalIndices,
    totalIndices: w.subtotalIndices,
    showConnectorLines: w.showConnectorLines,
  };
}

export function wireToHistogramConfig(
  w: HistogramConfigData | undefined,
): HistogramConfig | undefined {
  if (!w) return undefined;
  return {
    binCount: w.binCount,
    binWidth: w.binWidth,
    overflowBin: w.overflowBin,
    overflowBinValue: w.overflowBinValue,
    underflowBin: w.underflowBin,
    underflowBinValue: w.underflowBinValue,
  };
}

export function wireToBoxplotConfig(w: BoxplotConfigData | undefined): BoxplotConfig | undefined {
  if (!w) return undefined;
  return {
    showOutlierPoints: w.showOutlierPoints,
    showOutliers: w.showOutlierPoints,
    showMeanMarkers: w.showMeanMarkers,
    showMean: w.showMeanMarkers,
    showMeanLine: w.showMeanLine,
    quartileMethod: w.quartileMethod,
  };
}

export function wireToHierarchyChartConfig(
  w: HierarchyChartConfigData | undefined,
): HierarchyChartConfig | undefined {
  if (!w) return undefined;
  return {
    rows: w.rows,
    categoryFormulas: w.categoryFormulas,
    valueFormula: w.valueFormula,
    parentLabelLayout: w.parentLabelLayout,
  };
}

export function wireToRegionMapConfig(
  w: RegionMapConfigData | undefined,
): RegionMapConfig | undefined {
  if (!w) return undefined;
  return {
    regionFormula: w.regionFormula,
    valueFormula: w.valueFormula,
  };
}
