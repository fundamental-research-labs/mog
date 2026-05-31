import type { ArcMark, MarkStyle, PathMark } from '../../primitives/types';
import { parsePath, type PathCommand } from '../../primitives/marks/path';

export interface Depth3DOptions {
  depthX?: number;
  depthY?: number;
  includeTop?: boolean;
  sideOpacity?: number;
  sideShade?: number;
}

type Point = {
  x: number;
  y: number;
};

const DEFAULT_DEPTH_X = 10;
const DEFAULT_DEPTH_Y = 8;
const DEFAULT_SIDE_OPACITY = 0.72;
const DEFAULT_SIDE_SHADE = -0.18;
const EPSILON = 1e-9;
const TWO_PI = Math.PI * 2;

export function depthEnhanceLinePathMark(mark: PathMark, options: Depth3DOptions = {}): PathMark[] {
  const depth = depthVector(options);
  const endpoints = pathEndpoints(mark.path);
  const translatedPath = translatePath(mark.path, depth.x, depth.y);
  const marks: PathMark[] = translatedPath
    ? [translatedPathMark(mark, translatedPath, sideStyle(mark.style, options))]
    : [];

  if (endpoints) {
    marks.push(
      lineDepthConnector(mark, endpoints.start, depth, options),
      lineDepthConnector(mark, endpoints.end, depth, options),
    );
  }

  if (options.includeTop !== false) marks.push(mark);
  return marks;
}

export function depthEnhanceLinePathMarks(
  marks: PathMark[],
  options: Depth3DOptions = {},
): PathMark[] {
  return marks.flatMap((mark) => depthEnhanceLinePathMark(mark, options));
}

export function depthEnhanceAreaPathMark(mark: PathMark, options: Depth3DOptions = {}): PathMark[] {
  const depth = depthVector(options);
  const points = pathPolygonPoints(mark.path);
  const translatedPath = translatePath(mark.path, depth.x, depth.y);
  const marks: PathMark[] = translatedPath
    ? [translatedPathMark(mark, translatedPath, sideFillStyle(mark.style, options))]
    : [];

  for (let i = 0; i < points.length; i += 1) {
    const next = points[(i + 1) % points.length];
    if (!next) continue;
    marks.push(areaDepthFace(mark, points[i], next, depth, options));
  }

  if (options.includeTop !== false) marks.push(mark);
  return marks;
}

export function depthEnhanceAreaPathMarks(
  marks: PathMark[],
  options: Depth3DOptions = {},
): PathMark[] {
  return marks.flatMap((mark) => depthEnhanceAreaPathMark(mark, options));
}

export function depthEnhanceArcMark(mark: ArcMark, options: Depth3DOptions = {}): PathMark[] {
  const depth = depthVector(options);
  const arc = normalizedArc(mark);
  if (!arc) return [];

  const marks: PathMark[] = [
    arcOuterDepthFace(mark, arc, depth, options),
    arcEndDepthFace(mark, arc.startAngle, depth, options),
    arcEndDepthFace(mark, arc.endAngle, depth, options),
  ];

  if (mark.innerRadius > 0) {
    marks.push(arcInnerDepthFace(mark, arc, depth, options));
  }

  if (options.includeTop !== false) {
    marks.push(arcTopPathMark(mark, arc));
  }

  return marks;
}

export function depthEnhanceArcMarks(marks: ArcMark[], options: Depth3DOptions = {}): PathMark[] {
  return marks.flatMap((mark) => depthEnhanceArcMark(mark, options));
}

export function arcMarkToPathMark(mark: ArcMark): PathMark | null {
  const arc = normalizedArc(mark);
  return arc ? arcTopPathMark(mark, arc) : null;
}

function depthVector(options: Depth3DOptions): Point {
  return {
    x: finiteNumber(options.depthX) ?? DEFAULT_DEPTH_X,
    y: finiteNumber(options.depthY) ?? DEFAULT_DEPTH_Y,
  };
}

function translatedPathMark(mark: PathMark, path: string, style: MarkStyle): PathMark {
  return {
    ...mark,
    path,
    style,
  };
}

