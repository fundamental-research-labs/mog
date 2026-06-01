import type {
  ChartSpec,
  ConfigSpec,
  DataRow,
  EncodingSpec,
  LayerSpec,
  Transform,
  UnitSpec,
} from '../../grammar/spec';
import type { ChartConfig, LegendConfig } from '../../types';
import {
  DEFAULT_CHART_HEIGHT,
  DEFAULT_CHART_WIDTH,
  PIXELS_PER_COLUMN,
  PIXELS_PER_ROW,
} from './constants';
import { isLegendShown } from './legend';

export interface ChartDimensions {
  width: number;
  height: number;
}

export function buildChartDimensions(config: ChartConfig): ChartDimensions {
  return {
    width: config.width ? config.width * PIXELS_PER_COLUMN : DEFAULT_CHART_WIDTH,
    height: config.height ? config.height * PIXELS_PER_ROW : DEFAULT_CHART_HEIGHT,
  };
}

export function sharedLayerEncodingForLegend(
  encoding: EncodingSpec,
  legend: LegendConfig | undefined,
): EncodingSpec | undefined {
  return encoding.color && isLegendShown(legend) ? { color: { ...encoding.color } } : undefined;
}

export function buildLayerSpec(input: {
  dimensions: ChartDimensions;
  rows: DataRow[];
  layers: ChartSpec[];
  title: ChartSpec['title'];
  config: ConfigSpec | undefined;
  encoding?: EncodingSpec;
  resolve?: ChartSpec['resolve'];
  transforms?: Transform[];
}): LayerSpec {
  return {
    width: input.dimensions.width,
    height: input.dimensions.height,
    data: { values: input.rows },
    layer: input.layers,
    ...(input.encoding ? { encoding: input.encoding } : {}),
    title: input.title,
    config: input.config,
    ...(input.resolve ? { resolve: input.resolve } : {}),
    ...(input.transforms && input.transforms.length > 0 ? { transform: input.transforms } : {}),
  };
}

export function buildUnitSpec(input: {
  dimensions: ChartDimensions;
  rows: DataRow[];
  mark: UnitSpec['mark'];
  encoding: EncodingSpec;
  title: ChartSpec['title'];
  config: ConfigSpec | undefined;
  transforms?: Transform[];
}): UnitSpec {
  return {
    width: input.dimensions.width,
    height: input.dimensions.height,
    mark: input.mark,
    data: { values: input.rows },
    encoding: input.encoding,
    title: input.title,
    ...(input.config ? { config: input.config } : {}),
    ...(input.transforms && input.transforms.length > 0 ? { transform: input.transforms } : {}),
  };
}
