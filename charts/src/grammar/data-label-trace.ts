import {
  DATA_LABEL_ANCHOR_X_FIELD,
  DATA_LABEL_ANCHOR_Y_FIELD,
  DATA_LABEL_LAYOUT_TARGET_FIELD,
  DATA_LABEL_LEADER_VISIBLE_FIELD,
  DATA_LABEL_NEAR_ZERO_VALUE_FIELD,
  DATA_LABEL_POSITION_FIELD,
  DATA_LABEL_VISIBLE_FIELD,
  DATA_LABEL_ZERO_VALUE_FIELD,
  PIE_POINT_KEY_FIELD,
  PIE_SLICE_RING_INDEX_FIELD,
  POINT_INDEX_FIELD,
  SERIES_INDEX_FIELD,
  SOURCE_SERIES_INDEX_FIELD,
  SOURCE_SERIES_KEY_FIELD,
} from '../core/chart-ir/fields';
import { getTextBounds } from '../primitives/marks/text';
import type { AnyMark, TextMark } from '../primitives/types';
import { directPosition } from './marks/direct-position';
import type { ConfigSpec, DataRow, Layout } from './spec';
import type {
  PieDoughnutLabelLayoutTrace,
  PieDoughnutLabelLayoutTraceEntry,
  TextMeasurementContext,
} from './types';

export function buildPieDoughnutLabelLayoutTrace(input: {
  marks: AnyMark[];
  layout: Layout;
  config?: ConfigSpec;
  textMeasurementContext?: TextMeasurementContext;
}): PieDoughnutLabelLayoutTrace | undefined {
  const hints = input.config?.layoutHints?.pieDoughnut;
  const family = hints?.family;
  if (!hints || (family !== 'pie' && family !== 'doughnut')) return undefined;

  const labels = input.marks
    .filter(isPieDoughnutDataLabelMark)
    .map((mark) => labelTraceEntry(mark, input.layout, hints, input.textMeasurementContext))
    .filter((entry): entry is PieDoughnutLabelLayoutTraceEntry => entry !== undefined);

  return {
    schemaVersion: 1,
    coordinateSystem: 'chartPixel',
    chartWidth: input.layout.width,
    chartHeight: input.layout.height,
    plotArea: {
      x: input.layout.plotArea.x,
      y: input.layout.plotArea.y,
      width: input.layout.plotArea.width,
      height: input.layout.plotArea.height,
    },
    family,
    labels,
  };
}

function labelTraceEntry(
  mark: TextMark,
  layout: Layout,
  pieDoughnutHints: NonNullable<NonNullable<ConfigSpec['layoutHints']>['pieDoughnut']>,
  context: TextMeasurementContext | undefined,
): PieDoughnutLabelLayoutTraceEntry | undefined {
  const datum = mark.datum as DataRow;
  const seriesIndex = numberField(datum, SERIES_INDEX_FIELD);
  const pointIndex = numberField(datum, POINT_INDEX_FIELD);
  if (seriesIndex === undefined || pointIndex === undefined) return undefined;

  const measured = measuredTextBounds(mark, context);
  const anchorX =
    directPosition(
      datum,
      DATA_LABEL_ANCHOR_X_FIELD,
      layout,
      'x',
      'plotRadiusFraction',
      pieDoughnutHints,
    ) ?? mark.x;
  const anchorY =
    directPosition(
      datum,
      DATA_LABEL_ANCHOR_Y_FIELD,
      layout,
      'y',
      'plotRadiusFraction',
      pieDoughnutHints,
    ) ?? mark.y;
  const layoutTarget = stringField(datum, DATA_LABEL_LAYOUT_TARGET_FIELD);
  const sourceSeriesIndex = numberField(datum, SOURCE_SERIES_INDEX_FIELD);
  const sourceSeriesKey = stringField(datum, SOURCE_SERIES_KEY_FIELD);
  const pointKey = stringField(datum, PIE_POINT_KEY_FIELD);
  const ringIndex = numberField(datum, PIE_SLICE_RING_INDEX_FIELD);
  const position = stringField(datum, DATA_LABEL_POSITION_FIELD);

  return {
    seriesIndex,
    ...(sourceSeriesIndex !== undefined ? { sourceSeriesIndex } : {}),
    ...(sourceSeriesKey ? { sourceSeriesKey } : {}),
    pointIndex,
    ...(pointKey ? { pointKey } : {}),
    ...(ringIndex !== undefined ? { ringIndex } : {}),
    text: mark.text,
    ...(position ? { position } : {}),
    labelX: mark.x,
    labelY: mark.y,
    anchor: { x: anchorX, y: anchorY },
    bounds: measured.bounds,
    ...(mark.maxWidth !== undefined ? { maxWidth: mark.maxWidth } : {}),
    font: {
      family: mark.fontFamily,
      size: mark.fontSize,
      ...(mark.fontWeight !== undefined ? { weight: mark.fontWeight } : {}),
      ...(mark.fontStyle !== undefined ? { style: mark.fontStyle } : {}),
    },
    ...(mark.lineHeight !== undefined ? { lineHeight: mark.lineHeight } : {}),
    leaderVisible: booleanField(datum, DATA_LABEL_LEADER_VISIBLE_FIELD),
    zeroValue: booleanField(datum, DATA_LABEL_ZERO_VALUE_FIELD),
    nearZeroValue: booleanField(datum, DATA_LABEL_NEAR_ZERO_VALUE_FIELD),
    ...(layoutTarget === 'inner' || layoutTarget === 'outer' ? { layoutTarget } : {}),
    coordinateSystem: 'chartPixel',
    measurementAuthority: measured.authority,
  };
}