function lineDepthConnector(
  mark: PathMark,
  point: Point,
  depth: Point,
  options: Depth3DOptions,
): PathMark {
  return {
    type: 'path',
    x: mark.x,
    y: mark.y,
    path: `M${formatNumber(point.x)},${formatNumber(point.y)} L${formatNumber(
      point.x + depth.x,
    )},${formatNumber(point.y + depth.y)}`,
    datum: mark.datum,
    style: sideStyle(mark.style, options),
  };
}

function areaDepthFace(
  mark: PathMark,
  a: Point,
  b: Point,
  depth: Point,
  options: Depth3DOptions,
): PathMark {
  return {
    type: 'path',
    x: mark.x,
    y: mark.y,
    path: polygonPath([a, b, offsetPoint(b, depth), offsetPoint(a, depth)]),
    datum: mark.datum,
    style: {
      ...sideFillStyle(mark.style, options),
      strokeWidth: mark.style.strokeWidth ?? 0.5,
    },
  };
}

function arcTopPathMark(mark: ArcMark, arc: NormalizedArc): PathMark {
  return {
    type: 'path',
    x: 0,
    y: 0,
    path: arcSlicePath(mark, arc.startAngle, arc.endAngle),
    datum: mark.datum,
    style: mark.style,
  };
}

function arcOuterDepthFace(
  mark: ArcMark,
  arc: NormalizedArc,
  depth: Point,
  options: Depth3DOptions,
): PathMark {
  const start = polarPoint(mark, mark.outerRadius, arc.startAngle);
  const end = polarPoint(mark, mark.outerRadius, arc.endAngle);
  const startBack = offsetPoint(start, depth);
  const endBack = offsetPoint(end, depth);
  return {
    type: 'path',
    x: 0,
    y: 0,
    path: [
      `M${pointString(start)}`,
      arcCommand(mark.outerRadius, arc.span, true, end),
      `L${pointString(endBack)}`,
      arcCommand(mark.outerRadius, arc.span, false, startBack),
      'Z',
    ].join(' '),
    datum: mark.datum,
    style: sideFillStyle(mark.style, options),
  };
}

function arcInnerDepthFace(
  mark: ArcMark,
  arc: NormalizedArc,
  depth: Point,
  options: Depth3DOptions,
): PathMark {
  const start = polarPoint(mark, mark.innerRadius, arc.startAngle);
  const end = polarPoint(mark, mark.innerRadius, arc.endAngle);
  const startBack = offsetPoint(start, depth);
  const endBack = offsetPoint(end, depth);
  return {
    type: 'path',
    x: 0,
    y: 0,
    path: [
      `M${pointString(end)}`,
      arcCommand(mark.innerRadius, arc.span, false, start),
      `L${pointString(startBack)}`,
      arcCommand(mark.innerRadius, arc.span, true, endBack),
      'Z',
    ].join(' '),
    datum: mark.datum,
    style: sideFillStyle(mark.style, options),
  };
}

function arcEndDepthFace(
  mark: ArcMark,
  angle: number,
  depth: Point,
  options: Depth3DOptions,
): PathMark {
  const outer = polarPoint(mark, mark.outerRadius, angle);
  const inner =
    mark.innerRadius > 0 ? polarPoint(mark, mark.innerRadius, angle) : { x: mark.x, y: mark.y };
  return {
    type: 'path',
    x: 0,
    y: 0,
    path: polygonPath([inner, outer, offsetPoint(outer, depth), offsetPoint(inner, depth)]),
    datum: mark.datum,
    style: sideFillStyle(mark.style, options),
  };
}

