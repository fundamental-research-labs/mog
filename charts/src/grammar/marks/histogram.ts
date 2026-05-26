/**
 * Histogram Mark Generator (Grammar-Integrated)
 *
 * Generates rect marks (and optional density curve path marks) for histograms
 * through the standard compile() pipeline. Uses the existing binning and KDE
 * computation from math/statistics, but maps values through the standard
 * scale/layout infrastructure passed by the compiler.
 *
 * Does NOT replace the standalone component at components/statistical/histogram.ts.
 */

import { groupByAccessor } from '../../algebra/group-by';
import {
  bin as binData,
  freedmanDiaconisBins,
  kde,
  type Bin,
  type KDEResult,
} from '../../math/statistics';
import { scaleLinear } from '../../primitives/scales/linear';
import type { AnyMark, PathMark, RectMark } from '../../primitives/types';
import type { ScaleMap } from '../encoding-resolver';
import { resolveEncodings } from '../encoding-resolver';
import type { ConfigSpec, DataRow, EncodingSpec, Layout, MarkSpec } from '../spec';

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_GAP = 0.05;

const DEFAULT_BAR_STYLE = {
  fill: '#4e79a7',
  stroke: '#ffffff',
  strokeWidth: 0.5,
  opacity: 0.8,
};

const DEFAULT_COLORS = [
  '#4e79a7',
  '#f28e2b',
  '#e15759',
  '#76b7b2',
  '#59a14f',
  '#edc948',
  '#b07aa1',
  '#ff9da7',
  '#9c755f',
  '#bab0ac',
];

// =============================================================================
// Data Processing
// =============================================================================

interface HistogramData {
  bins: Bin[];
  kde?: KDEResult;
  category?: string;
  color?: string;
}

function processHistogramData(
  data: DataRow[],
  valueField: string,
  categoryField?: string,
): HistogramData[] {
  if (!categoryField) {
    const values = data
      .map((row) => row[valueField])
      .filter((v): v is number => typeof v === 'number' && isFinite(v));
    if (values.length === 0) return [{ bins: [] }];
    const binCount = freedmanDiaconisBins(values);
    const bins = binData(values, { binCount, nice: true });
    return [{ bins }];
  }

  // Group by category
  const rowGroups = groupByAccessor(data, (row) => String(row[categoryField] ?? 'Unknown'));
  const results: HistogramData[] = [];
  let colorIndex = 0;

  for (const [category, rows] of rowGroups) {
    const values: number[] = [];
    for (const row of rows) {
      const value = row[valueField];
      if (typeof value === 'number' && isFinite(value)) {
        values.push(value);
      }
    }
    if (values.length > 0) {
      const color = DEFAULT_COLORS[colorIndex % DEFAULT_COLORS.length];
      const binCount = freedmanDiaconisBins(values);
      const bins = binData(values, { binCount, nice: true });
      results.push({ bins, category, color });
      colorIndex++;
    }
  }

  return results;
}

// =============================================================================
// Mark Generator
// =============================================================================

/**
 * Generate histogram marks through the standard grammar pipeline.
 *
 * Extracts value field from encoding.x, bins the data, and maps bin
 * boundaries through the provided scales to produce pixel-positioned
 * rect marks.
 */
