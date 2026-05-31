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
import { definedStyle } from './helpers';

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

  // Calculate center
  const cx = layout.plotArea.x + layout.plotArea.width / 2;
  const cy = layout.plotArea.y + layout.plotArea.height / 2;
  const outerRadius = Math.min(layout.plotArea.width, layout.plotArea.height) / 2 - 10;
  const innerRadius = markSpec.innerRadius
    ? markSpec.innerRadius < 1
      ? markSpec.innerRadius * outerRadius
      : markSpec.innerRadius
    : 0;

  // Determine which field is driving the arc angle (for datum overrides below)
  const thetaField = encodings.theta?.field ?? encodings.size?.field;

  // Calculate angles from theta encoding or sum of values
  let total = 0;
  const values: number[] = [];

  for (const datum of data) {
    const value = encodings.theta?.accessor(datum) ?? encodings.size?.accessor(datum);
    const numValue = typeof value === 'number' && isFinite(value) ? Math.abs(value) : 0;
    values.push(numValue);
    total += numValue;
  }

  const padAngle = markSpec.padAngle ?? 0.01;
  const TWO_PI = Math.PI * 2;

  // Compute logical angles (pre-padding) for each arc.
  // Each arc must have logical angle >= padAngle so that after padding
  // (subtracting padAngle), the visual angle is non-negative.
  const angles: number[] = [];
  if (total > 0) {
    for (const v of values) {
      angles.push((v / total) * TWO_PI);
    }
  } else if (data.length > 0) {
    // Equal distribution when all values are zero/null/NaN
    const equalAngle = TWO_PI / data.length;
    for (let i = 0; i < data.length; i++) {
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

  let startAngle = -Math.PI / 2; // Start at 12 o'clock

  for (let i = 0; i < data.length; i++) {
    const datum = data[i];
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

    marks.push({
      type: 'arc',
      x: cx,
      y: cy,
      innerRadius,
      outerRadius,
      startAngle: paddedStart,
      endAngle: paddedEnd,
      datum: arcDatum,
      style: {
        fill: color,
        stroke: markSpec.stroke ?? '#fff',
        strokeWidth: markSpec.strokeWidth ?? 1,
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