function measuredTextBounds(
  mark: TextMark,
  context: TextMeasurementContext | undefined,
): {
  bounds: PieDoughnutLabelLayoutTraceEntry['bounds'];
  authority: PieDoughnutLabelLayoutTraceEntry['measurementAuthority'];
} {
  if (context) {
    try {
      const bounds = getTextBounds(context, mark);
      if (isFiniteBox(bounds)) {
        return { bounds, authority: 'canvasMeasureText' };
      }
    } catch {
      // Fall back to estimated bounds below; the trace records that authority.
    }
  }
  return { bounds: estimatedTextBounds(mark), authority: 'estimated' };
}

function estimatedTextBounds(mark: TextMark): PieDoughnutLabelLayoutTraceEntry['bounds'] {
  const rawWidth = mark.text.length * mark.fontSize * 0.6;
  const width =
    mark.maxWidth !== undefined && mark.maxWidth > 0 ? Math.min(rawWidth, mark.maxWidth) : rawWidth;
  const lineCount =
    mark.maxWidth !== undefined && mark.maxWidth > 0 && rawWidth > mark.maxWidth
      ? Math.max(1, Math.ceil(rawWidth / mark.maxWidth))
      : Math.max(1, mark.text.split(/\r?\n/).length);
  const lineHeight =
    mark.lineHeight !== undefined && mark.lineHeight > 0 ? mark.lineHeight : mark.fontSize * 1.2;
  const height = lineCount > 1 ? mark.fontSize + (lineCount - 1) * lineHeight : mark.fontSize;
  let x = mark.x;
  let y = mark.y;
  if (mark.textAlign === 'center') x -= width / 2;
  if (mark.textAlign === 'right') x -= width;
  if (mark.textBaseline === 'middle') y -= height / 2;
  if (mark.textBaseline === 'bottom') y -= height;
  return { x, y, width, height };
}

function isPieDoughnutDataLabelMark(mark: AnyMark): mark is TextMark {
  return mark.type === 'text' && isPieDoughnutDataLabelDatum(mark.datum);
}

function isPieDoughnutDataLabelDatum(datum: unknown): boolean {
  if (!datum || typeof datum !== 'object') return false;
  const row = datum as Record<string, unknown>;
  return row[DATA_LABEL_VISIBLE_FIELD] === true && typeof row[PIE_POINT_KEY_FIELD] === 'string';
}

function numberField(datum: Record<string, unknown>, field: string): number | undefined {
  const value = datum[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringField(datum: Record<string, unknown>, field: string): string | undefined {
  const value = datum[field];
  return typeof value === 'string' ? value : undefined;
}

function booleanField(datum: Record<string, unknown>, field: string): boolean {
  return datum[field] === true;
}

function isFiniteBox(box: { x: number; y: number; width: number; height: number }): boolean {
  return (
    Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    Number.isFinite(box.width) &&
    Number.isFinite(box.height) &&
    box.width >= 0 &&
    box.height >= 0
  );
}