function arcSlicePath(mark: ArcMark, startAngle: number, endAngle: number): string {
  const span = endAngle - startAngle;
  if (span >= TWO_PI - EPSILON) {
    return fullArcSlicePath(mark, startAngle);
  }

  const outerStart = polarPoint(mark, mark.outerRadius, startAngle);
  const outerEnd = polarPoint(mark, mark.outerRadius, endAngle);

  if (mark.innerRadius <= 0) {
    return [
      `M${formatNumber(mark.x)},${formatNumber(mark.y)}`,
      `L${pointString(outerStart)}`,
      arcCommand(mark.outerRadius, span, true, outerEnd),
      'Z',
    ].join(' ');
  }

  const innerEnd = polarPoint(mark, mark.innerRadius, endAngle);
  const innerStart = polarPoint(mark, mark.innerRadius, startAngle);
  return [
    `M${pointString(outerStart)}`,
    arcCommand(mark.outerRadius, span, true, outerEnd),
    `L${pointString(innerEnd)}`,
    arcCommand(mark.innerRadius, span, false, innerStart),
    'Z',
  ].join(' ');
}

function fullArcSlicePath(mark: ArcMark, startAngle: number): string {
  const midAngle = startAngle + Math.PI;
  const endAngle = startAngle + TWO_PI;
  const outerStart = polarPoint(mark, mark.outerRadius, startAngle);
  const outerMid = polarPoint(mark, mark.outerRadius, midAngle);
  const outerEnd = polarPoint(mark, mark.outerRadius, endAngle);

  if (mark.innerRadius <= 0) {
    return [
      `M${formatNumber(mark.x)},${formatNumber(mark.y)}`,
      `L${pointString(outerStart)}`,
      arcCommand(mark.outerRadius, Math.PI, true, outerMid),
      arcCommand(mark.outerRadius, Math.PI, true, outerEnd),
      'Z',
    ].join(' ');
  }

  const innerEnd = polarPoint(mark, mark.innerRadius, endAngle);
  const innerMid = polarPoint(mark, mark.innerRadius, startAngle + Math.PI);
  const innerStart = polarPoint(mark, mark.innerRadius, startAngle);
  return [
    `M${pointString(outerStart)}`,
    arcCommand(mark.outerRadius, Math.PI, true, outerMid),
    arcCommand(mark.outerRadius, Math.PI, true, outerEnd),
    `L${pointString(innerEnd)}`,
    arcCommand(mark.innerRadius, Math.PI, false, innerMid),
    arcCommand(mark.innerRadius, Math.PI, false, innerStart),
    'Z',
  ].join(' ');
}

type NormalizedArc = {
  startAngle: number;
  endAngle: number;
  span: number;
};

function normalizedArc(mark: ArcMark): NormalizedArc | null {
  if (!isFinitePositive(mark.outerRadius)) return null;
  if (!Number.isFinite(mark.startAngle) || !Number.isFinite(mark.endAngle)) return null;

  let startAngle = mark.startAngle;
  let endAngle = mark.endAngle;
  if (endAngle < startAngle) {
    [startAngle, endAngle] = [endAngle, startAngle];
  }

  const span = Math.min(endAngle - startAngle, TWO_PI);
  if (span <= EPSILON) return null;
  return { startAngle, endAngle: startAngle + span, span };
}

function translatePath(path: string, dx: number, dy: number): string {
  return parsePath(path)
    .map((command) => translateCommand(command, dx, dy))
    .join(' ');
}

function translateCommand(command: PathCommand, dx: number, dy: number): string {
  switch (command.type) {
    case 'M':
    case 'L':
    case 'T':
      return `${command.type}${formatNumber(command.x + dx)},${formatNumber(command.y + dy)}`;
    case 'H':
      return `H${formatNumber(command.x + dx)}`;
    case 'V':
      return `V${formatNumber(command.y + dy)}`;
    case 'C':
      return `C${formatNumber(command.x1 + dx)},${formatNumber(command.y1 + dy)} ${formatNumber(
        command.x2 + dx,
      )},${formatNumber(command.y2 + dy)} ${formatNumber(command.x + dx)},${formatNumber(
        command.y + dy,
      )}`;
    case 'S':
      return `S${formatNumber(command.x2 + dx)},${formatNumber(command.y2 + dy)} ${formatNumber(
        command.x + dx,
      )},${formatNumber(command.y + dy)}`;
    case 'Q':
      return `Q${formatNumber(command.x1 + dx)},${formatNumber(command.y1 + dy)} ${formatNumber(
        command.x + dx,
      )},${formatNumber(command.y + dy)}`;
    case 'A':
      return `A${formatNumber(command.rx)},${formatNumber(command.ry)} ${formatNumber(
        command.angle,
      )} ${command.largeArc ? 1 : 0} ${command.sweep ? 1 : 0} ${formatNumber(
        command.x + dx,
      )},${formatNumber(command.y + dy)}`;
    case 'Z':
      return 'Z';
  }
}

