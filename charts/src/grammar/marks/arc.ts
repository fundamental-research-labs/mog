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
import type { DataRow, Layout, MarkSpec } from '../spec';
import { definedStyle, renderableDataRows } from './helpers';

const POINT_EXPLOSION_FIELD = '__mogPointExplosion';

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
): ArcMark[] {
  const marks: ArcMark[] = [];
  const renderData = renderableDataRows(data);

  // Calculate center
  const cx = layout.plotArea.x + layout.plotArea.width / 2;
  const cy = layout.plotArea.y + layout.plotArea.height / 2;
  const maxOuterRadius = Math.max(
    0,
    Math.min(layout.plotArea.width, layout.plotArea.height) / 2 - 10,
  );
  const outerRadius = resolveArcRadius(markSpec.outerRadius, maxOuterRadius, maxOuterRadius);
  const innerRadius = Math.min(
    outerRadius,
    resolveArcRadius(markSpec.innerRadius, maxOuterRadius, 0),
  );

  // Determine which field is driving the arc angle (for datum overrides below)
  const thetaField = encodings.theta?.field ?? encodings.size?.field;

  // Calculate angles from theta encoding or sum of values
  let total = 0;
  const values: number[] = [];

  for (const datum of renderData) {
    const value = encodings.theta?.accessor(datum) ?? encodings.size?.accessor(datum);
    const numValue = typeof value === 'number' && isFinite(value) ? Math.abs(value) : 0;
    values.push(numValue);
    total += numValue;
  }

  const padAngle = markSpec.padAngle ?? 0;
  const TWO_PI = Math.PI * 2;

  // Compute logical angles (pre-padding) for each arc.
  // Each arc must have logical angle >= padAngle so that after padding
  // (subtracting padAngle), the visual angle is non-negative.
  const angles: number[] = [];
  if (total > 0) {
    for (const v of values) {
      angles.push((v / total) * TWO_PI);
    }
  } else if (renderData.length > 0) {
    // Equal distribution when all values are zero/null/NaN
    const equalAngle = TWO_PI / renderData.length;
    for (let i = 0; i < renderData.length; i++) {
      angles.push(equalAngle);
    }
  }

  // Redistribute angles so that every arc has a logical angle >= padAngle.
  // Without this, subtracting padAngle for visual padding would yield
  // negative visual angles for tiny/zero-value arcs.
  // Borrow angle proportionally from arcs that have surplus (> padAngle).
  // This preserves sum(angles) = 2pi for the angle_sum invariant.
  if (angles.length > 0 && padAngle > 0) {
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
      // Scale surplus arcs down proportionally to fund deficit arcs
      const scaleFactor = (surplusTotal - deficit) / surplusTotal;
      for (let i = 0; i < angles.length; i++) {
        if (angles[i] < padAngle) {
          angles[i] = padAngle;
        } else {
          angles[i] *= scaleFactor;
        }
      }
    }
    // When deficit > surplusTotal (n * padAngle > 2PI), redistribution is
    // impossible. Leave angles as-is; some visual arcs will be negative.
    // The angle_sum invariant still holds because it adds n * padAngle back.
  }

  let startAngle = markSpec.startAngle ?? 0;

  for (let i = 0; i < renderData.length; i++) {
    const datum = renderData[i];
    const angle = angles[i];
    const endAngle = startAngle + angle;

    // Compute padded start/end angles
    const paddedStart = startAngle + padAngle / 2;
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

    const explosion =
      (datumNumber(datum, POINT_EXPLOSION_FIELD) ?? 0) + markExplosionOffset(markSpec, i);
    const midAngle = (paddedStart + paddedEnd) / 2;
    const explosionOffset = explosion > 0 ? Math.min(outerRadius * 0.25, explosion) : 0;
    const explosionVector = arcAngleUnitVector(midAngle);

    marks.push({
      type: 'arc',
      x: cx + explosionVector.x * explosionOffset,
      y: cy + explosionVector.y * explosionOffset,
      innerRadius,
      outerRadius,
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

function arcAngleUnitVector(angle: number): { x: number; y: number } {
  const canvasAngle = angle - Math.PI / 2;
  return { x: Math.cos(canvasAngle), y: Math.sin(canvasAngle) };
}
