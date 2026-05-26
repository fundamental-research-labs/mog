/**
 * Violin Plot Mark Generator (Grammar-Integrated)
 *
 * Generates path, rect, and symbol marks for violin plots through the
 * standard compile() pipeline. Uses the existing KDE and statistics
 * from math/statistics, but maps values through the standard scale/layout
 * infrastructure passed by the compiler.
 *
 * Does NOT replace the standalone component at components/statistical/violin.ts.
 */

import { groupByAccessor } from '../../algebra/group-by';
import { kde, quartiles, silvermanBandwidth } from '../../math/statistics';
import type { AnyMark, PathMark, RectMark, SymbolMark } from '../../primitives/types';
import type { ScaleMap } from '../encoding-resolver';
import { resolveEncodings } from '../encoding-resolver';
import type { ConfigSpec, DataRow, EncodingSpec, Layout, MarkSpec } from '../spec';

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_VIOLIN_WIDTH_FRACTION = 0.8;
const DEFAULT_KDE_POINTS = 100;
const DEFAULT_INNER_BOX_WIDTH_FRACTION = 0.15;
const DEFAULT_MEDIAN_SIZE = 36;

const DEFAULT_VIOLIN_STYLE = {
  fill: '#4e79a7',
  stroke: '#333333',
  strokeWidth: 1,
  opacity: 0.7,
};

const DEFAULT_BOX_STYLE = {
  fill: '#ffffff',
  stroke: '#333333',
  strokeWidth: 1,
  opacity: 0.9,
};

const DEFAULT_MEDIAN_STYLE = {
  fill: '#ffffff',
  stroke: '#333333',
  strokeWidth: 1,
};

// =============================================================================
// Statistics
// =============================================================================

interface ViolinStats {
  kdeX: number[];
  kdeY: number[];
  q1: number;
  median: number;
  q3: number;
  category?: string;
}

function calculateViolinStats(values: number[], category?: string): ViolinStats {
  const validValues = values.filter((v) => isFinite(v));

  if (validValues.length === 0) {
    return { kdeX: [], kdeY: [], q1: NaN, median: NaN, q3: NaN, category };
  }

  const bw = silvermanBandwidth(validValues);
  const kdeResult = kde(validValues, {
    bandwidth: bw,
    points: DEFAULT_KDE_POINTS,
    kernel: 'gaussian',
  });

  const q = quartiles(validValues);

  return {
    kdeX: kdeResult.x,
    kdeY: kdeResult.y,
    q1: q.q1,
    median: q.median,
    q3: q.q3,
    category,
  };
}

// =============================================================================
// Mark Generator
// =============================================================================

/**
 * Generate violin plot marks through the standard grammar pipeline.
 *
 * Extracts category (x) and value (y) fields from encoding, groups data
 * by category, computes KDE density curves and quartile statistics,
 * and maps through the provided scales to produce pixel-positioned marks.
 */
