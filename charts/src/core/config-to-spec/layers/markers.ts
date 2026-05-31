import type { EncodingSpec, UnitSpec } from '../../../grammar/spec';
import {
  MARKER_FILL_FIELD,
  MARKER_SHAPE_FIELD,
  MARKER_SIZE_FIELD,
  MARKER_STROKE_FIELD,
  MARKER_VISIBLE_FIELD,
} from '../fields';

export function buildMarkerLayers(encoding: EncodingSpec): UnitSpec[] {
  if (!encoding.x || !encoding.y) return [];

  return [
    {
      mark: { type: 'point', strokeWidth: 1 },
      encoding: {
        x: encoding.x,
        y: encoding.y,
        size: { field: MARKER_SIZE_FIELD, type: 'quantitative', legend: null },
        shape: { field: MARKER_SHAPE_FIELD, type: 'nominal', legend: null },
        fill: { field: MARKER_FILL_FIELD, type: 'nominal', legend: null },
        stroke: { field: MARKER_STROKE_FIELD, type: 'nominal', legend: null },
      },
      transform: [{ type: 'filter', filter: { field: MARKER_VISIBLE_FIELD, equal: true } }],
    },
  ];
}
