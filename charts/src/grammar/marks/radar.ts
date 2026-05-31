import { resolveStrokeColor } from '../../algebra/color';
import {
  MARKER_FILL_FIELD,
  MARKER_SHAPE_FIELD,
  MARKER_SIZE_FIELD,
  MARKER_STROKE_FIELD,
} from '../../core/chart-ir/fields';
import type { PathMark, SymbolMark, SymbolShape, TextMark } from '../../primitives/types';
import { formatTickValue } from '../axis-generator';
import type { ScaleMap } from '../encoding-resolver';
import { resolveEncodings } from '../encoding-resolver';
import type { DataRow, EncodingSpec, Layout, MarkSpec } from '../spec';
import { definedStyle, groupDataByEncoding, isBlankValueDatum } from './helpers';

type RadarPoint = {
  x: number;
  y: number;
  radius: number;
  angle: number;
  datum: DataRow;
};

const GRID_COLOR = '#d9d9d9';
const AXIS_COLOR = '#bfbfbf';
const LABEL_COLOR = '#444444';
const VALUE_LABEL_COLOR = '#666666';
const DEFAULT_FONT_FAMILY = 'Arial, sans-serif';

export function generateRadarMarks(
  markSpec: MarkSpec,
  data: DataRow[],
  scales: ScaleMap,
  encodings: ReturnType<typeof resolveEncodings>,
  layout: Layout,
  encoding?: EncodingSpec,
): Array<PathMark | SymbolMark | TextMark> {
  if (data.length === 0) return [];
  if (!scales.x || !scales.y || !encodings.x || !encodings.y) return [];

  const categories = categoryDomain(scales.x, data, encoding?.x?.field);
  if (categories.length < 3) return [];

  const geometry = radarGeometry(layout);
  const valueDomain = numericDomain(scales.y, data, encoding?.y?.field);
  if (!valueDomain) return [];

  const marks: Array<PathMark | SymbolMark | TextMark> = [];
  marks.push(...generateGridMarks(categories, geometry, valueDomain, scales.y, encoding?.y?.format));
  marks.push(...generateCategoryLabelMarks(categories, geometry));

  const categoryIndex = new Map(categories.map((category, index) => [String(category), index]));
  const groups = groupDataByEncoding(data, encodings.color ?? encodings.detail);
  let seriesIndex = 0;

  for (const [, groupData] of groups) {
    const points = radarPointsForGroup({
      groupData,
      categories,
      categoryIndex,
      geometry,
      valueDomain,
      encodings,
    });
    if (points.length === 0) continue;

    const colorValue = encodings.color?.accessor(points[0].datum);
    const color = resolveStrokeColor(
      scales.color,
      colorValue,
      markSpec.color,
      markSpec.stroke,
      seriesIndex,
    );

    if (points.length >= 2) {
      marks.push(seriesPathMark(markSpec, points, color));
    }
    if (markSpec.point) {
      marks.push(...seriesPointMarks(markSpec, points, color));
    }
    seriesIndex += 1;
  }

  return marks;
}

function radarGeometry(layout: Layout): { cx: number; cy: number; radius: number } {
  const { plotArea } = layout;
  const radius = Math.max(0, Math.min(plotArea.width, plotArea.height) / 2 - 18);
  return {
    cx: plotArea.x + plotArea.width / 2,
    cy: plotArea.y + plotArea.height / 2,
    radius,
  };
}

function categoryDomain(
  xScale: NonNullable<ScaleMap['x']>,
  data: DataRow[],
  field: string | undefined,
): string[] {
  const domain = xScale.domain?.();
  if (domain && domain.length > 0) return domain.map(String);
  if (!field) return [];

  const seen = new Set<string>();
  const values: string[] = [];
  for (const datum of data) {
    const value = datum[field];
    if (value === undefined || value === null) continue;
    const key = String(value);
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(key);
  }
  return values;
}

function numericDomain(
  yScale: NonNullable<ScaleMap['y']>,
  data: DataRow[],
  field: string | undefined,
): { min: number; max: number } | undefined {
  const rawDomain = yScale.domain?.();
  const domain = rawDomain?.filter((value): value is number => isFiniteNumber(value));
  let min = domain?.[0];
  let max = domain?.[domain.length - 1];

  if (min === undefined || max === undefined || min === max) {
    const values = field
      ? data
          .map((datum) => datum[field])
          .filter((value): value is number => isFiniteNumber(value))
      : [];
    if (values.length === 0) return undefined;
    min = Math.min(0, ...values);
    max = Math.max(...values);
  }

  if (min === max) {
    max = min + 1;
  }
  return { min, max };
}

