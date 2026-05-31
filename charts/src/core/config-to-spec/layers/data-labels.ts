import type { EncodingSpec, MarkSpec, UnitSpec } from '../../../grammar/spec';
import type { DataLabelConfig } from '../../../types';
import {
  CATEGORY_FIELD,
  DATA_LABEL_ALIGN_FIELD,
  DATA_LABEL_ANCHOR_X_FIELD,
  DATA_LABEL_ANCHOR_Y_FIELD,
  DATA_LABEL_BASELINE_FIELD,
  DATA_LABEL_COLOR_FIELD,
  DATA_LABEL_DX_FIELD,
  DATA_LABEL_DY_FIELD,
  DATA_LABEL_FONT_SIZE_FIELD,
  DATA_LABEL_LAYOUT_TARGET_FIELD,
  DATA_LABEL_LAYOUT_X_FIELD,
  DATA_LABEL_LAYOUT_Y_FIELD,
  DATA_LABEL_LEADER_STROKE_FIELD,
  DATA_LABEL_LEADER_STROKE_WIDTH_FIELD,
  DATA_LABEL_LEADER_VISIBLE_FIELD,
  DATA_LABEL_ROTATION_FIELD,
  DATA_LABEL_TEXT_FIELD,
  DATA_LABEL_VALUE_ANCHOR_FIELD,
  DATA_LABEL_VISIBLE_FIELD,
  DATA_LABEL_X_FIELD,
  DATA_LABEL_Y_FIELD,
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
  const automaticTransform = [
    { type: 'filter' as const, filter: { field: DATA_LABEL_VISIBLE_FIELD, equal: true } },
    { type: 'filter' as const, filter: `!${DATA_LABEL_LAYOUT_TARGET_FIELD}` },
  ];

  const mark: MarkSpec = {
    type: 'text',
    dxField: DATA_LABEL_DX_FIELD,
    dyField: DATA_LABEL_DY_FIELD,
    alignField: DATA_LABEL_ALIGN_FIELD,
    baselineField: DATA_LABEL_BASELINE_FIELD,
    colorField: DATA_LABEL_COLOR_FIELD,
    fontSizeField: DATA_LABEL_FONT_SIZE_FIELD,
    angleField: DATA_LABEL_ROTATION_FIELD,
    ...(!position
      ? {
          xField: DATA_LABEL_X_FIELD,
          yField: DATA_LABEL_Y_FIELD,
          coordinateSystem: 'plotFraction' as const,
        }
      : {}),
  };

  return [
    {
      mark,
      encoding: {
        ...(position ?? {}),
        text: { field: DATA_LABEL_TEXT_FIELD, type: 'nominal' },
      },
      transform: automaticTransform,
    },
    manualDataLabelLayer(position, 'outer'),
    manualDataLabelLayer(position, 'inner'),
  ];
}

export function buildLeaderLineLayers(encoding: EncodingSpec): UnitSpec[] {
  const position = dataLabelPositionEncoding(encoding);
  const automaticTransform = [
    { type: 'filter' as const, filter: { field: DATA_LABEL_VISIBLE_FIELD, equal: true } },
    { type: 'filter' as const, filter: { field: DATA_LABEL_LEADER_VISIBLE_FIELD, equal: true } },
    { type: 'filter' as const, filter: `!${DATA_LABEL_LAYOUT_TARGET_FIELD}` },
  ];

  const layers: UnitSpec[] = [
    {
      mark: {
        type: 'rule',
        stroke: '#808080',
        strokeWidth: 1,
        strokeField: DATA_LABEL_LEADER_STROKE_FIELD,
        strokeWidthField: DATA_LABEL_LEADER_STROKE_WIDTH_FIELD,
        dxField: DATA_LABEL_DX_FIELD,
        dyField: DATA_LABEL_DY_FIELD,
        ...(!position
          ? {
              xField: DATA_LABEL_ANCHOR_X_FIELD,
              yField: DATA_LABEL_ANCHOR_Y_FIELD,
              x2Field: DATA_LABEL_X_FIELD,
              y2Field: DATA_LABEL_Y_FIELD,
              coordinateSystem: 'plotFraction' as const,
            }
          : {}),
      },
      encoding: position
        ? {
            x: position.anchorX,
            y: position.anchorY,
            x2: position.labelX,
            y2: position.labelY,
          }
        : undefined,
      transform: automaticTransform,
    },
  ];
  if (position) {
    layers.push(manualLeaderLineLayer(position, 'outer'), manualLeaderLineLayer(position, 'inner'));
  }
  return layers;
}

function manualDataLabelLayer(
  position: ReturnType<typeof dataLabelPositionEncoding>,
  target: 'outer' | 'inner',
): UnitSpec {
  return {
    mark: {
      type: 'text',
      xField: DATA_LABEL_LAYOUT_X_FIELD,
      yField: DATA_LABEL_LAYOUT_Y_FIELD,
      coordinateSystem: target === 'inner' ? 'plotFraction' : 'chartFraction',
      dxField: DATA_LABEL_DX_FIELD,
      dyField: DATA_LABEL_DY_FIELD,
      alignField: DATA_LABEL_ALIGN_FIELD,
      baselineField: DATA_LABEL_BASELINE_FIELD,
      colorField: DATA_LABEL_COLOR_FIELD,
      fontSizeField: DATA_LABEL_FONT_SIZE_FIELD,
      angleField: DATA_LABEL_ROTATION_FIELD,
    },
    encoding: {
      ...(position ?? {}),
      text: { field: DATA_LABEL_TEXT_FIELD, type: 'nominal' },
    },
    transform: [
      { type: 'filter', filter: { field: DATA_LABEL_VISIBLE_FIELD, equal: true } },
      { type: 'filter', filter: { field: DATA_LABEL_LAYOUT_TARGET_FIELD, equal: target } },
    ],
  };
}

function manualLeaderLineLayer(
  position: NonNullable<ReturnType<typeof dataLabelPositionEncoding>>,
  target: 'outer' | 'inner',
): UnitSpec {
  return {
    mark: {
      type: 'rule',
      stroke: '#808080',
      strokeWidth: 1,
      strokeField: DATA_LABEL_LEADER_STROKE_FIELD,
      strokeWidthField: DATA_LABEL_LEADER_STROKE_WIDTH_FIELD,
      x2Field: DATA_LABEL_LAYOUT_X_FIELD,
      y2Field: DATA_LABEL_LAYOUT_Y_FIELD,
      coordinateSystem: target === 'inner' ? 'plotFraction' : 'chartFraction',
    },
    encoding: {
      x: position.anchorX,
      y: position.anchorY,
      x2: position.labelX,
      y2: position.labelY,
    },
    transform: [
      { type: 'filter', filter: { field: DATA_LABEL_VISIBLE_FIELD, equal: true } },
      { type: 'filter', filter: { field: DATA_LABEL_LEADER_VISIBLE_FIELD, equal: true } },
      { type: 'filter', filter: { field: DATA_LABEL_LAYOUT_TARGET_FIELD, equal: target } },
    ],
  };
}

function dataLabelPositionEncoding(encoding: EncodingSpec):
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
