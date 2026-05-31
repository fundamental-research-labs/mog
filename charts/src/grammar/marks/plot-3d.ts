import type { PathMark } from '../../primitives/types';
import type { Layout, MarkSpec, Plot3DSpec } from '../spec';
import type { Depth3DOptions } from './depth-3d';

export type Plot3DFace = 'front' | 'back' | 'top' | 'side' | 'connector' | 'outer' | 'inner';

export function depthOptionsFor3DPlot(
  markSpec: MarkSpec,
  layout: Layout,
  scale = 1,
): Depth3DOptions {
  const depthPercent = finiteNumber(markSpec.chart3d?.view3d?.depthPercent);
  const gapDepth = finiteNumber(markSpec.chart3d?.gapDepth);
  const sourceDepth = depthPercent ?? gapDepth ?? 100;
  const factor = clamp(sourceDepth / 100, 0.2, 2.5);
  const base = Math.max(5, Math.min(28, Math.min(layout.plotArea.width, layout.plotArea.height) * 0.055));
  const magnitude = base * factor * scale;
  const rotY = finiteNumber(markSpec.chart3d?.view3d?.rotY);
  const rotX = finiteNumber(markSpec.chart3d?.view3d?.rotX);
  const xSign = rotY !== undefined && rotY < 0 ? -1 : 1;
  const ySign = rotX !== undefined && rotX < 0 ? 1 : -1;

  return {
    depthX: xSign * magnitude,
    depthY: ySign * magnitude * 0.62,
    sideOpacity: 0.82,
    sideShade: -0.16,
  };
}

export function with3DMetadata<T extends PathMark>(
  mark: T,
  spec: Plot3DSpec | undefined,
  face: Plot3DFace,
  extras: Record<string, unknown> = {},
): T {
  const metadata = {
    family: spec?.family,
    face,
    orientation: spec?.orientation,
    shape: spec?.barShape,
    gapDepth: spec?.gapDepth,
    ...extras,
  };
  const datum =
    mark.datum != null && typeof mark.datum === 'object' && !Array.isArray(mark.datum)
      ? {
          ...(mark.datum as Record<string, unknown>),
          chart3d: metadata,
          __mogClipToPlotArea: false,
        }
      : {
          sourceDatum: mark.datum,
          chart3d: metadata,
          __mogClipToPlotArea: false,
        };

  return {
    ...mark,
    datum,
  };
}

export function shadeColor(color: unknown, amount: number): string | undefined {
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

export function format3DCoord(value: number): string {
  return Number.isInteger(value) ? String(value) : Number(value.toFixed(3)).toString();
}

export function polygonPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  return [
    `M${format3DCoord(first.x)},${format3DCoord(first.y)}`,
    ...rest.map((point) => `L${format3DCoord(point.x)},${format3DCoord(point.y)}`),
    'Z',
  ].join(' ');
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