function generateGridMarks(
  categories: string[],
  geometry: { cx: number; cy: number; radius: number },
  valueDomain: { min: number; max: number },
  yScale: NonNullable<ScaleMap['y']>,
  format: string | undefined,
): Array<PathMark | TextMark> {
  const marks: Array<PathMark | TextMark> = [];
  const ticks = radarTicks(yScale, valueDomain);

  for (const tick of ticks) {
    const radius = radiusForValue(tick, valueDomain, geometry.radius);
    if (radius <= 0 || radius > geometry.radius + 0.5) continue;
    marks.push({
      type: 'path',
      x: 0,
      y: 0,
      path: polygonPath(
        categories.map((_, index) => pointAt(index, categories.length, geometry, radius)),
      ),
      datum: { role: 'radar-grid', value: tick },
      style: {
        stroke: GRID_COLOR,
        strokeWidth: 1,
        fill: undefined,
      },
    });
    marks.push({
      type: 'text',
      x: geometry.cx - 6,
      y: geometry.cy - radius,
      text: formatTick(tick, format),
      fontSize: 10,
      fontFamily: DEFAULT_FONT_FAMILY,
      textAlign: 'right',
      textBaseline: 'middle',
      datum: { role: 'radar-value-label', value: tick },
      style: { fill: VALUE_LABEL_COLOR },
    });
  }

  for (let index = 0; index < categories.length; index += 1) {
    const outer = pointAt(index, categories.length, geometry, geometry.radius);
    marks.push({
      type: 'path',
      x: 0,
      y: 0,
      path: `M${geometry.cx},${geometry.cy} L${outer.x},${outer.y}`,
      datum: { role: 'radar-spoke', category: categories[index] },
      style: {
        stroke: AXIS_COLOR,
        strokeWidth: 1,
      },
    });
  }

  return marks;
}

function generateCategoryLabelMarks(
  categories: string[],
  geometry: { cx: number; cy: number; radius: number },
): TextMark[] {
  return categories.map((category, index) => {
    const point = pointAt(index, categories.length, geometry, geometry.radius + 14);
    const cos = Math.cos(point.angle);
    const sin = Math.sin(point.angle);
    return {
      type: 'text',
      x: point.x,
      y: point.y,
      text: category,
      fontSize: 11,
      fontFamily: DEFAULT_FONT_FAMILY,
      textAlign: Math.abs(cos) < 0.25 ? 'center' : cos > 0 ? 'left' : 'right',
      textBaseline: Math.abs(sin) < 0.25 ? 'middle' : sin > 0 ? 'top' : 'bottom',
      datum: { role: 'radar-category-label', category },
      style: { fill: LABEL_COLOR },
    };
  });
}

function radarPointsForGroup(input: {
  groupData: DataRow[];
  categories: string[];
  categoryIndex: Map<string, number>;
  geometry: { cx: number; cy: number; radius: number };
  valueDomain: { min: number; max: number };
  encodings: ReturnType<typeof resolveEncodings>;
}): RadarPoint[] {
  const pointsByIndex = new Map<number, RadarPoint>();

  for (const datum of input.groupData) {
    if (isBlankValueDatum(datum)) continue;
    const category = input.encodings.x?.accessor(datum);
    const index = input.categoryIndex.get(String(category));
    if (index === undefined) continue;

    const value = toFiniteNumber(input.encodings.y?.accessor(datum));
    if (value === undefined) continue;

    const radius = radiusForValue(value, input.valueDomain, input.geometry.radius);
    const point = pointAt(index, input.categories.length, input.geometry, radius);
    pointsByIndex.set(index, {
      ...point,
      radius,
      datum,
    });
  }

  return [...pointsByIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, point]) => point);
}

