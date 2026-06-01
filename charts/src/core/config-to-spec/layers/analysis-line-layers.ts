import type { DataRow, EncodingSpec, UnitSpec } from '../../../grammar/spec';
import type { ChartConfig, ChartLineSettings } from '../../../types';
import {
  ANALYSIS_DIRECTION_FIELD,
  ANALYSIS_X2_FIELD,
  ANALYSIS_X_FIELD,
  ANALYSIS_Y2_FIELD,
  ANALYSIS_Y_FIELD,
  VALUE_FIELD,
} from '../fields';
import { lineMark, upDownMark } from './analysis-line-marks';

export function buildDropLineLayer(config: ChartConfig, encoding: EncodingSpec): UnitSpec {
  const horizontal = encoding.x?.field === VALUE_FIELD;
  const mark = lineMark(config, config.dropLines, '#808080');
  return horizontal
    ? {
        mark,
        encoding: {
          x: encoding.x!,
          y: encoding.y!,
          x2: { ...encoding.x!, value: 0, field: undefined },
          y2: encoding.y!,
        },
      }
    : {
        mark,
        encoding: {
          x: encoding.x!,
          y: encoding.y!,
          x2: encoding.x!,
          y2: { ...encoding.y!, value: 0, field: undefined },
        },
      };
}

export function buildRangeRuleLayer(
  config: ChartConfig,
  encoding: EncodingSpec,
  data: DataRow[],
  settings: ChartLineSettings | undefined,
): UnitSpec {
  const horizontal = encoding.x?.field === VALUE_FIELD;
  return {
    mark: lineMark(config, settings, '#808080'),
    data: { values: data },
    encoding: horizontal
      ? {
          x: { ...encoding.x!, field: ANALYSIS_X_FIELD, type: 'quantitative' },
          y: { ...encoding.y!, field: ANALYSIS_Y_FIELD },
          x2: { ...encoding.x!, field: ANALYSIS_X2_FIELD, type: 'quantitative' },
          y2: { ...encoding.y!, field: ANALYSIS_Y_FIELD },
        }
      : {
          x: { ...encoding.x!, field: ANALYSIS_X_FIELD },
          y: { ...encoding.y!, field: ANALYSIS_Y_FIELD, type: 'quantitative' },
          x2: { ...encoding.x!, field: ANALYSIS_X_FIELD },
          y2: { ...encoding.y!, field: ANALYSIS_Y2_FIELD, type: 'quantitative' },
        },
  };
}

export function buildUpDownBarLayers(
  config: ChartConfig,
  encoding: EncodingSpec,
  data: DataRow[],
): UnitSpec[] {
  if (data.length === 0) return [];

  const horizontal = encoding.x?.field === VALUE_FIELD;
  const baseEncoding = horizontal
    ? {
        x: { ...encoding.x!, field: ANALYSIS_X_FIELD, type: 'quantitative' as const },
        y: { ...encoding.y!, field: ANALYSIS_Y_FIELD },
        x2: { ...encoding.x!, field: ANALYSIS_X2_FIELD, type: 'quantitative' as const },
        y2: { ...encoding.y!, field: ANALYSIS_Y_FIELD },
      }
    : {
        x: { ...encoding.x!, field: ANALYSIS_X_FIELD },
        y: { ...encoding.y!, field: ANALYSIS_Y_FIELD, type: 'quantitative' as const },
        x2: { ...encoding.x!, field: ANALYSIS_X_FIELD },
        y2: { ...encoding.y!, field: ANALYSIS_Y2_FIELD, type: 'quantitative' as const },
      };

  return [
    {
      mark: upDownMark(config, config.upDownBars?.upFormat, '#ffffff'),
      data: { values: data },
      encoding: baseEncoding,
      transform: [{ type: 'filter', filter: { field: ANALYSIS_DIRECTION_FIELD, equal: 'up' } }],
    },
    {
      mark: upDownMark(config, config.upDownBars?.downFormat, '#808080'),
      data: { values: data },
      encoding: baseEncoding,
      transform: [{ type: 'filter', filter: { field: ANALYSIS_DIRECTION_FIELD, equal: 'down' } }],
    },
  ];
}
