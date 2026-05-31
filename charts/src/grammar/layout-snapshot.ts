/**
 * Layout Snapshot Extraction
 *
 * Extracts a ChartLayout snapshot from a CompileResult.
 * All values are converted from internal pixels to points (1pt = 1/72in).
 *
 * This is the ONLY place where the pixel-to-point conversion happens.
 * All internal compiler/generator code remains in pixels.
 *
 * Pure function - no side effects, no async.
 */

import type { AnyMark } from '../primitives/types';
import type { CompileResult } from './compiler';
import type {
  AxisLayout,
  ChartLayout,
  DataLabelLayout,
  ElementBounds,
  LegendEntryLayout,
  LegendLayout,
  PlotAreaLayout,
  TitleLayout,
} from '@mog-sdk/contracts/bridges';
import type { Layout } from './spec';

// =============================================================================
// Constants
// =============================================================================

const PX_TO_PT = 72 / 96; // 0.75
const DATA_LABEL_VISIBLE_FIELD = '__mogDataLabelVisible';
const POINT_INDEX_FIELD = '__mogPointIndex';
const SERIES_INDEX_FIELD = '__mogSeriesIndex';

// =============================================================================
// Conversion Helpers
// =============================================================================

function pxToPt(px: number): number {
  return px * PX_TO_PT;
}

function boundsToPoints(b: { x: number; y: number; width: number; height: number }): ElementBounds {
  return {
    left: pxToPt(b.x),
    top: pxToPt(b.y),
    width: pxToPt(b.width),
    height: pxToPt(b.height),
  };
}

// =============================================================================
// Mark Metadata Helpers
// =============================================================================

interface AxisDatum {
  role: string;
}

interface LegendDatum {
  entryIndex: number;
}

function isAxisDatum(datum: unknown): datum is AxisDatum {
  return (
    datum != null &&
    typeof datum === 'object' &&
    'role' in datum &&
    typeof (datum as AxisDatum).role === 'string'
  );
}

function isLegendDatum(datum: unknown): datum is LegendDatum {
  return (
    datum != null &&
    typeof datum === 'object' &&
    'entryIndex' in datum &&
    typeof (datum as LegendDatum).entryIndex === 'number'
  );
}

// =============================================================================
// Bounding Box Computation
// =============================================================================

/**
 * Compute a bounding box encompassing all provided marks (in pixels).
 * Returns null if the marks array is empty.
 */