function pathEndpoints(path: string): { start: Point; end: Point } | null {
  const points = pathPoints(path);
  if (points.length === 0) return null;
  return {
    start: points[0],
    end: points[points.length - 1],
  };
}

function pathPolygonPoints(path: string): Point[] {
  const points = pathPoints(path);
  if (points.length > 1 && samePoint(points[0], points[points.length - 1])) {
    points.pop();
  }
  return points;
}

function pathPoints(path: string): Point[] {
  const points: Point[] = [];
  let current: Point = { x: 0, y: 0 };
  for (const command of parsePath(path)) {
    switch (command.type) {
      case 'M':
      case 'L':
      case 'T':
        current = { x: command.x, y: command.y };
        points.push(current);
        break;
      case 'H':
        current = { x: command.x, y: current.y };
        points.push(current);
        break;
      case 'V':
        current = { x: current.x, y: command.y };
        points.push(current);
        break;
      case 'C':
      case 'S':
      case 'Q':
      case 'A':
        current = { x: command.x, y: command.y };
        points.push(current);
        break;
      case 'Z':
        break;
    }
  }
  return points;
}

function sideStyle(style: MarkStyle, options: Depth3DOptions): MarkStyle {
  const color = style.stroke ?? style.fill;
  return {
    ...style,
    fill: undefined,
    stroke: shadeColor(color, options.sideShade ?? DEFAULT_SIDE_SHADE),
    opacity: sideOpacity(style, options),
  };
}

function sideFillStyle(style: MarkStyle, options: Depth3DOptions): MarkStyle {
  const color = style.fill ?? style.stroke;
  const shaded = shadeColor(color, options.sideShade ?? DEFAULT_SIDE_SHADE);
  return {
    ...style,
    fill: shaded,
    stroke: shadeColor(style.stroke ?? shaded, options.sideShade ?? DEFAULT_SIDE_SHADE),
    opacity: sideOpacity(style, options),
  };
}

function sideOpacity(style: MarkStyle, options: Depth3DOptions): number {
  return (style.opacity ?? 1) * (options.sideOpacity ?? DEFAULT_SIDE_OPACITY);
}

function shadeColor(color: unknown, amount: number): string | undefined {
  if (typeof color !== 'string') return undefined;
  if (!/^#[0-9a-f]{6}$/i.test(color)) return color;
  const channel = (offset: number) => {
    const value = Number.parseInt(color.slice(offset, offset + 2), 16);
    return clamp(Math.round(value + amount * 255), 0, 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

function arcCommand(radius: number, span: number, sweep: boolean, point: Point): string {
  return `A${formatNumber(radius)},${formatNumber(radius)} 0 ${span > Math.PI ? 1 : 0} ${
    sweep ? 1 : 0
  } ${pointString(point)}`;
}

function polarPoint(mark: ArcMark, radius: number, angle: number): Point {
  return {
    x: mark.x + Math.cos(angle) * radius,
    y: mark.y + Math.sin(angle) * radius,
  };
}

function offsetPoint(point: Point, depth: Point): Point {
  return {
    x: point.x + depth.x,
    y: point.y + depth.y,
  };
}

function polygonPath(points: Point[]): string {
  if (points.length === 0) return '';
  let path = `M${pointString(points[0])}`;
  for (let i = 1; i < points.length; i += 1) {
    path += ` L${pointString(points[i])}`;
  }
  return `${path} Z`;
}

function pointString(point: Point): string {
  return `${formatNumber(point.x)},${formatNumber(point.y)}`;
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON;
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : Number(value.toFixed(3)).toString();
}
