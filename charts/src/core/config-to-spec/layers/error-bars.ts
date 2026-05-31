import type { EncodingSpec, UnitSpec } from '../../../grammar/spec';
import {
  ERROR_BAR_VISIBLE_FIELD,
  ERROR_BAR_X_MAX_FIELD,
  ERROR_BAR_X_MIN_FIELD,
  ERROR_BAR_Y_MAX_FIELD,
  ERROR_BAR_Y_MIN_FIELD,
  VALUE_FIELD,
} from '../fields';

export function buildErrorBarLayers(encoding: EncodingSpec): UnitSpec[] {
  if (!encoding.x || !encoding.y) return [];
  const horizontal = encoding.x.field === VALUE_FIELD;
  const rangeLayer: UnitSpec = horizontal
    ? {
        mark: { type: 'rule', stroke: '#666666', strokeWidth: 1 },
        encoding: {
          x: { ...encoding.x, field: ERROR_BAR_X_MIN_FIELD, type: 'quantitative' },
          y: encoding.y,
          x2: { ...encoding.x, field: ERROR_BAR_X_MAX_FIELD, type: 'quantitative' },
          y2: encoding.y,
        },
        transform: [{ type: 'filter', filter: { field: ERROR_BAR_VISIBLE_FIELD, equal: true } }],
      }
    : {
        mark: { type: 'rule', stroke: '#666666', strokeWidth: 1 },
        encoding: {
          x: encoding.x,
          y: { ...encoding.y, field: ERROR_BAR_Y_MIN_FIELD, type: 'quantitative' },
          x2: encoding.x,
          y2: { ...encoding.y, field: ERROR_BAR_Y_MAX_FIELD, type: 'quantitative' },
        },
        transform: [{ type: 'filter', filter: { field: ERROR_BAR_VISIBLE_FIELD, equal: true } }],
      };
  return [rangeLayer];
}
