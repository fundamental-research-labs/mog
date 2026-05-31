import type { EncodingSpec, UnitSpec } from '../../../grammar/spec';
import type { ChartConfig } from '../../../types';
import { VALUE_FIELD } from '../fields';

export function buildAnalysisLineLayers(config: ChartConfig, encoding: EncodingSpec): UnitSpec[] {
  if (!encoding.x || !encoding.y) return [];
  const layers: UnitSpec[] = [];
  if (config.dropLines?.visible !== false && config.dropLines) {
    layers.push(buildDropLineLayer(encoding));
  }
  return layers;
}

function buildDropLineLayer(encoding: EncodingSpec): UnitSpec {
  const horizontal = encoding.x?.field === VALUE_FIELD;
  return horizontal
    ? {
        mark: { type: 'rule', stroke: '#808080', strokeWidth: 1 },
        encoding: {
          x: encoding.x!,
          y: encoding.y!,
          x2: { ...encoding.x!, value: 0, field: undefined },
          y2: encoding.y!,
        },
      }
    : {
        mark: { type: 'rule', stroke: '#808080', strokeWidth: 1 },
        encoding: {
          x: encoding.x!,
          y: encoding.y!,
          x2: encoding.x!,
          y2: { ...encoding.y!, value: 0, field: undefined },
        },
      };
}
