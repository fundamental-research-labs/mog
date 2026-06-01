import type { DataRow, EncodingSpec, UnitSpec } from '../../../grammar/spec';
import type { ChartConfig } from '../../../types';
import {
  buildDropLineLayer,
  buildRangeRuleLayer,
  buildUpDownBarLayers,
} from './analysis-line-layers';
import { buildHighLowRows, buildSeriesLineRows, buildUpDownRows } from './analysis-line-rows';
import { isVisibleLine } from './analysis-line-settings';

export function buildAnalysisLineLayers(
  config: ChartConfig,
  encoding: EncodingSpec,
  rows: DataRow[],
): UnitSpec[] {
  if (!encoding.x || !encoding.y) return [];
  const layers: UnitSpec[] = [];

  if (isVisibleLine(config.dropLines)) {
    layers.push(buildDropLineLayer(config, encoding));
  }

  if (isVisibleLine(config.highLowLines)) {
    const data = buildHighLowRows(rows, encoding);
    if (data.length > 0) {
      layers.push(buildRangeRuleLayer(config, encoding, data, config.highLowLines));
    }
  }

  if (isVisibleLine(config.seriesLines)) {
    const data = buildSeriesLineRows(rows, encoding);
    if (data.length > 0) {
      layers.push(buildRangeRuleLayer(config, encoding, data, config.seriesLines));
    }
  }

  if (config.upDownBars) {
    const data = buildUpDownRows(config, rows, encoding);
    layers.push(...buildUpDownBarLayers(config, encoding, data));
  }

  return layers;
}
