import type { PathMark } from '../../primitives/types';
import { POINT_INDEX_FIELD, SERIES_INDEX_FIELD, VALUE_FIELD } from '../../core/chart-ir/fields';
import type { ContourBandSpec, DataRow, Layout, MarkSpec, SurfaceView3DSpec } from '../spec';

type GridPoint = {
  col: number;
  row: number;
  x: number;
  y: number;
  z: number;
  datum: DataRow;
};

type WorldVertex = {
  x: number;
  y: number;
  z: number;
};

type ProjectedVertex = WorldVertex & {
  px: number;
  py: number;
  depth: number;
};

type SurfaceGrid = {
  cols: number[];
  rows: number[];
  points: Map<string, GridPoint>;
  bands: ContourBandSpec[];
  domainMin: number;
  domainMax: number;
  project: (vertex: WorldVertex) => ProjectedVertex;
};

type SurfacePath = PathMark & { __depth: number };

const DEFAULT_ROT_X = 15;
const DEFAULT_ROT_Y = 20;
const EPSILON = 1e-9;

export function generateSurface3DMarks(
  markSpec: MarkSpec,
  data: DataRow[],
  layout: Layout,
): PathMark[] {
  const grid = buildSurfaceGrid(markSpec, data, layout);
  if (!grid) return [];

  const frameMarks = generateFrameMarks(grid);
  const surfaceMarks = markSpec.contourWireframe
    ? generateWireframeMarks(grid)
    : generateFilledSurfaceMarks(grid);

  return [...frameMarks, ...surfaceMarks].map(({ __depth: _depth, ...mark }) => mark);
}

function generateFilledSurfaceMarks(grid: SurfaceGrid): SurfacePath[] {
  const marks: SurfacePath[] = [];

  for (let rowIndex = 0; rowIndex < grid.rows.length - 1; rowIndex += 1) {
    for (let colIndex = 0; colIndex < grid.cols.length - 1; colIndex += 1) {
      const corners = cellCorners(grid, colIndex, rowIndex);
      if (!corners) continue;

      for (let bandIndex = 0; bandIndex < grid.bands.length; bandIndex += 1) {
        const band = grid.bands[bandIndex];
        const polygon = clipCellToBand(corners, band, bandIndex, grid.bands.length);
        if (polygon.length < 3) continue;

        const projected = polygon.map(grid.project);
        marks.push({
          type: 'path',
          x: 0,
          y: 0,
          path: closedPath(projected),
          datum: {
            surfaceBand: band.label,
            surfaceBandIndex: bandIndex,
            surfaceMin: band.min,
            surfaceMax: band.max,
          },
          style: {
            fill: band.color,
            stroke: shadeColor(band.color, -0.18),
            strokeWidth: 0.45,
            opacity: 0.96,
          },
          __depth: averageDepth(projected),
        });
      }
    }
  }

  return marks.sort((a, b) => b.__depth - a.__depth);
}

function generateWireframeMarks(grid: SurfaceGrid): SurfacePath[] {
  const marks: SurfacePath[] = [];

  for (let rowIndex = 0; rowIndex < grid.rows.length; rowIndex += 1) {
    for (let colIndex = 0; colIndex < grid.cols.length - 1; colIndex += 1) {
      const left = pointAt(grid, colIndex, rowIndex);
      const right = pointAt(grid, colIndex + 1, rowIndex);
      if (left && right) marks.push(wireSegment(grid, left, right));
    }
  }

  for (let colIndex = 0; colIndex < grid.cols.length; colIndex += 1) {
    for (let rowIndex = 0; rowIndex < grid.rows.length - 1; rowIndex += 1) {
      const near = pointAt(grid, colIndex, rowIndex);
      const far = pointAt(grid, colIndex, rowIndex + 1);
      if (near && far) marks.push(wireSegment(grid, near, far));
    }
  }

  return marks.sort((a, b) => b.__depth - a.__depth);
}

function wireSegment(grid: SurfaceGrid, a: GridPoint, b: GridPoint): SurfacePath {
  const projectedA = grid.project(a);
  const projectedB = grid.project(b);
  const band = bandForValue(grid.bands, (a.z + b.z) / 2);
  return {
    type: 'path',
    x: 0,
    y: 0,
    path: openPath([projectedA, projectedB]),
    datum: {
      surfaceBand: band.label,
      surfaceValue: (a.z + b.z) / 2,
    },
    style: {
      stroke: band.color,
      strokeWidth: 1.25,
      opacity: 0.98,
    },
    __depth: averageDepth([projectedA, projectedB]),
  };
}

