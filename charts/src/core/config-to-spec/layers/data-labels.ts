import type { EncodingSpec, MarkSpec, UnitSpec } from '../../../grammar/spec';
import type { DataLabelConfig } from '../../../types';
import {
  CATEGORY_FIELD,
  DATA_LABEL_ALIGN_FIELD,
  DATA_LABEL_BASELINE_FIELD,
  DATA_LABEL_COLOR_FIELD,
  DATA_LABEL_DX_FIELD,
  DATA_LABEL_DY_FIELD,
  DATA_LABEL_FONT_SIZE_FIELD,
  DATA_LABEL_LEADER_VISIBLE_FIELD,
  DATA_LABEL_ROTATION_FIELD,
  DATA_LABEL_TEXT_FIELD,
  DATA_LABEL_VALUE_ANCHOR_FIELD,
  DATA_LABEL_VISIBLE_FIELD,
  SCATTER_X_FIELD,
  VALUE_FIELD,
} from '../fields';

/**
 * Backward-compatible single label layer helper.
 * Prefer `buildDataLabelLayers` so chart/series/point-effective labels share
 * the row annotation path.
 */
export function buildDataLabelLayer(
  dataLabels: DataLabelConfig,
  encoding: EncodingSpec,
): UnitSpec | undefined {
  if (!dataLabels.show) return undefined;
  return buildDataLabelLayers(encoding)[0];
}

export function buildDataLabelLayers(encoding: EncodingSpec): UnitSpec[] {
  const position = dataLabelPositionEncoding(encoding);
  if (!position) return [];

  const mark: MarkSpec = {
    type: 'text',
    dxField: DATA_LABEL_DX_FIELD,
    dyField: DATA_LABEL_DY_FIELD,
    alignField: DATA_LABEL_ALIGN_FIELD,
    baselineField: DATA_LABEL_BASELINE_FIELD,
    colorField: DATA_LABEL_COLOR_FIELD,
    fontSizeField: DATA_LABEL_FONT_SIZE_FIELD,
    angleField: DATA_LABEL_ROTATION_FIELD,
  };

  return [
    {
      mark,
      encoding: {
        ...position,
        text: { field: DATA_LABEL_TEXT_FIELD, type: 'nominal' },
      },
      transform: [{ type: 'filter', filter: { field: DATA_LABEL_VISIBLE_FIELD, equal: true } }],
    },
  ];
}

export function buildLeaderLineLayers(encoding: EncodingSpec): UnitSpec[] {
  const position = dataLabelPositionEncoding(encoding);
  if (!position) return [];

  return [
    {
      mark: { type: 'rule', stroke: '#808080', strokeWidth: 1 },
      encoding: {
        x: position.anchorX,
        y: position.anchorY,
        x2: position.labelX,
        y2: position.labelY,
      },
      transform: [
        { type: 'filter', filter: { field: DATA_LABEL_VISIBLE_FIELD, equal: true } },
        { type: 'filter', filter: { field: DATA_LABEL_LEADER_VISIBLE_FIELD, equal: true } },
      ],
    },
  ];
}

function dataLabelPositionEncoding(
  encoding: EncodingSpec,
):
  | (EncodingSpec & {
      anchorX: NonNullable<EncodingSpec['x']>;
      anchorY: NonNullable<EncodingSpec['y']>;
      labelX: NonNullable<EncodingSpec['x']>;
      labelY: NonNullable<EncodingSpec['y']>;
    })
  | undefined {
  if (!encoding.x || !encoding.y) return undefined;

  const horizontalValue = encoding.x.field === VALUE_FIELD;
  const scatter = encoding.x.field === SCATTER_X_FIELD;
  const anchorX = { ...encoding.x };
  const anchorY = { ...encoding.y };
  const labelX = horizontalValue
    ? { ...encoding.x, field: DATA_LABEL_VALUE_ANCHOR_FIELD, type: 'quantitative' as const }
    : anchorX;
  const labelY =
    !horizontalValue && !scatter
      ? { ...encoding.y, field: DATA_LABEL_VALUE_ANCHOR_FIELD, type: 'quantitative' as const }
      : anchorY;

  return {
    x: labelX,
    y: labelY,
    anchorX,
    anchorY,
    labelX,
    labelY,
  };
}

export function categoryValueEncoding(encoding: EncodingSpec): EncodingSpec {
  return {
    x: encoding.x ?? { field: CATEGORY_FIELD, type: 'nominal' },
    y: encoding.y ?? { field: VALUE_FIELD, type: 'quantitative' },
  };
}