export function generateViolinMarks(
  markSpec: MarkSpec,
  data: DataRow[],
  scales: ScaleMap,
  _encodings: ReturnType<typeof resolveEncodings>,
  layout: Layout,
  encoding?: EncodingSpec,
  _config?: ConfigSpec,
): AnyMark[] {
  const xScale = scales.x;
  const yScale = scales.y;

  if (!yScale) return [];

  const valueField = encoding?.y?.field;
  const categoryField = encoding?.x?.field;

  if (!valueField) return [];

  // Group data by category and compute KDE stats
  const allStats: ViolinStats[] = [];

  if (!categoryField) {
    const values = data
      .map((row) => row[valueField])
      .filter((v): v is number => typeof v === 'number');
    allStats.push(calculateViolinStats(values));
  } else {
    const rowGroups = groupByAccessor(data, (row) => String(row[categoryField] ?? 'Unknown'));
    for (const [category, rows] of rowGroups) {
      const values: number[] = [];
      for (const row of rows) {
        const value = row[valueField];
        if (typeof value === 'number' && isFinite(value)) {
          values.push(value);
        }
      }
      if (values.length > 0) {
        allStats.push(calculateViolinStats(values, category));
      }
    }
  }

  const marks: AnyMark[] = [];

  // Determine violin width from scale bandwidth
  const bandwidth =
    xScale && typeof xScale.bandwidth === 'function' ? xScale.bandwidth() : layout.plotArea.width;
  const violinWidth = bandwidth * DEFAULT_VIOLIN_WIDTH_FRACTION;
  const halfWidth = violinWidth / 2;

  // Find max density across all violins for consistent width scaling
  let maxDensityOverall = 0;
  for (const stats of allStats) {
    if (stats.kdeY.length > 0) {
      let localMax = -Infinity;
      for (const v of stats.kdeY) {
        if (v > localMax) localMax = v;
      }
      if (localMax > maxDensityOverall) maxDensityOverall = localMax;
    }
  }

  if (maxDensityOverall === 0) return [];

  // Resolve colors from markSpec
  const violinFill = markSpec.fill ?? markSpec.color ?? DEFAULT_VIOLIN_STYLE.fill;
  const violinStroke = markSpec.stroke ?? DEFAULT_VIOLIN_STYLE.stroke;
  const violinStrokeWidth = markSpec.strokeWidth ?? DEFAULT_VIOLIN_STYLE.strokeWidth;
  const violinOpacity = markSpec.opacity ?? DEFAULT_VIOLIN_STYLE.opacity;

  for (const stats of allStats) {
    if (stats.kdeX.length === 0) continue;

    // Determine x position
    let centerX: number;
    if (stats.category && categoryField && xScale) {
      centerX = (xScale(stats.category) as number) + bandwidth / 2;
    } else {
      centerX = layout.plotArea.x + layout.plotArea.width / 2;
    }

    // Build the violin shape path
    // Right side: top to bottom
    let pathString = '';
    let firstPoint = true;

    for (let i = 0; i < stats.kdeX.length; i++) {
      const density = stats.kdeY[i];
      const width = (density / maxDensityOverall) * halfWidth;
      const x = centerX + width;
      const y = yScale(stats.kdeX[i]) as number;

      if (firstPoint) {
        pathString += `M${x},${y}`;
        firstPoint = false;
      } else {
        pathString += ` L${x},${y}`;
      }
    }

    // Left side: bottom to top (mirrored)
    for (let i = stats.kdeX.length - 1; i >= 0; i--) {
      const density = stats.kdeY[i];
      const width = (density / maxDensityOverall) * halfWidth;
      const x = centerX - width;
      const y = yScale(stats.kdeX[i]) as number;
      pathString += ` L${x},${y}`;
    }

    pathString += ' Z';

    // Violin shape path mark
    const violinMark: PathMark = {
      type: 'path',
      x: 0,
      y: 0,
      path: pathString,
      style: {
        fill: violinFill,
        stroke: violinStroke,
        strokeWidth: violinStrokeWidth,
        opacity: violinOpacity,
      },
      datum: { stats, type: 'violin' },
    };
    marks.push(violinMark);

    // Inner box (Q1 to Q3)
    if (!isNaN(stats.q1) && !isNaN(stats.q3)) {
      const boxWidth = violinWidth * DEFAULT_INNER_BOX_WIDTH_FRACTION;
      const q1Y = yScale(stats.q1) as number;
      const q3Y = yScale(stats.q3) as number;

      const boxRect: RectMark = {
        type: 'rect',
        x: centerX - boxWidth / 2,
        y: Math.min(q1Y, q3Y),
        width: boxWidth,
        height: Math.abs(q3Y - q1Y),
        style: DEFAULT_BOX_STYLE,
        datum: { stats, type: 'box' },
      };
      marks.push(boxRect);
    }

    // Median marker
    if (!isNaN(stats.median)) {
      const medianMark: SymbolMark = {
        type: 'symbol',
        x: centerX,
        y: yScale(stats.median) as number,
        size: DEFAULT_MEDIAN_SIZE,
        shape: 'circle',
        style: DEFAULT_MEDIAN_STYLE,
        datum: { value: stats.median, type: 'median' },
      };
      marks.push(medianMark);
    }
  }

  return marks;
}
