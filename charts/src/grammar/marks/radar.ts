import { resolveStrokeColor } from '../../algebra/color';
import {
  MARKER_FILL_FIELD,
  MARKER_SHAPE_FIELD,
  MARKER_SIZE_FIELD,
  MARKER_STROKE_FIELD,
  MARKER_VISIBLE_FIELD,
  SERIES_FILL_OPACITY_FIELD,
} from '../../core/chart-ir/fields';
import {
  RADAR_DEFAULT_MARKER_SIZE,
  RADAR_LABEL_GAP,
  radarAutomaticMarkerShape,
  radarGeometryForPlotArea,
  radarPointAt,
  radarRadiusForValue,
  type RadarGeometry,
  type RadarValueDomain,
} from '../../core/radar-semantics';
import type { PathMark, SymbolMark, SymbolShape, TextMark } from '../../primitives/types';
import { formatTickValue } from '../axis-generator';
import type { ScaleMap } from '../encoding-resolver';
import { resolveEncodings } from '../encoding-resolver';
import type { AxisSpec, DataRow, EncodingSpec, Layout, MarkSpec, ScaleSpec } from '../spec';
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
  marks.push(
    ...generateGridMarks(
      categories,
      geometry,
      valueDomain,
      scales.y,
      encoding?.y,
    ),
  );
  marks.push(...generateCategoryLabelMarks(categories, geometry, encoding?.x?.radarAxis));

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
      marks.push(...seriesPointMarks(markSpec, points, color, seriesIndex));
    }
    seriesIndex += 1;
  }

  return marks;
}

