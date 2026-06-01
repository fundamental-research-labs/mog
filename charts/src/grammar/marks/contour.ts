import type { PathMark } from '../../primitives/types';
import { POINT_INDEX_FIELD, SERIES_INDEX_FIELD, VALUE_FIELD } from '../../core/chart-ir/fields';
import type { ContourBandSpec, DataRow, Layout, MarkSpec } from '../spec';

type GridPoint = {
  x: number;
  y: number;
  z: number;
  datum: DataRow;
};

type PolygonVertex = {
  x: number;
  y: number;
  z: number;
};

const EPSILON = 1e-9;

/**
 * Generate filled contour marks for top-view OOXML surface charts.
 *
 * Excel represents contour charts as a surface grid viewed from above. The
 * source data is a matrix: category index on X, series index on Y, and point
 * value on Z/color. We clip each grid cell against every value band, yielding
 * interpolated band polygons instead of the old per-series rectangle fallback.
 */
export function generateContourMarks(
  markSpec: MarkSpec,
  data: DataRow[],
  layout: Layout,
): PathMark[] {
  const bands = markSpec.contourBands ?? [];
  if (bands.length === 0 || data.length === 0) return [];

  const grid = buildGrid(data, layout);
  if (!grid) return [];

  return markSpec.contourWireframe
    ? generateWireframeContourMarks(grid, bands)
    : generateFilledContourMarks(grid, bands);
}

function generateFilledContourMarks(
  grid: NonNullable<ReturnType<typeof buildGrid>>,
  bands: ContourBandSpec[],
): PathMark[] {
  const marks: PathMark[] = [];

  for (let bandIndex = 0; bandIndex < bands.length; bandIndex += 1) {
    const band = bands[bandIndex];
    for (let y = 0; y < grid.rows.length - 1; y += 1) {
      for (let x = 0; x < grid.cols.length - 1; x += 1) {
        const corners = cellCorners(grid, x, y);
        if (!corners) continue;

        const polygon = clipCellToBand(corners, band, bandIndex, bands.length);
        if (polygon.length < 3) continue;

        marks.push({
          type: 'path',
          x: 0,
          y: 0,
          path: polygonPath(polygon),
          datum: {
            contourBand: band.label,
            contourBandIndex: bandIndex,
            contourMin: band.min,
            contourMax: band.max,
          },
          style: {
            fill: band.color,
            stroke: band.color,
            strokeWidth: 0.35,
            opacity: markOpacity(polygon),
          },
        });
      }
    }
  }

  return marks;
}

function generateWireframeContourMarks(
  grid: NonNullable<ReturnType<typeof buildGrid>>,
  bands: ContourBandSpec[],
): PathMark[] {
  const marks: PathMark[] = [];
  const thresholds = bands.slice(1).map((band) => band.min);

  for (let thresholdIndex = 0; thresholdIndex < thresholds.length; thresholdIndex += 1) {
    const threshold = thresholds[thresholdIndex];
    const band = bands[thresholdIndex + 1] ?? bands[thresholdIndex];
    for (let y = 0; y < grid.rows.length - 1; y += 1) {
      for (let x = 0; x < grid.cols.length - 1; x += 1) {
        const corners = cellCorners(grid, x, y);
        if (!corners) continue;
        for (const segment of contourSegmentsForThreshold(corners, threshold)) {
          marks.push({
            type: 'path',
            x: 0,
            y: 0,
            path: `M${formatCoord(segment[0].x)},${formatCoord(segment[0].y)} L${formatCoord(
              segment[1].x,
            )},${formatCoord(segment[1].y)}`,
            datum: {
              contourThreshold: threshold,
              contourBand: band.label,
              contourBandIndex: thresholdIndex + 1,
            },
            style: {
              fill: undefined,
              stroke: band.color,
              strokeWidth: 1.5,
              opacity: 1,
            },
          });
        }
      }
    }
  }

  return marks;
}

function buildGrid(
  data: DataRow[],
  layout: Layout,
): { cols: number[]; rows: number[]; points: Map<string, GridPoint> } | null {
  const cols = Array.from(new Set(data.map(pointIndex).filter(isFiniteNumber))).sort(
    (a, b) => a - b,
  );
  const rows = Array.from(new Set(data.map(seriesIndex).filter(isFiniteNumber))).sort(
    (a, b) => a - b,
  );
  if (cols.length < 2 || rows.length < 2) return null;

  const plotArea = squarePlotArea(layout.plotArea);
  const colPositions = new Map(
    cols.map((value, index) => [
      value,
      coordinateForIndex(index, cols.length, plotArea.x, plotArea.width),
    ]),
  );
  const rowPositions = new Map(
    rows.map((value, index) => [
      value,
      coordinateForIndex(rows.length - 1 - index, rows.length, plotArea.y, plotArea.height),
    ]),
  );

  const points = new Map<string, GridPoint>();
  for (const datum of data) {
    const col = pointIndex(datum);
    const row = seriesIndex(datum);
    const z = value(datum);
    if (!isFiniteNumber(col) || !isFiniteNumber(row) || !isFiniteNumber(z)) continue;
    const x = colPositions.get(col);
    const y = rowPositions.get(row);
    if (x === undefined || y === undefined) continue;
    points.set(key(col, row), { x, y, z, datum });
  }

  return { cols, rows, points };
}

function squarePlotArea(plotArea: Layout['plotArea']): Layout['plotArea'] {
  const side = Math.min(plotArea.width, plotArea.height);
  return {
    x: plotArea.x + (plotArea.width - side) / 2,
    y: plotArea.y + (plotArea.height - side) / 2,
    width: side,
    height: side,
  };
}

