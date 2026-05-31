import type { DataRow, EncodingSpec, UnitSpec } from '../../../grammar/spec';
import {
  ERROR_BAR_STROKE_FIELD,
  ERROR_BAR_STROKE_WIDTH_FIELD,
  ERROR_BAR_VISIBLE_FIELD,
  ERROR_BAR_X_MAX_CAP_VISIBLE_FIELD,
  ERROR_BAR_X_MAX_FIELD,
  ERROR_BAR_X_MIN_CAP_VISIBLE_FIELD,
  ERROR_BAR_X_MIN_FIELD,
  ERROR_BAR_Y_MAX_CAP_VISIBLE_FIELD,
  ERROR_BAR_Y_MAX_FIELD,
  ERROR_BAR_Y_MIN_CAP_VISIBLE_FIELD,
  ERROR_BAR_Y_MIN_FIELD,
} from '../fields';

export function buildErrorBarLayers(encoding: EncodingSpec, rows: DataRow[]): UnitSpec[] {
  if (!encoding.x || !encoding.y) return [];
  const layers: UnitSpec[] = [];
  const mark = {
    type: 'rule' as const,
    stroke: '#666666',
    strokeWidth: 1,
    strokeField: ERROR_BAR_STROKE_FIELD,
    strokeWidthField: ERROR_BAR_STROKE_WIDTH_FIELD,
  };

  if (hasField(rows, ERROR_BAR_X_MIN_FIELD) || hasField(rows, ERROR_BAR_X_MAX_FIELD)) {
    layers.push({
      mark,
      encoding: {
        x: { ...encoding.x, field: ERROR_BAR_X_MIN_FIELD, type: 'quantitative' },
        y: encoding.y,
        x2: { ...encoding.x, field: ERROR_BAR_X_MAX_FIELD, type: 'quantitative' },
        y2: encoding.y,
      },
      transform: [{ type: 'filter', filter: { field: ERROR_BAR_VISIBLE_FIELD, equal: true } }],
    });
    layers.push(
      buildCapLayer(
        encoding,
        ERROR_BAR_X_MIN_FIELD,
        undefined,
        ERROR_BAR_X_MIN_CAP_VISIBLE_FIELD,
        'vertical',
      ),
      buildCapLayer(
        encoding,
        ERROR_BAR_X_MAX_FIELD,
        undefined,
        ERROR_BAR_X_MAX_CAP_VISIBLE_FIELD,
        'vertical',
      ),
    );
  }

  if (hasField(rows, ERROR_BAR_Y_MIN_FIELD) || hasField(rows, ERROR_BAR_Y_MAX_FIELD)) {
    layers.push({
      mark,
      encoding: {
        x: encoding.x,
        y: { ...encoding.y, field: ERROR_BAR_Y_MIN_FIELD, type: 'quantitative' },
        x2: encoding.x,
        y2: { ...encoding.y, field: ERROR_BAR_Y_MAX_FIELD, type: 'quantitative' },
      },
      transform: [{ type: 'filter', filter: { field: ERROR_BAR_VISIBLE_FIELD, equal: true } }],
    });
    layers.push(
      buildCapLayer(
        encoding,
        undefined,
        ERROR_BAR_Y_MIN_FIELD,
        ERROR_BAR_Y_MIN_CAP_VISIBLE_FIELD,
        'horizontal',
      ),
      buildCapLayer(
        encoding,
        undefined,
        ERROR_BAR_Y_MAX_FIELD,
        ERROR_BAR_Y_MAX_CAP_VISIBLE_FIELD,
        'horizontal',
      ),
    );
  }

  return layers;
}

function buildCapLayer(
  encoding: EncodingSpec,
  xField: string | undefined,
  yField: string | undefined,
  visibleField: string,
  orient: 'horizontal' | 'vertical',
): UnitSpec {
  return {
    mark: {
      type: 'tick',
      orient,
      stroke: '#666666',
      strokeWidth: 1,
      strokeField: ERROR_BAR_STROKE_FIELD,
      strokeWidthField: ERROR_BAR_STROKE_WIDTH_FIELD,
    },
    encoding: {
      x: xField ? { ...encoding.x!, field: xField, type: 'quantitative' } : encoding.x!,
      y: yField ? { ...encoding.y!, field: yField, type: 'quantitative' } : encoding.y!,
    },
    transform: [{ type: 'filter', filter: { field: visibleField, equal: true } }],
  };
}

function hasField(rows: DataRow[], field: string): boolean {
  return rows.some((row) => row[field] !== undefined);
}
