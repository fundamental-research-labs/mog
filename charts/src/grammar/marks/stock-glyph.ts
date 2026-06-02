import type { PathMark, RectMark } from '../../primitives/types';
import type { ScaleMap } from '../encoding-resolver';
import { resolveEncodings } from '../encoding-resolver';
import type {
  DataRow,
  EncodingSpec,
  Layout,
  MarkSpec,
  StockGlyphBodyVisualSpec,
  StockGlyphStrokeVisualSpec,
  StockGlyphVisualSpec,
} from '../spec';
import { calculateStockGlyphGeometry } from '../stock-glyph-geometry';
import { NATIVE_STOCK_GLYPH_PROFILE } from '../stock-glyph-profile';
import type {
  StockGlyphBodyRectTrace,
  StockGlyphDirection,
  StockGlyphSegmentTrace,
  StockGlyphVolumeRectTrace,
} from '../types';

type StockGlyphMark = PathMark | RectMark;

export function generateStockGlyphMarks(
  markSpec: MarkSpec,
  data: DataRow[],
  scales: ScaleMap,
  encodings: ReturnType<typeof resolveEncodings>,
  layout: Layout,
  encoding?: EncodingSpec,
): StockGlyphMark[] {
  const geometry = calculateStockGlyphGeometry({
    layerIndex: 0,
    markSpec,
    data,
    scales,
    encodings,
    layout,
    encoding,
  });
  if (!geometry) return [];

  const marks: StockGlyphMark[] = [];
  const visual = markSpec.stockVisual ?? defaultStockVisual(markSpec);

  for (const role of visual.drawOrder) {
    for (const point of geometry.points) {
      if (role === 'volume' && point.volumeRect && visual.volume) {
        marks.push(rectMark(point.volumeRect, point.datum, visual.volume));
      } else if (role === 'highLowStem') {
        const mark = pathMark(point.stem, point.datum, visual.highLowLine);
        if (mark) marks.push(mark);
      } else if (role === 'body' && point.bodyRect) {
        marks.push(
          rectMark(point.bodyRect, point.datum, bodyStyleForDirection(visual, point.direction)),
        );
      } else if (role === 'openTick' && point.openTick) {
        const mark = pathMark(point.openTick, point.datum, visual.openTick);
        if (mark) marks.push(mark);
      } else if (role === 'closeTick' && point.closeTick) {
        const mark = pathMark(point.closeTick, point.datum, visual.closeTick);
        if (mark) marks.push(mark);
      }
    }
  }

  return marks;
}

function pathMark(
  segment: StockGlyphSegmentTrace,
  datum: DataRow,
  visual: StockGlyphStrokeVisualSpec,
): PathMark | undefined {
  if (visual.strokeWidth <= 0) return undefined;
  return {
    type: 'path',
    x: 0,
    y: 0,
    path: `M${segment.x1},${segment.y1} L${segment.x2},${segment.y2}`,
    datum,
    style: {
      stroke: visual.stroke,
      strokeWidth: visual.strokeWidth,
      ...(visual.strokeOpacity !== undefined ? { opacity: visual.strokeOpacity } : {}),
      ...(visual.strokeDash ? { strokeDash: visual.strokeDash } : {}),
      line: stockGlyphLineStyle(visual),
    },
  };
}

function stockGlyphLineStyle(visual: StockGlyphStrokeVisualSpec): StockGlyphStrokeVisualSpec['line'] {
  const line = visual.line;
  return {
    ...(line ?? {}),
    paint: line?.paint ?? {
      type: 'solid' as const,
      color: visual.stroke,
    },
    width: line?.width ?? visual.strokeWidth,
    ...(line?.dash ?? visual.strokeDash ? { dash: line?.dash ?? visual.strokeDash } : {}),
    cap: line?.cap ?? NATIVE_STOCK_GLYPH_PROFILE.lineCap,
    join: line?.join ?? NATIVE_STOCK_GLYPH_PROFILE.lineJoin,
  };
}

function rectMark(
  rect: StockGlyphBodyRectTrace | StockGlyphVolumeRectTrace,
  datum: DataRow,
  visual: StockGlyphBodyVisualSpec,
): RectMark {
  const line =
    visual.borderWidth > 0
      ? {
          ...(visual.borderLine ?? {}),
          paint: visual.borderLine?.paint ?? {
            type: 'solid' as const,
            color: visual.border,
            ...(visual.borderOpacity !== undefined ? { opacity: visual.borderOpacity } : {}),
          },
          width: visual.borderLine?.width ?? visual.borderWidth,
        }
      : undefined;
  return {
    type: 'rect',
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    datum,
    style: {
      fill: visual.fill,
      fillPaint: visual.fillPaint ?? {
        type: 'solid' as const,
        color: visual.fill,
        ...(visual.fillOpacity !== undefined ? { opacity: visual.fillOpacity } : {}),
      },
      ...(visual.borderWidth > 0
        ? {
            stroke: visual.border,
            strokeWidth: visual.borderWidth,
          }
        : {}),
      ...(line ? { line } : {}),
    },
  };
}

function bodyStyleForDirection(
  visual: StockGlyphVisualSpec,
  direction: StockGlyphDirection,
): StockGlyphBodyVisualSpec {
  if (direction === 'down') return visual.downBody;
  if (direction === 'flat' || direction === 'unknown') return visual.flatBody;
  return visual.upBody;
}

function defaultStockVisual(markSpec: MarkSpec): StockGlyphVisualSpec {
  const stroke = markSpec.stroke ?? markSpec.color ?? '#000000';
  const stemStrokeWidth = markSpec.strokeWidth ?? NATIVE_STOCK_GLYPH_PROFILE.stemStrokeWidth;
  const tickStrokeWidth = markSpec.strokeWidth ?? NATIVE_STOCK_GLYPH_PROFILE.tickStrokeWidth;
  const stemLine: StockGlyphStrokeVisualSpec = {
    stroke,
    strokeWidth: stemStrokeWidth,
    source: 'excelDefault',
  };
  const tickLine: StockGlyphStrokeVisualSpec = {
    stroke,
    strokeWidth: tickStrokeWidth,
    source: 'excelDefault',
  };
  const upBody: StockGlyphBodyVisualSpec = {
    fill: '#ffffff',
    border: stroke,
    borderWidth: stemStrokeWidth,
    source: 'excelDefault',
  };
  const downBody: StockGlyphBodyVisualSpec = {
    fill: markSpec.fill ?? markSpec.color ?? '#7f7f7f',
    border: stroke,
    borderWidth: stemStrokeWidth,
    source: 'excelDefault',
  };
  return {
    visualStatus: 'available',
    priceGlyphMode: 'ohlcTick',
    gapWidth: NATIVE_STOCK_GLYPH_PROFILE.effectiveGapWidth,
    slotOccupancy: NATIVE_STOCK_GLYPH_PROFILE.slotOccupancy,
    drawOrder: ['volume', 'highLowStem', 'openTick', 'closeTick'],
    highLowLine: stemLine,
    openTick: tickLine,
    closeTick: tickLine,
    upBody,
    downBody,
    flatBody: upBody,
    volume: {
      fill: markSpec.fill ?? markSpec.color ?? '#5b9bd5',
      fillOpacity: markSpec.fillOpacity ?? 0.72,
      border: '#3f6f9f',
      borderWidth: 0,
      source: 'excelDefault',
      gapWidth: 150,
      slotOccupancy: 100 / 250,
      surfacePolicy: { type: 'plotFraction', fraction: 0.24 },
    },
    styleSources: ['excelDefault'],
  };
}