function generateFrameMarks(grid: SurfaceGrid): SurfacePath[] {
  const xMin = -1;
  const xMax = 1;
  const yMin = -1;
  const yMax = 1;
  const zFloor = grid.domainMin;
  const zCeiling = grid.domainMax;
  const floorCorners = [
    grid.project({ x: xMin, y: yMin, z: zFloor }),
    grid.project({ x: xMax, y: yMin, z: zFloor }),
    grid.project({ x: xMax, y: yMax, z: zFloor }),
    grid.project({ x: xMin, y: yMax, z: zFloor }),
  ];
  const ceilingBackLeft = grid.project({ x: xMin, y: yMax, z: zCeiling });
  const ceilingBackRight = grid.project({ x: xMax, y: yMax, z: zCeiling });
  const stroke = '#7f8790';
  const frame: SurfacePath[] = [
    {
      type: 'path',
      x: 0,
      y: 0,
      path: closedPath(floorCorners),
      datum: { surfaceFrame: 'floor' },
      style: { stroke, strokeWidth: 0.8, opacity: 0.55 },
      __depth: averageDepth(floorCorners) + 100,
    },
    {
      type: 'path',
      x: 0,
      y: 0,
      path: openPath([floorCorners[2], ceilingBackRight, ceilingBackLeft, floorCorners[3]]),
      datum: { surfaceFrame: 'backWall' },
      style: { stroke, strokeWidth: 0.8, opacity: 0.45 },
      __depth:
        averageDepth([floorCorners[2], ceilingBackRight, ceilingBackLeft, floorCorners[3]]) + 100,
    },
  ];

  const tickCount = Math.min(6, Math.max(2, grid.bands.length));
  for (let index = 1; index < tickCount; index += 1) {
    const t = index / tickCount;
    const x = lerp(xMin, xMax, t);
    const y = lerp(yMin, yMax, t);
    const floorX0 = grid.project({ x, y: yMin, z: zFloor });
    const floorX1 = grid.project({ x, y: yMax, z: zFloor });
    const floorY0 = grid.project({ x: xMin, y, z: zFloor });
    const floorY1 = grid.project({ x: xMax, y, z: zFloor });
    frame.push(frameLine([floorX0, floorX1], 'floorGridX'));
    frame.push(frameLine([floorY0, floorY1], 'floorGridY'));
  }

  return frame;
}

function frameLine(points: ProjectedVertex[], name: string): SurfacePath {
  return {
    type: 'path',
    x: 0,
    y: 0,
    path: openPath(points),
    datum: { surfaceFrame: name },
    style: { stroke: '#a3a8ad', strokeWidth: 0.55, opacity: 0.35 },
    __depth: averageDepth(points) + 100,
  };
}

function buildSurfaceGrid(markSpec: MarkSpec, data: DataRow[], layout: Layout): SurfaceGrid | null {
  const cols = Array.from(new Set(data.map(pointIndex).filter(isFiniteNumber))).sort(
    (a, b) => a - b,
  );
  const rows = Array.from(new Set(data.map(seriesIndex).filter(isFiniteNumber))).sort(
    (a, b) => a - b,
  );
  if (cols.length < 2 || rows.length < 2) return null;

  const values = data.map(value).filter(isFiniteNumber);
  if (values.length === 0) return null;

  const bands = markSpec.contourBands?.length
    ? markSpec.contourBands
    : fallbackBands(Math.min(...values), Math.max(...values));
  const domainMin = bands[0]?.min ?? Math.min(...values);
  let domainMax = bands[bands.length - 1]?.max ?? Math.max(...values);
  if (domainMax <= domainMin) domainMax = domainMin + 1;

  const normalizeZ = (z: number) => ((z - domainMin) / (domainMax - domainMin)) * 2 - 1;
  const view = normalizeView(markSpec.surfaceView3d);
  const rawProject = rawProjector(view);
  const basis = projectionBasis(cols.length, rows.length, domainMin, domainMax);
  const rawBounds = boundsForProjected(basis.map(rawProject));
  const toScreen = screenProjector(rawProject, rawBounds, layout);
  const points = new Map<string, GridPoint>();

  for (const datum of data) {
    const col = pointIndex(datum);
    const row = seriesIndex(datum);
    const z = value(datum);
    if (!isFiniteNumber(col) || !isFiniteNumber(row) || !isFiniteNumber(z)) continue;

    const colOrdinal = cols.indexOf(col);
    const rowOrdinal = rows.indexOf(row);
    if (colOrdinal < 0 || rowOrdinal < 0) continue;

    points.set(key(col, row), {
      col,
      row,
      x: coordinateForIndex(colOrdinal, cols.length),
      y: coordinateForIndex(rowOrdinal, rows.length),
      z,
      datum,
    });
  }

  return {
    cols,
    rows,
    points,
    bands,
    domainMin,
    domainMax,
    project: (vertex) => toScreen({ ...vertex, z: normalizeZ(vertex.z) }),
  };
}