function radarGeometry(layout: Layout): RadarGeometry {
  return radarGeometryForPlotArea(layout.plotArea);
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
): RadarValueDomain | undefined {
  const rawDomain = yScale.domain?.();
  const domain = rawDomain?.filter((value): value is number => isFiniteNumber(value));
  let min = domain?.[0];
  let max = domain?.[domain.length - 1];

  if (min === undefined || max === undefined || min === max) {
    const values = field
      ? data.map((datum) => datum[field]).filter((value): value is number => isFiniteNumber(value))
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
  geometry: RadarGeometry,
  valueDomain: RadarValueDomain,
  yScale: NonNullable<ScaleMap['y']>,
  yEncoding: EncodingSpec['y'] | undefined,
): Array<PathMark | TextMark> {
  const marks: Array<PathMark | TextMark> = [];
  const ticks = radarTicks(yScale, valueDomain, yEncoding?.scale);
  const axis = yEncoding?.radarAxis;
  const gridColor = axis?.gridColor ?? GRID_COLOR;
  const gridWidth = axis?.gridWidth ?? 1;
  const gridOpacity = finiteNumber(axis?.gridOpacity);
  const gridDash = axis?.gridDash;
  const showGrid = axis?.grid !== false;
  const valueLabelColor = axis?.labelColor ?? VALUE_LABEL_COLOR;
  const valueLabelFontSize = axis?.labelFontSize ?? 10;
  const valueLabelFontFamily = axis?.labelFontFamily ?? DEFAULT_FONT_FAMILY;
  const showValueLabels = axis?.labels !== false;
  const spokeColor = axis?.domainColor ?? axis?.tickColor ?? AXIS_COLOR;
  const spokeWidth = axis?.domainWidth ?? axis?.tickWidth ?? 1;

  for (const tick of ticks) {
    const radius = radarRadiusForValue(tick, valueDomain, geometry.radius);
    if (radius <= 0 || radius > geometry.radius + 0.5) continue;
    if (showGrid) {
      marks.push({
        type: 'path',
        x: 0,
        y: 0,
        path: polygonPath(
          categories.map((_, index) => radarPointAt(index, categories.length, geometry, radius)),
        ),
        datum: { role: 'radar-grid', value: tick },
        style: {
          stroke: gridColor,
          strokeWidth: gridWidth,
          opacity: gridOpacity,
          strokeDash: gridDash,
          fill: undefined,
        },
      });
    }
    if (showValueLabels) {
      marks.push({
        type: 'text',
        x: geometry.cx - 6,
        y: geometry.cy - radius,
        text: formatTick(tick, yEncoding?.format ?? axis?.format),
        fontSize: valueLabelFontSize,
        fontFamily: valueLabelFontFamily,
        textAlign: 'right',
        textBaseline: 'middle',
        datum: { role: 'radar-value-label', value: tick },
        style: { fill: valueLabelColor },
      });
    }
  }

  for (let index = 0; index < categories.length; index += 1) {
    const outer = radarPointAt(index, categories.length, geometry, geometry.radius);
    marks.push({
      type: 'path',
      x: 0,
      y: 0,
      path: `M${geometry.cx},${geometry.cy} L${outer.x},${outer.y}`,
      datum: { role: 'radar-spoke', category: categories[index] },
      style: {
        stroke: spokeColor,
        strokeWidth: spokeWidth,
      },
    });
  }

  return marks;
}

function generateCategoryLabelMarks(
  categories: string[],
  geometry: RadarGeometry,
  axis: AxisSpec | null | undefined,
): TextMark[] {
  if (axis?.labels === false) return [];
  return categories.map((category, index) => {
    const point = radarPointAt(
      index,
      categories.length,
      geometry,
      geometry.radius + RADAR_LABEL_GAP,
    );
    const cos = Math.cos(point.angle);
    const sin = Math.sin(point.angle);
    return {
      type: 'text',
      x: point.x,
      y: point.y,
      text: category,
      fontSize: axis?.labelFontSize ?? 11,
      fontFamily: axis?.labelFontFamily ?? DEFAULT_FONT_FAMILY,
      textAlign: Math.abs(cos) < 0.25 ? 'center' : cos > 0 ? 'left' : 'right',
      textBaseline: Math.abs(sin) < 0.25 ? 'middle' : sin > 0 ? 'top' : 'bottom',
      datum: { role: 'radar-category-label', category },
      style: { fill: axis?.labelColor ?? LABEL_COLOR },
    };
  });
}

function radarPointsForGroup(input: {
  groupData: DataRow[];
  categories: string[];
  categoryIndex: Map<string, number>;
  geometry: RadarGeometry;
  valueDomain: RadarValueDomain;
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

    const radius = radarRadiusForValue(value, input.valueDomain, input.geometry.radius);
    const point = radarPointAt(index, input.categories.length, input.geometry, radius);
    pointsByIndex.set(index, {
      ...point,
      radius,
      datum,
    });
  }

  return [...pointsByIndex.entries()].sort(([a], [b]) => a - b).map(([, point]) => point);
}

function seriesPathMark(markSpec: MarkSpec, points: RadarPoint[], color: string): PathMark {
  const seriesStroke = datumString(points[0].datum, markSpec.strokeField) ?? color;
  const seriesFill =
    datumString(points[0].datum, markSpec.fillField) ?? markSpec.fill ?? seriesStroke;
  const seriesStrokeWidth =
    datumNumber(points[0].datum, markSpec.strokeWidthField) ?? markSpec.strokeWidth ?? 2;
  const fillOpacity =
    datumNumber(points[0].datum, SERIES_FILL_OPACITY_FIELD) ?? markSpec.fillOpacity ?? 0;
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

function seriesPointMarks(
  markSpec: MarkSpec,
  points: RadarPoint[],
  color: string,
  seriesIndex: number,
): SymbolMark[] {
  const pointSpec = typeof markSpec.point === 'object' ? markSpec.point : {};
  return points.flatMap((point) => {
    if (datumBoolean(point.datum, MARKER_VISIBLE_FIELD) === false) return [];
    const fill = datumString(point.datum, MARKER_FILL_FIELD) ?? pointSpec.color ?? color;
    return [
      {
        type: 'symbol',
        x: point.x,
        y: point.y,
        size:
          datumNumber(point.datum, MARKER_SIZE_FIELD) ??
          pointSpec.size ??
          RADAR_DEFAULT_MARKER_SIZE,
        shape: markerShape(datumString(point.datum, MARKER_SHAPE_FIELD), seriesIndex),
        datum: point.datum,
        style: {
          fill: pointSpec.filled === false ? '#ffffff' : fill,
          stroke: datumString(point.datum, MARKER_STROKE_FIELD) ?? color,
          strokeWidth: 1,
          opacity: markSpec.opacity ?? 1,
        },
      },
    ];
  });
}

function radarTicks(
  yScale: NonNullable<ScaleMap['y']>,
  valueDomain: RadarValueDomain,
  scaleSpec: ScaleSpec | null | undefined,
): number[] {
  const metadataTicks = scaleSpec?.radarTickValues
    ?.map(toFiniteNumber)
    .filter((value): value is number => value !== undefined)
    .filter((tick) => tick > valueDomain.min && tick <= valueDomain.max);
  if (metadataTicks && metadataTicks.length > 0) return metadataTicks;

  const metadataStep = finiteNumber(scaleSpec?.radarTickStep);
  if (metadataStep !== undefined && metadataStep > 0) {
    const steppedTicks: number[] = [];
    const start = Math.ceil(valueDomain.min / metadataStep) * metadataStep;
    for (let tick = start; tick <= valueDomain.max + metadataStep * 1e-10; tick += metadataStep) {
      if (tick > valueDomain.min) steppedTicks.push(Number(tick.toPrecision(12)));
      if (steppedTicks.length > 1000) break;
    }
    if (steppedTicks.length > 0) return steppedTicks;
  }

  const rawTicks = yScale.ticks?.(5) ?? [];
  const ticks = rawTicks
    .map(toFiniteNumber)
    .filter((value): value is number => value !== undefined);

  const filtered = ticks.filter((tick) => tick > valueDomain.min && tick <= valueDomain.max);
  if (filtered.length > 0) return filtered;

  const step = (valueDomain.max - valueDomain.min) / 4;
  return [1, 2, 3, 4].map((index) => valueDomain.min + step * index);
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

function datumBoolean(datum: DataRow, field: string | undefined): boolean | undefined {
  if (!field) return undefined;
  const value = datum[field];
  return typeof value === 'boolean' ? value : undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function markerShape(value: string | undefined, seriesIndex: number): SymbolShape {
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
  return radarAutomaticMarkerShape(seriesIndex);
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
