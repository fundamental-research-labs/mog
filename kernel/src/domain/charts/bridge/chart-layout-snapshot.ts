import type { AnyMark, CompileResult } from '@mog/charts';
import type { ChartLayoutRect, ChartLayoutSnapshot } from '@mog-sdk/contracts/bridges';

const DATA_LABEL_VISIBLE_FIELD = '__mogDataLabelVisible';

/**
 * Extract a ChartLayoutSnapshot from a CompileResult.
 *
 * Converts the compiler's absolute pixel layout into normalized (0-1)
 * coordinates relative to the total chart dimensions, which is what the
 * OfficeJS-style getPlotAreaLayout / getLegendLayout / getTitleLayout APIs
 * return.
 */
export function extractLayoutSnapshot(result: CompileResult): ChartLayoutSnapshot | null {
  const layout = result.layout;
  if (!layout) return null;

  const totalW = layout.width || 1;
  const totalH = layout.height || 1;

  const normalize = (
    rect: { x: number; y: number; width: number; height: number } | undefined,
  ): ChartLayoutRect | undefined => {
    if (!rect) return undefined;
    return {
      left: rect.x / totalW,
      top: rect.y / totalH,
      width: rect.width / totalW,
      height: rect.height / totalH,
    };
  };

  const plotArea = normalize(layout.plotArea);
  if (!plotArea) return null;

  return {
    plotArea,
    legend: normalize(layout.legend),
    title: normalize(layout.title),
    dataTable: normalize(layout.dataTable),
    dataLabels: normalize(dataLabelBounds(result.marks)),
  };
}

function dataLabelBounds(
  marks: AnyMark[],
): { x: number; y: number; width: number; height: number } | undefined {
  const labelMarks = marks.filter(isDataLabelTextMark);
  if (labelMarks.length === 0) return undefined;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const mark of labelMarks) {
    const fontSize = mark.fontSize;
    const estimatedWidth = mark.text.length * fontSize * 0.6;
    const estimatedHeight = fontSize;
    let left = mark.x;
    let top = mark.y;
    let right = mark.x + estimatedWidth;
    let bottom = mark.y + estimatedHeight;

    if (mark.textAlign === 'center') {
      left = mark.x - estimatedWidth / 2;
      right = mark.x + estimatedWidth / 2;
    } else if (mark.textAlign === 'right') {
      left = mark.x - estimatedWidth;
      right = mark.x;
    }

    if (mark.textBaseline === 'middle') {
      top = mark.y - estimatedHeight / 2;
      bottom = mark.y + estimatedHeight / 2;
    } else if (mark.textBaseline === 'bottom') {
      top = mark.y - estimatedHeight;
      bottom = mark.y;
    }

    minX = Math.min(minX, left);
    minY = Math.min(minY, top);
    maxX = Math.max(maxX, right);
    maxY = Math.max(maxY, bottom);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function isDataLabelTextMark(mark: AnyMark): mark is Extract<AnyMark, { type: 'text' }> {
  return mark.type === 'text' && isDataLabelDatum(mark.datum);
}

function isDataLabelDatum(datum: unknown): boolean {
  return (
    datum != null &&
    typeof datum === 'object' &&
    (datum as Record<string, unknown>)[DATA_LABEL_VISIBLE_FIELD] === true
  );
}