function projectionBasis(
  colCount: number,
  rowCount: number,
  domainMin: number,
  domainMax: number,
): WorldVertex[] {
  const vertices: WorldVertex[] = [];
  for (let col = 0; col < colCount; col += 1) {
    for (let row = 0; row < rowCount; row += 1) {
      vertices.push({
        x: coordinateForIndex(col, colCount),
        y: coordinateForIndex(row, rowCount),
        z: -1,
      });
      vertices.push({
        x: coordinateForIndex(col, colCount),
        y: coordinateForIndex(row, rowCount),
        z: 1,
      });
    }
  }
  vertices.push(
    { x: -1, y: -1, z: -1 },
    { x: 1, y: -1, z: -1 },
    { x: 1, y: 1, z: -1 },
    { x: -1, y: 1, z: -1 },
    { x: -1, y: 1, z: 1 },
    { x: 1, y: 1, z: 1 },
  );
  return domainMax > domainMin ? vertices : vertices.map((vertex) => ({ ...vertex, z: 0 }));
}

function rawProjector(
  view: Required<Pick<SurfaceView3DSpec, 'rotX' | 'rotY' | 'depthPercent' | 'heightPercent'>> &
    Pick<SurfaceView3DSpec, 'perspective'>,
): (vertex: WorldVertex) => ProjectedVertex {
  const rotX = degreesToRadians(view.rotX);
  const rotY = degreesToRadians(view.rotY);
  const cosX = Math.cos(rotX);
  const sinX = Math.sin(rotX);
  const cosY = Math.cos(rotY);
  const sinY = Math.sin(rotY);
  const depthScale = clamp(view.depthPercent / 100, 0.35, 1.8);
  const heightScale = clamp(view.heightPercent / 100, 0.3, 1.35) * 0.72;
  const perspective = clamp(view.perspective ?? 0, 0, 100) / 450;

  return (vertex) => {
    const x = vertex.x;
    const y = vertex.y * depthScale;
    const z = vertex.z * heightScale;
    const rotatedX = x * cosY - y * sinY;
    const rotatedY = x * sinY + y * cosY;
    const pitchedY = rotatedY * cosX - z * sinX;
    const pitchedZ = rotatedY * sinX + z * cosX;
    const divisor = Math.max(0.35, 1 + pitchedY * perspective);
    return {
      ...vertex,
      px: rotatedX / divisor,
      py: -pitchedZ / divisor,
      depth: pitchedY,
    };
  };
}

function screenProjector(
  rawProject: (vertex: WorldVertex) => ProjectedVertex,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  layout: Layout,
): (vertex: WorldVertex) => ProjectedVertex {
  const width = Math.max(EPSILON, bounds.maxX - bounds.minX);
  const height = Math.max(EPSILON, bounds.maxY - bounds.minY);
  const paddingX = Math.min(36, layout.plotArea.width * 0.08);
  const paddingY = Math.min(28, layout.plotArea.height * 0.08);
  const innerWidth = Math.max(1, layout.plotArea.width - paddingX * 2);
  const innerHeight = Math.max(1, layout.plotArea.height - paddingY * 2);

  return (vertex) => {
    const projected = rawProject(vertex);
    return {
      ...projected,
      px: layout.plotArea.x + paddingX + ((projected.px - bounds.minX) / width) * innerWidth,
      py: layout.plotArea.y + paddingY + ((projected.py - bounds.minY) / height) * innerHeight,
    };
  };
}

function boundsForProjected(points: ProjectedVertex[]): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  const xs = points.map((point) => point.px).filter(isFiniteNumber);
  const ys = points.map((point) => point.py).filter(isFiniteNumber);
  return {
    minX: xs.length ? Math.min(...xs) : -1,
    maxX: xs.length ? Math.max(...xs) : 1,
    minY: ys.length ? Math.min(...ys) : -1,
    maxY: ys.length ? Math.max(...ys) : 1,
  };
}

function normalizeView(
  view: SurfaceView3DSpec | undefined,
): Required<Pick<SurfaceView3DSpec, 'rotX' | 'rotY' | 'depthPercent' | 'heightPercent'>> &
  Pick<SurfaceView3DSpec, 'perspective'> {
  const rotX = finiteNumber(view?.rotX) ?? DEFAULT_ROT_X;
  const rotY = finiteNumber(view?.rotY) ?? DEFAULT_ROT_Y;
  const depthPercent = finiteNumber(view?.depthPercent) ?? 100;
  const heightPercent = finiteNumber(view?.heightPercent) ?? 100;
  return {
    rotX: clamp(rotX, -90, 90),
    rotY: clamp(rotY, -180, 180),
    depthPercent: clamp(depthPercent, 20, 250),
    heightPercent: clamp(heightPercent, 20, 250),
    perspective: finiteNumber(view?.perspective),
  };
}