function coordinateForIndex(index: number, count: number, origin: number, size: number): number {
  if (count <= 1) return origin + size / 2;
  return origin + (index / (count - 1)) * size;
}

function cellCorners(
  grid: NonNullable<ReturnType<typeof buildGrid>>,
  x: number,
  y: number,
): [GridPoint, GridPoint, GridPoint, GridPoint] | null {
  const left = grid.cols[x];
  const right = grid.cols[x + 1];
  const bottom = grid.rows[y];
  const top = grid.rows[y + 1];
  const bottomLeft = grid.points.get(key(left, bottom));
  const bottomRight = grid.points.get(key(right, bottom));
  const topRight = grid.points.get(key(right, top));
  const topLeft = grid.points.get(key(left, top));
  return bottomLeft && bottomRight && topRight && topLeft
    ? [bottomLeft, bottomRight, topRight, topLeft]
    : null;
}

function clipCellToBand(
  corners: [GridPoint, GridPoint, GridPoint, GridPoint],
  band: ContourBandSpec,
  bandIndex: number,
  bandCount: number,
): PolygonVertex[] {
  let polygon: PolygonVertex[] = corners.map(({ x, y, z }) => ({ x, y, z }));
  if (bandIndex > 0) {
    polygon = clipPolygon(polygon, band.min, 'above');
  }
  if (bandIndex < bandCount - 1) {
    polygon = clipPolygon(polygon, band.max, 'below');
  }
  return polygon;
}

function clipPolygon(
  polygon: PolygonVertex[],
  threshold: number,
  keep: 'above' | 'below',
): PolygonVertex[] {
  if (polygon.length === 0) return [];
  const output: PolygonVertex[] = [];

  for (let i = 0; i < polygon.length; i += 1) {
    const current = polygon[i];
    const previous = polygon[(i + polygon.length - 1) % polygon.length];
    const currentInside = isInside(current.z, threshold, keep);
    const previousInside = isInside(previous.z, threshold, keep);

    if (currentInside) {
      if (!previousInside) output.push(interpolateThreshold(previous, current, threshold));
      output.push(current);
    } else if (previousInside) {
      output.push(interpolateThreshold(previous, current, threshold));
    }
  }

  return output;
}

function isInside(value: number, threshold: number, keep: 'above' | 'below'): boolean {
  return keep === 'above' ? value >= threshold - EPSILON : value <= threshold + EPSILON;
}

function interpolateThreshold(
  a: PolygonVertex,
  b: PolygonVertex,
  threshold: number,
): PolygonVertex {
  const dz = b.z - a.z;
  if (Math.abs(dz) < EPSILON) return { ...b, z: threshold };
  const t = (threshold - a.z) / dz;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: threshold,
  };
}

function contourSegmentsForThreshold(
  corners: [GridPoint, GridPoint, GridPoint, GridPoint],
  threshold: number,
): Array<[PolygonVertex, PolygonVertex]> {
  const vertices = corners.map(({ x, y, z }) => ({ x, y, z }));
  const edges: Array<[PolygonVertex, PolygonVertex]> = [
    [vertices[0], vertices[1]],
    [vertices[1], vertices[2]],
    [vertices[2], vertices[3]],
    [vertices[3], vertices[0]],
  ];
  const intersections: PolygonVertex[] = [];

  for (const [a, b] of edges) {
    const aDelta = a.z - threshold;
    const bDelta = b.z - threshold;
    if (Math.abs(aDelta) < EPSILON && Math.abs(bDelta) < EPSILON) continue;
    if (Math.abs(aDelta) < EPSILON) {
      intersections.push({ ...a, z: threshold });
    } else if (Math.abs(bDelta) < EPSILON) {
      intersections.push({ ...b, z: threshold });
    } else if ((aDelta < 0 && bDelta > 0) || (aDelta > 0 && bDelta < 0)) {
      intersections.push(interpolateThreshold(a, b, threshold));
    }
  }

  const unique = uniquePoints(intersections);
  if (unique.length < 2) return [];
  if (unique.length === 2) return [[unique[0], unique[1]]];
  return [
    [unique[0], unique[1]],
    [unique[2], unique[3] ?? unique[0]],
  ];
}

function uniquePoints(points: PolygonVertex[]): PolygonVertex[] {
  const result: PolygonVertex[] = [];
  for (const point of points) {
    if (
      !result.some(
        (existing) =>
          Math.abs(existing.x - point.x) < EPSILON && Math.abs(existing.y - point.y) < EPSILON,
      )
    ) {
      result.push(point);
    }
  }
  return result;
}

function polygonPath(polygon: PolygonVertex[]): string {
  const [first, ...rest] = polygon;
  return [
    `M${formatCoord(first.x)},${formatCoord(first.y)}`,
    ...rest.map((point) => `L${formatCoord(point.x)},${formatCoord(point.y)}`),
    'Z',
  ].join(' ');
}

function markOpacity(polygon: PolygonVertex[]): number {
  return polygon.length >= 3 ? 1 : 0;
}

function key(col: number | undefined, row: number | undefined): string {
  return `${col}:${row}`;
}

function pointIndex(datum: DataRow): number | undefined {
  return finiteField(datum, POINT_INDEX_FIELD);
}

function seriesIndex(datum: DataRow): number | undefined {
  return finiteField(datum, SERIES_INDEX_FIELD);
}

function value(datum: DataRow): number | undefined {
  return finiteField(datum, VALUE_FIELD);
}

function finiteField(datum: DataRow, field: string): number | undefined {
  const fieldValue = datum[field];
  return isFiniteNumber(fieldValue) ? fieldValue : undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatCoord(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}
