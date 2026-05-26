/**
 * Point/Scatter Mark Generator
 *
 * Generates symbol marks for scatter plots and point charts.
 *
 * Extracted from compiler.ts - no logic changes.
 */

import { resolveColor } from '../../algebra/color';
import type { SymbolMark, SymbolShape } from '../../primitives/types';
import type { ScaleMap } from '../encoding-resolver';
import { resolveEncodings } from '../encoding-resolver';
import type { DataRow, Layout, MarkSpec } from '../spec';
import { invokeScale } from './helpers';

/**
 * Generate point/scatter marks.
 */
export function generatePointMarks(
  markSpec: MarkSpec,
  data: DataRow[],
  scales: ScaleMap,
  encodings: ReturnType<typeof resolveEncodings>,
  _layout: Layout,
): SymbolMark[] {
  const marks: SymbolMark[] = [];
  const xScale = scales.x;
  const yScale = scales.y;

  if (!xScale || !yScale) return marks;

  // Compute fallback positions for NaN values (use the midpoint of the scale range)
  const xRange = typeof xScale.range === 'function' ? xScale.range() : [0, 0];
  const yRange = typeof yScale.range === 'function' ? yScale.range() : [0, 0];
  const xFallback = ((xRange[0] as number) + (xRange[1] as number)) / 2;
  const yFallback = ((yRange[0] as number) + (yRange[1] as number)) / 2;

  for (let i = 0; i < data.length; i++) {
    const datum = data[i];
    let x = xScale(encodings.x?.accessor(datum)) as number;
    let y = yScale(encodings.y?.accessor(datum)) as number;

    // Check for non-finite positions (NaN or Infinity).
    // If only one is bad, place at the fallback position so the mark still exists.
    const xNaN = typeof x !== 'number' || !isFinite(x);
    const yNaN = typeof y !== 'number' || !isFinite(y);
    if (xNaN && yNaN) {
      // Still emit a mark at fallback position to match data count
      x = xFallback;
      y = yFallback;
    } else if (xNaN) {
      x = xFallback;
    } else if (yNaN) {
      y = yFallback;
    }

    // Get visual properties
    const colorValue = encodings.color?.accessor(datum);
    const color = resolveColor({
      colorScale: scales.color,
      colorValue,
      markColor: markSpec.color,
      markFill: markSpec.fill,
      index: 0,
    });

    const sizeValue = encodings.size?.accessor(datum);
    const size =
      sizeValue != null
        ? (invokeScale<number>(scales.size, sizeValue) ?? 64)
        : (markSpec.size ?? 64);

    const shapeValue = encodings.shape?.accessor(datum);
    // Shape values are always valid SymbolShape strings from DEFAULT_SHAPES
    const shape: SymbolShape = (
      shapeValue
        ? (invokeScale<string>(scales.shape, shapeValue) ?? 'circle')
        : (markSpec.shape ?? 'circle')
    ) as SymbolShape;

    marks.push({
      type: 'symbol',
      x,
      y,
      size,
      shape,
      datum,
      style: {
        fill: color,
        stroke: markSpec.stroke,
        strokeWidth: markSpec.strokeWidth ?? 1,
        opacity: markSpec.opacity ?? 1,
      },
    });
  }

  return marks;
}
