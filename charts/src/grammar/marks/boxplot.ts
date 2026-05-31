/**
 * Box Plot Mark Generator (Grammar-Integrated)
 *
 * Generates rect, path, and symbol marks for box-and-whisker plots
 * through the standard compile() pipeline. Uses the existing statistical
 * computation from math/statistics and geometry from math/geometry,
 * but maps values through the standard scale/layout infrastructure
 * passed by the compiler.
 *
 * Does NOT replace the standalone component at components/statistical/boxplot.ts.
 */

import { groupByAccessor } from '../../algebra/group-by';
import { boxPlotWhiskerPaths, type BoxPlotGeometry } from '../../math/geometry';
import {
  max as maxValue,
  mean,
  min as minValue,
  outlierBounds,
  quartiles,
} from '../../math/statistics';
import type { AnyMark, PathMark, RectMark, SymbolMark } from '../../primitives/types';
import type { ScaleMap } from '../encoding-resolver';
import { resolveEncodings } from '../encoding-resolver';
import type { ConfigSpec, DataRow, EncodingSpec, Layout, MarkSpec } from '../spec';

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_BOX_WIDTH_FRACTION = 0.6;
const DEFAULT_WHISKER_MULTIPLIER = 1.5;
const DEFAULT_OUTLIER_SIZE = 36;

const DEFAULT_BOX_STYLE = {
  fill: '#4e79a7',
  stroke: '#333333',
  strokeWidth: 1,
  opacity: 0.8,
};

const DEFAULT_MEDIAN_STYLE = {
  stroke: '#ffffff',
  strokeWidth: 2,
};

const DEFAULT_WHISKER_STYLE = {
  stroke: '#333333',
  strokeWidth: 1,
};

const DEFAULT_OUTLIER_STYLE = {
  fill: '#4e79a7',
  stroke: '#333333',
  strokeWidth: 0.5,
  opacity: 0.8,
};

// =============================================================================
// Statistics
// =============================================================================

interface BoxStats {
  q1: number;
  median: number;
  q3: number;
  lowerWhisker: number;
  upperWhisker: number;
  mean: number;
  outliers: number[];
  category?: string;
}

function calculateBoxStats(
  values: number[],
  whiskerMultiplier: number,
  quartileMethod: string | undefined,
  category?: string,
): BoxStats {
  const validValues = values.filter((v) => isFinite(v));

  if (validValues.length === 0) {
    return {
      q1: NaN,
      median: NaN,
      q3: NaN,
      lowerWhisker: NaN,
      upperWhisker: NaN,
      mean: NaN,
      outliers: [],
      category,
    };
  }

  const sorted = [...validValues].sort((a, b) => a - b);
  const q = quartilesForMethod(sorted, quartileMethod);
  const bounds = outlierBounds(sorted, whiskerMultiplier);

  const nonOutliers = sorted.filter((v) => v >= bounds.lower && v <= bounds.upper);
  const lowerWhisker = nonOutliers.length > 0 ? minValue(nonOutliers) : q.q1;
  const upperWhisker = nonOutliers.length > 0 ? maxValue(nonOutliers) : q.q3;
  const outlierValues = sorted.filter((v) => v < bounds.lower || v > bounds.upper);

  return {
    q1: q.q1,
    median: q.median,
    q3: q.q3,
    lowerWhisker,
    upperWhisker,
    mean: mean(sorted),
    outliers: outlierValues,
    category,
  };
}

function quartilesForMethod(values: number[], method: string | undefined) {
  if (method !== 'exclusive') return quartiles(values);
  return {
    q1: quantileExclusive(values, 0.25),
    median: quantileExclusive(values, 0.5),
    q3: quantileExclusive(values, 0.75),
  };
}

function quantileExclusive(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return NaN;
  const position = p * (sortedValues.length + 1);
  if (position <= 1) return sortedValues[0];
  if (position >= sortedValues.length) return sortedValues[sortedValues.length - 1];
  const lowerIndex = Math.floor(position) - 1;
  const fraction = position - Math.floor(position);
  return sortedValues[lowerIndex] + fraction * (sortedValues[lowerIndex + 1] - sortedValues[lowerIndex]);
}

// =============================================================================
// Mark Generator
// =============================================================================

/**
 * Generate box plot marks through the standard grammar pipeline.
 *
 * Extracts category (x) and value (y) fields from encoding,
 * groups data by category, computes quartiles/whiskers/outliers,
 * and maps through the provided scales to produce pixel-positioned marks.
 */