export function generateHistogramMarks(
  markSpec: MarkSpec,
  data: DataRow[],
  scales: ScaleMap,
  _encodings: ReturnType<typeof resolveEncodings>,
  layout: Layout,
  encoding?: EncodingSpec,
  _config?: ConfigSpec,
): AnyMark[] {
  const xScale = scales.x;
  let yScale = scales.y;

  if (!xScale) return [];

  const valueField = encoding?.x?.field;
  const categoryField = encoding?.color?.field;

  if (!valueField) return [];

  // Process data into bins
  const histogramData = processHistogramData(data, valueField, categoryField);

  // If no y scale was provided (histogram computes counts internally),
  // create one from the max bin count and the layout.
  if (!yScale) {
    let maxCount = 0;
    for (const hist of histogramData) {
      for (const b of hist.bins) {
        if (b.count > maxCount) maxCount = b.count;
      }
    }
    if (maxCount === 0) return [];
    const inner = scaleLinear()
      .domain([0, maxCount])
      .range([layout.plotArea.y + layout.plotArea.height, layout.plotArea.y])
      .nice(10);
    yScale = Object.assign((v: unknown) => inner(v as number), {
      domain: () => inner.domain(),
      range: () => inner.range(),
      copy: () => yScale!,
      ticks: (count?: number) => inner.ticks(count),
    });
  }

  const marks: AnyMark[] = [];
  const gap = DEFAULT_GAP;

  // Resolve base color from markSpec
  const baseFill = markSpec.fill ?? markSpec.color ?? DEFAULT_BAR_STYLE.fill;
  const barStroke = markSpec.stroke ?? DEFAULT_BAR_STYLE.stroke;
  const barStrokeWidth = markSpec.strokeWidth ?? DEFAULT_BAR_STYLE.strokeWidth;
  const barOpacity = markSpec.opacity ?? DEFAULT_BAR_STYLE.opacity;

  const numCategories = histogramData.length;

  for (let catIndex = 0; catIndex < histogramData.length; catIndex++) {
    const hist = histogramData[catIndex];
    const barColor = hist.color ?? baseFill;

    for (const b of hist.bins) {
      // Map bin boundaries through the x scale
      const x0 = xScale(b.x0) as number;
      const x1 = xScale(b.x1) as number;
      const fullWidth = x1 - x0;
      const gapPx = fullWidth * gap;

      // For grouped histograms, divide width among categories
      const categoryWidth =
        numCategories > 1 ? (fullWidth - gapPx) / numCategories : fullWidth - gapPx;
      const barX = numCategories > 1 ? x0 + gapPx / 2 + catIndex * categoryWidth : x0 + gapPx / 2;

      // Map count through the y scale
      const barY = yScale(b.count) as number;
      const baselineY = yScale(0) as number;

      const barMark: RectMark = {
        type: 'rect',
        x: barX,
        y: Math.min(barY, baselineY),
        width: Math.max(0, categoryWidth),
        height: Math.abs(baselineY - barY),
        style: {
          fill: barColor,
          stroke: barStroke,
          strokeWidth: barStrokeWidth,
          opacity: barOpacity,
        },
        datum: { bin: b, category: hist.category },
      };
      marks.push(barMark);
    }
  }

  // -------------------------------------------------------------------------
  // Density curve overlay (opt-in via markSpec.density)
  // -------------------------------------------------------------------------
  const showDensity = typeof markSpec.density === 'boolean' ? markSpec.density : false;
  if (showDensity) {
    for (let catIndex = 0; catIndex < histogramData.length; catIndex++) {
      const hist = histogramData[catIndex];

      // Gather raw values for this category so we can run KDE
      const values = data
        .filter((row) => {
          if (!categoryField) return true;
          return String(row[categoryField] ?? 'Unknown') === hist.category;
        })
        .map((row) => row[valueField])
        .filter((v): v is number => typeof v === 'number' && isFinite(v));

      if (values.length < 2) continue;

      const kdeResult: KDEResult = kde(values, { points: 100 });

      // Scale KDE density values so the curve aligns with the histogram's
      // count-based y-axis: scaledY = density * totalCount * binWidth.
      const binWidth = hist.bins.length > 0 ? hist.bins[0].x1 - hist.bins[0].x0 : 1;
      const totalCount = values.length;
      const scaleFactor = totalCount * binWidth;

      // Build SVG path string from KDE points
      const pathParts: string[] = [];
      for (let i = 0; i < kdeResult.x.length; i++) {
        const px = xScale(kdeResult.x[i]) as number;
        const py = yScale(kdeResult.y[i] * scaleFactor) as number;
        pathParts.push(`${i === 0 ? 'M' : 'L'}${px},${py}`);
      }

      const densityMark: PathMark = {
        type: 'path',
        x: 0,
        y: 0,
        path: pathParts.join(' '),
        style: {
          fill: 'none',
          stroke: hist.color ?? baseFill,
          strokeWidth: 2,
          opacity: 0.8,
        },
        datum: { type: 'density', category: hist.category },
      };
      marks.push(densityMark);
    }
  }

  return marks;
}