function cellCorners(
  grid: SurfaceGrid,
  colIndex: number,
  rowIndex: number,
): [GridPoint, GridPoint, GridPoint, GridPoint] | null {
  const left = grid.cols[colIndex];
  const right = grid.cols[colIndex + 1];
  const near = grid.rows[rowIndex];
  const far = grid.rows[rowIndex + 1];
  const nearLeft = grid.points.get(key(left, near));
  const nearRight = grid.points.get(key(right, near));
  const farRight = grid.points.get(key(right, far));
  const farLeft = grid.points.get(key(left, far));
  return nearLeft && nearRight && farRight && farLeft
    ? [nearLeft, nearRight, farRight, farLeft]
    : null;
}

function clipCellToBand(
  corners: [GridPoint, GridPoint, GridPoint, GridPoint],
  band: ContourBandSpec,
  bandIndex: number,
  bandCount: number,
): WorldVertex[] {
  let polygon: WorldVertex[] = corners.map(({ x, y, z }) => ({ x, y, z }));
  if (bandIndex > 0) polygon = clipPolygon(polygon, band.min, 'above');
  if (bandIndex < bandCount - 1) polygon = clipPolygon(polygon, band.max, 'below');
  return polygon;
}

function clipPolygon(
  polygon: WorldVertex[],
  threshold: number,
  keep: 'above' | 'below',
): WorldVertex[] {
  if (polygon.length === 0) return [];
  const output: WorldVertex[] = [];

  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const previous = polygon[(index + polygon.length - 1) % polygon.length];
    const currentInside = keep === 'above' ? current.z >= threshold : current.z <= threshold;
    const previousInside = keep === 'above' ? previous.z >= threshold : previous.z <= threshold;

    if (currentInside) {
      if (!previousInside) output.push(interpolateThreshold(previous, current, threshold));
      output.push(current);
    } else if (previousInside) {
      output.push(interpolateThreshold(previous, current, threshold));
    }
  }

  return output;
}

function interpolateThreshold(a: WorldVertex, b: WorldVertex, threshold: number): WorldVertex {
  const dz = b.z - a.z;
  if (Math.abs(dz) < EPSILON) return { ...b, z: threshold };
  const t = (threshold - a.z) / dz;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: threshold,
  };
}

function pointAt(grid: SurfaceGrid, colIndex: number, rowIndex: number): GridPoint | undefined {
  return grid.points.get(key(grid.cols[colIndex], grid.rows[rowIndex]));
}

function fallbackBands(minValue: number, maxValue: number): ContourBandSpec[] {
  const min = Number.isFinite(minValue) ? minValue : 0;
  const max = Number.isFinite(maxValue) && maxValue > min ? maxValue : min + 1;
  return [{ min, max, label: `${formatValue(min)}-${formatValue(max)}`, color: '#4f81bd' }];
}

function bandForValue(bands: ContourBandSpec[], value: number): ContourBandSpec {
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    if (index === bands.length - 1) {
      if (value >= band.min - EPSILON && value <= band.max + EPSILON) return band;
    } else if (value >= band.min - EPSILON && value < band.max + EPSILON) {
      return band;
    }
  }
  return value < bands[0].min ? bands[0] : bands[bands.length - 1];
}

function coordinateForIndex(index: number, count: number): number {
  if (count <= 1) return 0;
  return (index / (count - 1)) * 2 - 1;
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

function key(col: number | undefined, row: number | undefined): string {
  return `${col}:${row}`;
}

function closedPath(points: ProjectedVertex[]): string {
  return `${openPath(points)} Z`;
}

function openPath(points: ProjectedVertex[]): string {
  const [first, ...rest] = points;
  return [
    `M${formatCoord(first.px)},${formatCoord(first.py)}`,
    ...rest.map((point) => `L${formatCoord(point.px)},${formatCoord(point.py)}`),
  ].join(' ');
}

function averageDepth(points: ProjectedVertex[]): number {
  if (points.length === 0) return 0;
  return points.reduce((sum, point) => sum + point.depth, 0) / points.length;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function finiteNumber(value: unknown): number | undefined {
  return isFiniteNumber(value) ? value : undefined;
}

function formatCoord(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function formatValue(value: number): string {
  return value.toFixed(2);
}

function shadeColor(color: string, amount: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return color;
  const channel = (offset: number) => {
    const value = Number.parseInt(color.slice(offset, offset + 2), 16);
    return clamp(Math.round(value + amount * 255), 0, 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}