function seriesPathMark(markSpec: MarkSpec, points: RadarPoint[], color: string): PathMark {
  const seriesStroke = datumString(points[0].datum, markSpec.strokeField) ?? color;
  const seriesFill = datumString(points[0].datum, markSpec.fillField) ?? markSpec.fill ?? seriesStroke;
  const seriesStrokeWidth =
    datumNumber(points[0].datum, markSpec.strokeWidthField) ?? markSpec.strokeWidth ?? 2;
  const fillOpacity = markSpec.fillOpacity ?? 0;
  const fill = fillOpacity > 0 ? colorWithOpacity(seriesFill, fillOpacity) : undefined;
  return {
    type: 'path',
    x: 0,
    y: 0,
    path: polygonPath(points),
    datum: points.map((point) => point.datum),
    style: {
      stroke: seriesStroke,
      strokeWidth: seriesStrokeWidth,
      fill,
      opacity: markSpec.opacity ?? 1,
      ...definedStyle({
        strokePaint: markSpec.strokePaint,
        strokeDash: markSpec.strokeDash,
        line: markSpec.line,
        effects: markSpec.effects,
      }),
    },
  };
}

function seriesPointMarks(markSpec: MarkSpec, points: RadarPoint[], color: string): SymbolMark[] {
  const pointSpec = typeof markSpec.point === 'object' ? markSpec.point : {};
  return points.map((point) => {
    const fill = datumString(point.datum, MARKER_FILL_FIELD) ?? pointSpec.color ?? color;
    return {
      type: 'symbol',
      x: point.x,
      y: point.y,
      size: datumNumber(point.datum, MARKER_SIZE_FIELD) ?? pointSpec.size ?? 49,
      shape: markerShape(datumString(point.datum, MARKER_SHAPE_FIELD)),
      datum: point.datum,
      style: {
        fill: pointSpec.filled === false ? '#ffffff' : fill,
        stroke: datumString(point.datum, MARKER_STROKE_FIELD) ?? color,
        strokeWidth: 1,
        opacity: markSpec.opacity ?? 1,
      },
    };
  });
}

function radarTicks(
  yScale: NonNullable<ScaleMap['y']>,
  valueDomain: { min: number; max: number },
): number[] {
  const rawTicks = yScale.ticks?.(5) ?? [];
  const ticks = rawTicks
    .map(toFiniteNumber)
    .filter((value): value is number => value !== undefined);

  const filtered = ticks.filter((tick) => tick > valueDomain.min && tick <= valueDomain.max);
  if (filtered.length > 0) return filtered;

  const step = (valueDomain.max - valueDomain.min) / 4;
  return [1, 2, 3, 4].map((index) => valueDomain.min + step * index);
}

function radiusForValue(
  value: number,
  domain: { min: number; max: number },
  maxRadius: number,
): number {
  const span = domain.max - domain.min;
  if (span <= 0) return 0;
  const t = (value - domain.min) / span;
  return Math.max(0, Math.min(maxRadius, t * maxRadius));
}

function pointAt(
  index: number,
  count: number,
  geometry: { cx: number; cy: number },
  radius: number,
): { x: number; y: number; angle: number } {
  const angle = -Math.PI / 2 + (Math.PI * 2 * index) / count;
  return {
    x: geometry.cx + Math.cos(angle) * radius,
    y: geometry.cy + Math.sin(angle) * radius,
    angle,
  };
}

function polygonPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  return `M${first.x},${first.y}${rest.map((point) => ` L${point.x},${point.y}`).join('')} Z`;
}

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

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function markerShape(value: string | undefined): SymbolShape {
  if (
    value === 'circle' ||
    value === 'square' ||
    value === 'diamond' ||
    value === 'cross' ||
    value === 'x' ||
    value === 'star' ||
    value === 'dash' ||
    value === 'triangle-up' ||
    value === 'triangle-down'
  ) {
    return value;
  }
  return 'circle';
}

function colorWithOpacity(color: string, opacity: number): string {
  const normalized = color.trim();
  const hex = normalized.startsWith('#') ? normalized.slice(1) : normalized;
  const expanded =
    hex.length === 3
      ? hex
          .split('')
          .map((part) => `${part}${part}`)
          .join('')
      : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return normalized;

  const r = parseInt(expanded.slice(0, 2), 16);
  const g = parseInt(expanded.slice(2, 4), 16);
  const b = parseInt(expanded.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, opacity))})`;
}

function formatTick(value: number, format: string | undefined): string {
  if (format) return formatTickValue(value, format);
  if (Math.abs(value) >= 100 || Number.isInteger(value)) return String(Math.round(value));
  return Number(value.toFixed(2)).toString();
}