export function generateBoxPlotMarks(
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
  const showOutlierPoints = markSpec.showOutlierPoints !== false;
  const showMeanMarkers = markSpec.showMeanMarkers === true;
  const showMeanLine = markSpec.showMeanLine === true;

  if (!valueField) return [];

  // Group data by category and extract numeric values
  const allStats: BoxStats[] = [];

  if (!categoryField) {
    // Single box plot: all values together
    const values = data
      .map((row) => row[valueField])
      .filter((v): v is number => typeof v === 'number');
    allStats.push(calculateBoxStats(values, DEFAULT_WHISKER_MULTIPLIER, markSpec.quartileMethod));
  } else {
    // Grouped box plots
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
        allStats.push(
          calculateBoxStats(values, DEFAULT_WHISKER_MULTIPLIER, markSpec.quartileMethod, category),
        );
      }
    }
  }

  const marks: AnyMark[] = [];

  // Determine box width from scale bandwidth
  const bandwidth =
    xScale && typeof xScale.bandwidth === 'function' ? xScale.bandwidth() : layout.plotArea.width;
  const boxWidth = bandwidth * DEFAULT_BOX_WIDTH_FRACTION;

  // Resolve colors from markSpec
  const boxFill = markSpec.fill ?? markSpec.color ?? DEFAULT_BOX_STYLE.fill;
  const boxStroke = markSpec.stroke ?? DEFAULT_BOX_STYLE.stroke;
  const boxStrokeWidth = markSpec.strokeWidth ?? DEFAULT_BOX_STYLE.strokeWidth;
  const boxOpacity = markSpec.opacity ?? DEFAULT_BOX_STYLE.opacity;

  for (const stats of allStats) {
    if (isNaN(stats.median)) continue;

    // Determine x position
    let centerX: number;
    if (stats.category && categoryField && xScale) {
      centerX = (xScale(stats.category) as number) + bandwidth / 2;
    } else {
      centerX = layout.plotArea.x + layout.plotArea.width / 2;
    }

    // Map statistical values through the y scale
    const q1Y = yScale(stats.q1) as number;
    const medianY = yScale(stats.median) as number;
    const q3Y = yScale(stats.q3) as number;
    const lowerWhiskerY = yScale(stats.lowerWhisker) as number;
    const upperWhiskerY = yScale(stats.upperWhisker) as number;
    const outlierYs = showOutlierPoints ? stats.outliers.map((v) => yScale(v) as number) : [];
    const meanY = yScale(stats.mean) as number;

    // Build geometry for whisker path helpers
    const geom: BoxPlotGeometry = {
      centerX,
      boxWidth,
      q1Y,
      medianY,
      q3Y,
      lowerWhiskerY,
      upperWhiskerY,
      outlierYs,
    };

    // Box rect (Q1 to Q3)
    const boxRect: RectMark = {
      type: 'rect',
      x: centerX - boxWidth / 2,
      y: Math.min(q1Y, q3Y),
      width: boxWidth,
      height: Math.abs(q3Y - q1Y),
      style: {
        fill: boxFill,
        stroke: boxStroke,
        strokeWidth: boxStrokeWidth,
        opacity: boxOpacity,
      },
      datum: { stats, type: 'box' },
    };
    marks.push(boxRect);

    // Median line
    const medianMark: PathMark = {
      type: 'path',
      x: 0,
      y: 0,
      path: `M${centerX - boxWidth / 2},${medianY} L${centerX + boxWidth / 2},${medianY}`,
      style: DEFAULT_MEDIAN_STYLE,
      datum: { stats, type: 'median' },
    };
    marks.push(medianMark);

    // Whiskers (using geometry helper)
    const [lowerWhiskerPath, upperWhiskerPath] = boxPlotWhiskerPaths(geom);

    marks.push({
      type: 'path',
      x: 0,
      y: 0,
      path: lowerWhiskerPath,
      style: DEFAULT_WHISKER_STYLE,
      datum: { stats, type: 'whisker-lower' },
    } as PathMark);

    marks.push({
      type: 'path',
      x: 0,
      y: 0,
      path: upperWhiskerPath,
      style: DEFAULT_WHISKER_STYLE,
      datum: { stats, type: 'whisker-upper' },
    } as PathMark);

    if (showMeanLine && isFinite(stats.mean)) {
      marks.push({
        type: 'path',
        x: 0,
        y: 0,
        path: `M${centerX - boxWidth / 2},${meanY} L${centerX + boxWidth / 2},${meanY}`,
        style: { stroke: '#222222', strokeWidth: 1, strokeDash: [3, 3] },
        datum: { stats, type: 'mean-line' },
      } as PathMark);
    }

    if (showMeanMarkers && isFinite(stats.mean)) {
      marks.push({
        type: 'symbol',
        x: centerX,
        y: meanY,
        size: DEFAULT_OUTLIER_SIZE,
        shape: 'cross',
        style: { fill: '#222222', stroke: '#222222', strokeWidth: 1 },
        datum: { value: stats.mean, type: 'mean' },
      } as SymbolMark);
    }

    // Outliers
    for (let i = 0; i < outlierYs.length; i++) {
      const outlierMark: SymbolMark = {
        type: 'symbol',
        x: centerX,
        y: outlierYs[i],
        size: DEFAULT_OUTLIER_SIZE,
        shape: 'circle',
        style: DEFAULT_OUTLIER_STYLE,
        datum: { value: stats.outliers[i], type: 'outlier' },
      };
      marks.push(outlierMark);
    }
  }

  return marks;
}