function computeMarksBounds(
  marks: AnyMark[],
): { x: number; y: number; width: number; height: number } | null {
  if (marks.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const mark of marks) {
    const mx = mark.x;
    const my = mark.y;

    // Lower-left of mark
    let x1 = mx;
    let y1 = my;
    // Upper-right of mark
    let x2 = mx;
    let y2 = my;

    if (mark.type === 'rect') {
      x2 = mx + mark.width;
      y2 = my + mark.height;
    } else if (mark.type === 'text') {
      // Approximate text bounds using fontSize as height and a rough width estimate
      const estWidth = mark.text.length * mark.fontSize * 0.6;
      const estHeight = mark.fontSize;
      if (mark.textAlign === 'center') {
        x1 = mx - estWidth / 2;
        x2 = mx + estWidth / 2;
      } else if (mark.textAlign === 'right') {
        x1 = mx - estWidth;
        x2 = mx;
      } else {
        x2 = mx + estWidth;
      }
      if (mark.textBaseline === 'middle') {
        y1 = my - estHeight / 2;
        y2 = my + estHeight / 2;
      } else if (mark.textBaseline === 'bottom') {
        y1 = my - estHeight;
        y2 = my;
      } else {
        y2 = my + estHeight;
      }
    }
    // For path marks, the x/y are origin offsets and the path string encodes the
    // actual coordinates. A full SVG path parser is overkill here; using the mark's
    // (x, y) as a single point keeps the bounds conservative enough for layout purposes.

    if (x1 < minX) minX = x1;
    if (y1 < minY) minY = y1;
    if (x2 > maxX) maxX = x2;
    if (y2 > maxY) maxY = y2;
  }

  if (!isFinite(minX)) return null;

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

// =============================================================================
// Layout Builders
// =============================================================================

function buildPlotAreaLayout(layout: Layout): PlotAreaLayout {
  const b = boundsToPoints(layout.plotArea);
  return {
    ...b,
    insideLeft: b.left,
    insideTop: b.top,
    insideWidth: b.width,
    insideHeight: b.height,
  };
}

function buildTitleLayout(layout: Layout): TitleLayout | undefined {
  if (!layout.title) return undefined;
  return boundsToPoints(layout.title);
}

function buildDataTableLayout(layout: Layout): TitleLayout | undefined {
  if (!layout.dataTable) return undefined;
  return boundsToPoints(layout.dataTable);
}

function buildLegendLayout(layout: Layout, legendMarks: AnyMark[]): LegendLayout | undefined {
  if (!layout.legend) return undefined;

  // Group legend marks by entryIndex
  const entryMap = new Map<number, AnyMark[]>();
  for (const mark of legendMarks) {
    if (isLegendDatum(mark.datum)) {
      const idx = mark.datum.entryIndex;
      let arr = entryMap.get(idx);
      if (!arr) {
        arr = [];
        entryMap.set(idx, arr);
      }
      arr.push(mark);
    }
  }

  const entries: LegendEntryLayout[] = [];
  for (const [index, marks] of entryMap) {
    const bounds = computeMarksBounds(marks);
    if (bounds) {
      entries.push({
        ...boundsToPoints(bounds),
        index,
      });
    }
  }

  // Sort entries by index
  entries.sort((a, b) => a.index - b.index);

  return {
    ...boundsToPoints(layout.legend),
    entries,
  };
}

function buildAxisLayouts(axisMarks: AnyMark[]): AxisLayout[] {
  // Group marks by role
  const roleMap = new Map<string, AnyMark[]>();
  for (const mark of axisMarks) {
    if (isAxisDatum(mark.datum)) {
      const role = mark.datum.role;
      let arr = roleMap.get(role);
      if (!arr) {
        arr = [];
        roleMap.set(role, arr);
      }
      arr.push(mark);
    }
  }

  const axes: AxisLayout[] = [];
  for (const [role, marks] of roleMap) {
    const bounds = computeMarksBounds(marks);
    if (bounds) {
      // Map role name to channel: 'x-axis' -> 'x', 'y-axis' -> 'y'
      const channel = role.replace('-axis', '');
      axes.push({
        ...boundsToPoints(bounds),
        channel,
      });
    }
  }

  return axes;
}

function buildDataLabelLayouts(marks: AnyMark[]): DataLabelLayout[] {
  const labels: DataLabelLayout[] = [];
  for (const mark of marks) {
    if (mark.type !== 'text' || !isDataLabelDatum(mark.datum)) continue;
    const bounds = computeMarksBounds([mark]);
    if (!bounds) continue;
    labels.push({
      ...boundsToPoints(bounds),
      seriesIndex: mark.datum[SERIES_INDEX_FIELD],
      pointIndex: mark.datum[POINT_INDEX_FIELD],
    });
  }
  return labels;
}

function isDataLabelDatum(
  datum: unknown,
): datum is { [DATA_LABEL_VISIBLE_FIELD]: true; [POINT_INDEX_FIELD]: number; [SERIES_INDEX_FIELD]: number } {
  return (
    datum != null &&
    typeof datum === 'object' &&
    (datum as Record<string, unknown>)[DATA_LABEL_VISIBLE_FIELD] === true &&
    typeof (datum as Record<string, unknown>)[POINT_INDEX_FIELD] === 'number' &&
    typeof (datum as Record<string, unknown>)[SERIES_INDEX_FIELD] === 'number'
  );
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Extract a ChartLayout from a CompileResult.
 *
 * All returned dimensions are in points (1pt = 1/72in).
 * The internal CompileResult values remain in pixels.
 *
 * @param result - The compiled chart result (pixel-based)
 * @returns ChartLayout with all values in points
 */
export function extractChartLayout(result: CompileResult): ChartLayout {
  const { layout } = result;

  const plotArea = buildPlotAreaLayout(layout);
  const legend = buildLegendLayout(layout, result.legends);
  const title = buildTitleLayout(layout);
  const dataTable = buildDataTableLayout(layout);
  const axes = buildAxisLayouts(result.axes);
  const dataLabels = buildDataLabelLayouts(result.marks);

  return {
    chart: {
      left: 0,
      top: 0,
      width: pxToPt(layout.width),
      height: pxToPt(layout.height),
    },
    plotArea,
    legend,
    title,
    dataTable,
    axes,
    dataLabels,
  };
}
