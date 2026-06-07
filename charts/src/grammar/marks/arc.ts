/**
 * Arc/Pie Mark Generator
 *
 * Generates arc marks for pie and donut charts.
 *
 * Extracted from compiler.ts - no logic changes.
 */

import { resolveColor } from '../../algebra/color';
import type { ArcMark } from '../../primitives/types';
import type { ScaleMap } from '../encoding-resolver';
import { resolveEncodings } from '../encoding-resolver';
import type { ConfigSpec, DataRow, Layout, MarkSpec } from '../spec';
import { definedStyle, renderableDataRows } from './helpers';
import {
  pieDoughnutArcFrame,
  pieDoughnutExplosionOffset,
} from '../../core/config-to-spec/pie-like';
import {
  PIE_SLICE_CENTER_X_FIELD,
  PIE_SLICE_CENTER_Y_FIELD,
  PIE_SLICE_END_ANGLE_FIELD,
  PIE_SLICE_INNER_RADIUS_RATIO_FIELD,
  PIE_SLICE_OUTER_RADIUS_RATIO_FIELD,
  PIE_SLICE_START_ANGLE_FIELD,
  POINT_EXPLOSION_FIELD,
} from '../../core/config-to-spec/fields';

function datumString(datum: DataRow, field: string | undefined): string | undefined {
  if (!field) return undefined;
  const value = datum[field];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function datumNumber(datum: DataRow, field: string | undefined): number | undefined {
  if (!field) return undefined;
  const value = datum[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Generate arc/pie marks.
 */
export function generateArcMarks(
  markSpec: MarkSpec,
  data: DataRow[],
  scales: ScaleMap,
  encodings: ReturnType<typeof resolveEncodings>,
  layout: Layout,
  config?: ConfigSpec,
): ArcMark[] {
  const marks: ArcMark[] = [];
  const renderData = renderableDataRows(data);

  const frame = pieDoughnutArcFrame(layout.plotArea, config?.layoutHints?.pieDoughnut);
  const outerRadius = resolveArcRadius(markSpec.outerRadius, frame.radius, frame.radius);
  const innerRadius = Math.min(
    outerRadius,
    resolveArcRadius(markSpec.innerRadius, frame.radius, 0),
  );

  // Determine which field is driving the arc angle (for datum overrides below)
  const thetaField = encodings.theta?.field ?? encodings.size?.field;

  const values = renderData.map((datum) => {
    const value = encodings.theta?.accessor(datum) ?? encodings.size?.accessor(datum);
    return sanitizeArcValue(value);
  });

  const padAngle = markSpec.padAngle ?? 0;
  const angles = pieLikeArcAngles(values, padAngle);

  let startAngle = markSpec.startAngle ?? 0;

  for (let i = 0; i < renderData.length; i++) {
    const datum = renderData[i];
    const angle = angles[i];
    const rowGeometry = rowArcGeometry(datum, frame);
    const rawStartAngle = rowGeometry?.startAngle ?? startAngle;
    const endAngle = rowGeometry?.endAngle ?? startAngle + angle;

    // Compute padded start/end angles
    const paddedStart = rawStartAngle + padAngle / 2;
    const paddedEnd = endAngle - padAngle / 2;

    const colorValue = encodings.color?.accessor(datum);
    const color = resolveColor({
      colorScale: scales.color,
      colorValue,
      index: i,
    });

    // Create a datum copy that stores the absolute/sanitized value used for
    // angle computation. This ensures invariant checks (which read the value
    // from the datum) see the same magnitude the compiler used for proportions.
    // Covers: negative values (abs), Infinity (-> 0), NaN (-> 0).
    let arcDatum = datum;
    if (thetaField && datum[thetaField] != null) {
      const rawVal = datum[thetaField];
      if (typeof rawVal === 'number' && (rawVal < 0 || !isFinite(rawVal))) {
        arcDatum = { ...datum, [thetaField]: values[i] };
      }
    }

    const explosion = datumNumber(datum, POINT_EXPLOSION_FIELD) ?? markExplosionOffset(markSpec, i);
    const midAngle = (paddedStart + paddedEnd) / 2;
    const arcOuterRadius = rowGeometry?.outerRadius ?? outerRadius;
    const arcInnerRadius = Math.min(arcOuterRadius, rowGeometry?.innerRadius ?? innerRadius);
    const explosionOffset = rowGeometry ? 0 : pieDoughnutExplosionOffset(arcOuterRadius, explosion);
    const explosionVector = arcAngleUnitVector(midAngle);

    marks.push({
      type: 'arc',
      x: (rowGeometry?.x ?? frame.centerX) + explosionVector.x * explosionOffset,
      y: (rowGeometry?.y ?? frame.centerY) + explosionVector.y * explosionOffset,
      innerRadius: arcInnerRadius,
      outerRadius: arcOuterRadius,
      startAngle: paddedStart,
      endAngle: paddedEnd,
      datum: arcDatum,
      style: {
        fill: datumString(datum, markSpec.fillField) ?? color,
        stroke: datumString(datum, markSpec.strokeField) ?? markSpec.stroke ?? '#fff',
        strokeWidth: datumNumber(datum, markSpec.strokeWidthField) ?? markSpec.strokeWidth ?? 1,
        opacity: markSpec.opacity ?? 1,
        ...definedStyle({
          fillPaint: markSpec.fillPaint,
          strokePaint: markSpec.strokePaint,
          line: markSpec.line,
          effects: markSpec.effects,
        }),
      },
    });

    startAngle = endAngle;
  }

  return marks;
}

function rowArcGeometry(
  datum: DataRow,
  frame: ReturnType<typeof pieDoughnutArcFrame>,
):
  | {
      x: number;
      y: number;
      innerRadius: number;
      outerRadius: number;
      startAngle: number;
      endAngle: number;
    }
  | undefined {
  const startAngle = datumNumber(datum, PIE_SLICE_START_ANGLE_FIELD);
  const endAngle = datumNumber(datum, PIE_SLICE_END_ANGLE_FIELD);
  const centerX = datumNumber(datum, PIE_SLICE_CENTER_X_FIELD);
  const centerY = datumNumber(datum, PIE_SLICE_CENTER_Y_FIELD);
  const innerRatio = datumNumber(datum, PIE_SLICE_INNER_RADIUS_RATIO_FIELD);
  const outerRatio = datumNumber(datum, PIE_SLICE_OUTER_RADIUS_RATIO_FIELD);
  if (
    startAngle === undefined ||
    endAngle === undefined ||
    centerX === undefined ||
    centerY === undefined ||
    innerRatio === undefined ||
    outerRatio === undefined
  ) {
    return undefined;
  }
  return {
    x: frame.centerX + (centerX - 0.5) * frame.radius * 2,
    y: frame.centerY + (centerY - 0.5) * frame.radius * 2,
    innerRadius: Math.max(0, innerRatio) * frame.radius,
    outerRadius: Math.max(0, outerRatio) * frame.radius,
    startAngle,
    endAngle,
  };
}

function resolveArcRadius(
  value: number | undefined,
  maxOuterRadius: number,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (value >= 0 && value <= 1) return value * maxOuterRadius;
  return Math.max(0, value);
}

function markExplosionOffset(markSpec: MarkSpec, sliceIndex: number): number {
  const offset = markSpec._explosionOffset;
  if (typeof offset !== 'number' || !Number.isFinite(offset) || offset <= 0) return 0;
  if (markSpec._explodeAll) return offset;
  if (markSpec._explodedIndex === sliceIndex) return offset;
  if (markSpec._explodedIndices?.includes(sliceIndex)) return offset;
  return 0;
}

function pieLikeArcAngles(values: readonly number[], padAngle: number): number[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  const TWO_PI = Math.PI * 2;
  const angles =
    total > 0
      ? values.map((value) => (value / total) * TWO_PI)
      : values.map(() => TWO_PI / Math.max(1, values.length));
  if (angles.length === 0 || padAngle <= 0) return angles;

  let deficit = 0;
  let surplusTotal = 0;
  for (let i = 0; i < angles.length; i++) {
    if (angles[i] < padAngle) {
      deficit += padAngle - angles[i];
    } else {
      surplusTotal += angles[i];
    }
  }

  if (deficit > 0 && surplusTotal > deficit) {
    const scaleFactor = (surplusTotal - deficit) / surplusTotal;
    for (let i = 0; i < angles.length; i++) {
      angles[i] = angles[i] < padAngle ? padAngle : angles[i] * scaleFactor;
    }
  }
  return angles;
}

function sanitizeArcValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.abs(value) : 0;
}

function arcAngleUnitVector(angle: number): { x: number; y: number } {
  const canvasAngle = angle - Math.PI / 2;
  return { x: Math.cos(canvasAngle), y: Math.sin(canvasAngle) };
}
