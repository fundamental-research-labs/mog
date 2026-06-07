import {
  POINT_INDEX_FIELD,
  SERIES_INDEX_FIELD,
  SOURCE_SERIES_INDEX_FIELD,
  SOURCE_SERIES_KEY_FIELD,
  VALUE_FIELD,
} from '../core/chart-ir/fields';
import type { AnyMark } from '../primitives/types';
import type { DataRow, Layout, MarkSpec, MarkType } from './spec';
import { depthOptionsFor3DPlot } from './marks/plot-3d';
import type {
  ProjectionBoundsTrace,
  ProjectionOccupancyTrace,
  SurfaceApproximationBandTrace,
  SurfaceApproximationContractKind,
  SurfaceApproximationDensityTrace,
  SurfaceApproximationLayerTrace,
  SurfaceApproximationMarkCountsTrace,
  SurfaceApproximationMode,
  SurfaceApproximationProjectionTrace,
  SurfaceApproximationSourceBandFormatTrace,
  SurfaceApproximationTrace,
  ThreeDApproximationDepthClampStatus,
  ThreeDApproximationDepthSource,
  ThreeDApproximationFaceCountsTrace,
  ThreeDApproximationFaceRole,
  ThreeDApproximationLayerTrace,
  ThreeDApproximationMarkType,
  ThreeDApproximationProjectionTrace,
  ThreeDApproximationTrace,
  ThreeDBarShape,
} from './types';

const THREE_D_MARK_TYPES = new Set<MarkType>(['bar3d', 'line3d', 'area3d', 'arc3d']);
const SURFACE_MARK_TYPES = new Set<MarkType>(['surface3d', 'contour']);
const PROJECTION_OCCUPANCY_COLUMNS = 4;
const PROJECTION_OCCUPANCY_ROWS = 4;
const BAR_SHAPES = new Set<string>([
  'box',
  'cylinder',
  'cone',
  'coneToMax',
  'pyramid',
  'pyramidToMax',
]);

export function collectThreeDApproximationLayerTrace(input: {
  layerIndex: number;
  markType: MarkType;
  markSpec: MarkSpec;
  data: DataRow[];
  marks: AnyMark[];
  layout: Layout;
}): ThreeDApproximationLayerTrace | undefined {
  if (!THREE_D_MARK_TYPES.has(input.markType)) return undefined;

  const depthOptions = depthOptionsFor3DPlot(input.markSpec, input.layout);
  const faceCounts = countThreeDFaces(input.marks);
  const projection = threeDProjectionTrace(input.marks, input.layout);
  const renderablePointCount = input.data.filter(
    (datum) => finiteField(datum, VALUE_FIELD) !== undefined,
  ).length;

  return {
    layerIndex: input.layerIndex,
    renderer: 'pathDepthApproximation',
    markType: input.markType as ThreeDApproximationMarkType,
    markFamily: input.markSpec.chart3d?.family,
    sourceFamily: input.markSpec.chart3d?.family,
    renderedMarkType: input.markType as ThreeDApproximationMarkType,
    view3d: input.markSpec.chart3d?.view3d,
    ...(input.markSpec.chart3d?.gapDepth !== undefined
      ? { gapDepth: input.markSpec.chart3d.gapDepth }
      : {}),
    depthSource: threeDDepthSource(input.markSpec),
    depthVector: {
      x: depthOptions.depthX ?? 0,
      y: depthOptions.depthY ?? 0,
    },
    depthClampStatus: threeDDepthClampStatus(input.markSpec),
    ...(input.markType === 'bar3d'
      ? { barShapes: barShapesTrace(input.markSpec, input.data) }
      : {}),
    sourceSeriesCount: distinctFiniteNumbers(input.data, SERIES_INDEX_FIELD).length,
    sourcePointCount: input.data.length,
    renderablePointCount,
    markCount: input.marks.length,
    faceCounts,
    ...(projection ? { projection } : {}),
    geometryStatus: 'approximate',
  };
}

export function buildThreeDApproximationTrace(
  layers: Array<ThreeDApproximationLayerTrace | undefined>,
): ThreeDApproximationTrace | undefined {
  const present = layers.filter((layer): layer is ThreeDApproximationLayerTrace => Boolean(layer));
  if (present.length === 0) return undefined;
  const projection = mergeThreeDProjectionTraces(present.map((layer) => layer.projection));

  return {
    schemaVersion: 1,
    renderer: 'pathDepthApproximation',
    layers: present,
    markCount: present.reduce((sum, layer) => sum + layer.markCount, 0),
    faceCounts: present.reduce(
      (counts, layer) => mergeFaceCounts(counts, layer.faceCounts),
      emptyFaceCounts(),
    ),
    ...(projection ? { projection } : {}),
    geometryStatus: present.some((layer) => layer.geometryStatus === 'traceMissing')
      ? 'traceMissing'
      : 'approximate',
  };
}

export function collectSurfaceApproximationLayerTrace(input: {
  layerIndex: number;
  markType: MarkType;
  markSpec: MarkSpec;
  data: DataRow[];
  marks: AnyMark[];
  layout: Layout;
}): SurfaceApproximationLayerTrace | undefined {
  if (!SURFACE_MARK_TYPES.has(input.markType)) return undefined;

  const grid = surfaceGridTrace(input.data);
  const bands = surfaceBandsTrace(input.markSpec, input.data);
  const markCounts = surfaceMarkCounts(input.marks);
  const mode = input.markType === 'contour' ? 'contour' : 'surface3d';
  const wireframe = input.markSpec.contourWireframe === true;
  const contractKind = surfaceApproximationContractKind(mode, wireframe);
  const density = surfaceDensityTrace(input.data, markCounts, bands.count);
  const projection = surfaceProjectionTrace({
    mode,
    marks: input.marks,
    layout: input.layout,
  });

  return {
    layerIndex: input.layerIndex,
    renderer: mode === 'contour' ? 'mogContourApproximation' : 'mogSurfaceApproximation',
    mode,
    contractKind,
    markType: input.markType as 'surface3d' | 'contour',
    topView: mode === 'contour',
    wireframe,
    ...(input.markSpec.surfaceView3d ? { view3d: input.markSpec.surfaceView3d } : {}),
    grid,
    valueDomain: surfaceValueDomain(input.data),
    bands,
    markCounts,
    plotAreaPolicy: mode === 'contour' ? 'squareTopView' : 'normalizedProjectedCube',
    density,
    ...(projection ? { projection } : {}),
    geometryStatus: 'approximate',
  };
}

export function buildSurfaceApproximationTrace(
  layers: Array<SurfaceApproximationLayerTrace | undefined>,
): SurfaceApproximationTrace | undefined {
  const present = layers.filter((layer): layer is SurfaceApproximationLayerTrace => Boolean(layer));
  if (present.length === 0) return undefined;
  const first = present[0];
  if (!first) return undefined;
  const projection = mergeSurfaceProjectionTraces(present.map((layer) => layer.projection));

  return {
    schemaVersion: 1,
    renderer: first.renderer,
    mode: first.mode,
    contractKind: first.contractKind,
    layers: present,
    grid: first.grid,
    valueDomain: first.valueDomain,
    bands: first.bands,
    markCounts: present.reduce(
      (counts, layer) => mergeSurfaceMarkCounts(counts, layer.markCounts),
      emptySurfaceMarkCounts(),
    ),
    plotAreaPolicy: first.plotAreaPolicy,
    ...(first.density ? { density: first.density } : {}),
    ...(projection ? { projection } : {}),
    geometryStatus: present.some((layer) => layer.geometryStatus === 'traceMissing')
      ? 'traceMissing'
      : 'approximate',
  };
}

function surfaceApproximationContractKind(
  mode: SurfaceApproximationMode,
  wireframe: boolean,
): SurfaceApproximationContractKind {
  if (mode === 'contour') {
    return wireframe ? 'contourWireframe' : 'contourFilled';
  }
  return wireframe ? 'surface3dWireframe' : 'surface3dFilled';
}

function threeDDepthSource(markSpec: MarkSpec): ThreeDApproximationDepthSource {
  if (finiteNumber(markSpec.chart3d?.view3d?.depthPercent) !== undefined) {
    return 'view3dDepthPercent';
  }
  if (finiteNumber(markSpec.chart3d?.gapDepth) !== undefined) return 'gapDepth';
  return 'default';
}

function threeDDepthClampStatus(markSpec: MarkSpec): ThreeDApproximationDepthClampStatus {
  const sourceDepth =
    finiteNumber(markSpec.chart3d?.view3d?.depthPercent) ??
    finiteNumber(markSpec.chart3d?.gapDepth) ??
    100;
  if (sourceDepth < 20) return 'clampedMin';
  if (sourceDepth > 250) return 'clampedMax';
  return 'withinRange';
}

function barShapesTrace(markSpec: MarkSpec, data: DataRow[]) {
  const chartShape = barShape(markSpec.chart3d?.barShape) ?? 'box';
  const seriesShapes = distinctFiniteNumbers(data, SERIES_INDEX_FIELD).map((seriesIndex) => {
    const datum = data.find((row) => finiteField(row, SERIES_INDEX_FIELD) === seriesIndex);
    return {
      seriesIndex,
      ...(finiteField(datum, SOURCE_SERIES_INDEX_FIELD) !== undefined
        ? { sourceSeriesIndex: finiteField(datum, SOURCE_SERIES_INDEX_FIELD) }
        : {}),
      ...(stringField(datum, SOURCE_SERIES_KEY_FIELD)
        ? { sourceSeriesKey: stringField(datum, SOURCE_SERIES_KEY_FIELD) }
        : {}),
      shape: chartShape,
    };
  });

  return {
    chartShape,
    ...(seriesShapes.length > 0 ? { seriesShapes } : {}),
    distinctShapes: [chartShape],
  };
}

function countThreeDFaces(marks: AnyMark[]): ThreeDApproximationFaceCountsTrace {
  const counts = emptyFaceCounts();
  for (const mark of marks) {
    const face = threeDFace(mark);
    if (face) counts[face] += 1;
  }
  return counts;
}

function threeDFace(mark: AnyMark): ThreeDApproximationFaceRole | undefined {
  const datum = markDatum(mark);
  const chart3d = datum?.chart3d;
  if (!chart3d || typeof chart3d !== 'object' || Array.isArray(chart3d)) return undefined;
  const face = (chart3d as Record<string, unknown>).face;
  return isThreeDFace(face) ? face : undefined;
}

function isThreeDFace(value: unknown): value is ThreeDApproximationFaceRole {
  return (
    value === 'front' ||
    value === 'back' ||
    value === 'top' ||
    value === 'side' ||
    value === 'connector' ||
    value === 'outer' ||
    value === 'inner'
  );
}

function emptyFaceCounts(): ThreeDApproximationFaceCountsTrace {
  return {
    front: 0,
    back: 0,
    top: 0,
    side: 0,
    connector: 0,
    outer: 0,
    inner: 0,
  };
}

function mergeFaceCounts(
  left: ThreeDApproximationFaceCountsTrace,
  right: ThreeDApproximationFaceCountsTrace,
): ThreeDApproximationFaceCountsTrace {
  return {
    front: left.front + right.front,
    back: left.back + right.back,
    top: left.top + right.top,
    side: left.side + right.side,
    connector: left.connector + right.connector,
    outer: left.outer + right.outer,
    inner: left.inner + right.inner,
  };
}

function threeDProjectionTrace(
  marks: AnyMark[],
  layout: Layout,
): ThreeDApproximationProjectionTrace | undefined {
  const faceMarks = marks.filter((mark) => threeDFace(mark));
  if (faceMarks.length === 0) return undefined;

  const frontFaceMarks = faceMarks.filter((mark) => threeDFace(mark) === 'front');
  const depthFaceMarks = faceMarks.filter((mark) => threeDFace(mark) !== 'front');
  const allFaceBounds = projectionBoundsForMarks(faceMarks, layout);
  const frontFaceBounds = projectionBoundsForMarks(frontFaceMarks, layout);
  const depthFaceBounds = projectionBoundsForMarks(depthFaceMarks, layout);
  const faceFamilyOccupancy = projectionOccupancyForMarks(faceMarks, layout, 'generatedMarkBounds');

  return {
    projectionAuthority: 'generatedApproximationTrace' as const,
    ...(allFaceBounds ? { allFaceBounds } : {}),
    ...(frontFaceBounds ? { frontFaceBounds } : {}),
    ...(depthFaceBounds ? { depthFaceBounds } : {}),
    ...(faceFamilyOccupancy ? { faceFamilyOccupancy } : {}),
  };
}

function mergeThreeDProjectionTraces(
  traces: Array<ThreeDApproximationLayerTrace['projection'] | undefined>,
): ThreeDApproximationLayerTrace['projection'] | undefined {
  const present = traces.filter(
    (trace): trace is NonNullable<ThreeDApproximationLayerTrace['projection']> => Boolean(trace),
  );
  if (present.length === 0) return undefined;
  const allFaceBounds = mergeProjectionBounds(present.map((trace) => trace.allFaceBounds));
  const frontFaceBounds = mergeProjectionBounds(present.map((trace) => trace.frontFaceBounds));
  const depthFaceBounds = mergeProjectionBounds(present.map((trace) => trace.depthFaceBounds));
  const faceFamilyOccupancy = mergeProjectionOccupancies(
    present.map((trace) => trace.faceFamilyOccupancy),
  );
  return {
    projectionAuthority: 'generatedApproximationTrace',
    ...(allFaceBounds ? { allFaceBounds } : {}),
    ...(frontFaceBounds ? { frontFaceBounds } : {}),
    ...(depthFaceBounds ? { depthFaceBounds } : {}),
    ...(faceFamilyOccupancy ? { faceFamilyOccupancy } : {}),
  };
}

function surfaceDensityTrace(
  data: DataRow[],
  markCounts: SurfaceApproximationMarkCountsTrace,
  bandCount: number,
): SurfaceApproximationDensityTrace {
  const metrics = surfaceGridMetrics(data);
  return {
    completeCellCount: metrics.completeCellCount,
    finiteCellRatio: ratio(metrics.finiteValueCount, metrics.totalGridPointCount),
    missingCellRatio: ratio(metrics.missingCellCount, metrics.totalGridPointCount),
    filledPatchesPerCompleteCell: ratio(markCounts.filledPatches, metrics.completeCellCount),
    isolineSegmentsPerCompleteCell: ratio(markCounts.isolineSegments, metrics.completeCellCount),
    ...(metrics.validGridEdgeCount > 0
      ? { wireSegmentsPerValidEdge: ratio(markCounts.wireSegments, metrics.validGridEdgeCount) }
      : {}),
    expectedWireSegments: metrics.validGridEdgeCount,
    validGridEdgeCount: metrics.validGridEdgeCount,
    thresholdCount: Math.max(0, bandCount - 1),
  };
}

function surfaceProjectionTrace(input: {
  mode: SurfaceApproximationMode;
  marks: AnyMark[];
  layout: Layout;
}): SurfaceApproximationProjectionTrace | undefined {
  const dataMarks = input.marks.filter(isSurfaceDataMark);
  const frameMarks = input.marks.filter(isSurfaceFrameMark);
  const dataMarkBounds = projectionBoundsForMarks(dataMarks, input.layout);
  const frameBounds = projectionBoundsForMarks(frameMarks, input.layout);
  const topViewPlotBounds =
    input.mode === 'contour'
      ? normalizePixelBounds(squarePlotArea(input.layout.plotArea), input.layout.plotArea)
      : undefined;
  const dataOccupancy = projectionOccupancyForMarks(dataMarks, input.layout, 'generatedPathBounds');

  if (!dataMarkBounds && !frameBounds && !topViewPlotBounds && !dataOccupancy) {
    return undefined;
  }
  return {
    projectionAuthority: 'generatedApproximationTrace',
    ...(dataMarkBounds ? { dataMarkBounds } : {}),
    ...(input.mode === 'surface3d' && frameBounds ? { frameBounds } : {}),
    ...(topViewPlotBounds ? { topViewPlotBounds } : {}),
    ...(dataOccupancy ? { dataOccupancy } : {}),
  };
}

function mergeSurfaceProjectionTraces(
  traces: Array<SurfaceApproximationLayerTrace['projection'] | undefined>,
): SurfaceApproximationProjectionTrace | undefined {
  const present = traces.filter((trace): trace is SurfaceApproximationProjectionTrace =>
    Boolean(trace),
  );
  if (present.length === 0) return undefined;
  const dataMarkBounds = mergeProjectionBounds(present.map((trace) => trace.dataMarkBounds));
  const frameBounds = mergeProjectionBounds(present.map((trace) => trace.frameBounds));
  const topViewPlotBounds = mergeProjectionBounds(present.map((trace) => trace.topViewPlotBounds));
  const dataOccupancy = mergeProjectionOccupancies(present.map((trace) => trace.dataOccupancy));
  return {
    projectionAuthority: 'generatedApproximationTrace',
    ...(dataMarkBounds ? { dataMarkBounds } : {}),
    ...(frameBounds ? { frameBounds } : {}),
    ...(topViewPlotBounds ? { topViewPlotBounds } : {}),
    ...(dataOccupancy ? { dataOccupancy } : {}),
  };
}

type PixelBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type ProjectionSpaceRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function projectionBoundsForMarks(
  marks: AnyMark[],
  layout: Layout,
): ProjectionBoundsTrace | undefined {
  const bounds = unionPixelBounds(marks.map(markBounds).filter(isPixelBounds));
  return bounds ? normalizePixelBounds(bounds, layout.plotArea) : undefined;
}

function projectionOccupancyForMarks(
  marks: AnyMark[],
  layout: Layout,
  source: ProjectionOccupancyTrace['source'],
): ProjectionOccupancyTrace | undefined {
  const normalizedBounds = marks
    .map(markBounds)
    .filter(isPixelBounds)
    .map((bounds) => normalizePixelBounds(bounds, layout.plotArea))
    .filter((bounds): bounds is ProjectionBoundsTrace => Boolean(bounds));
  if (normalizedBounds.length === 0) return undefined;

  const columns = PROJECTION_OCCUPANCY_COLUMNS;
  const rows = PROJECTION_OCCUPANCY_ROWS;
  const cellWidth = 1 / columns;
  const cellHeight = 1 / rows;
  const cellArea = cellWidth * cellHeight;
  const densities = Array.from({ length: columns * rows }, () => 0);

  for (const bounds of normalizedBounds) {
    for (let row = 0; row < rows; row += 1) {
      const cellTop = row * cellHeight;
      const cellBottom = cellTop + cellHeight;
      for (let column = 0; column < columns; column += 1) {
        const cellLeft = column * cellWidth;
        const cellRight = cellLeft + cellWidth;
        const overlapWidth = Math.max(
          0,
          Math.min(bounds.right, cellRight) - Math.max(bounds.left, cellLeft),
        );
        const overlapHeight = Math.max(
          0,
          Math.min(bounds.bottom, cellBottom) - Math.max(bounds.top, cellTop),
        );
        densities[row * columns + column] += (overlapWidth * overlapHeight) / cellArea;
      }
    }
  }

  return {
    columns,
    rows,
    densities: densities.map((value) => roundTraceNumber(Math.min(1, value))),
    source,
  };
}

function mergeProjectionBounds(
  boundsList: Array<ProjectionBoundsTrace | undefined>,
): ProjectionBoundsTrace | undefined {
  const present = boundsList.filter((bounds): bounds is ProjectionBoundsTrace => Boolean(bounds));
  const first = present[0];
  if (!first) return undefined;
  const coordinateSpace = first.coordinateSpace;
  const left = Math.min(...present.map((bounds) => bounds.left));
  const top = Math.min(...present.map((bounds) => bounds.top));
  const right = Math.max(...present.map((bounds) => bounds.right));
  const bottom = Math.max(...present.map((bounds) => bounds.bottom));
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  if (width <= 0 || height <= 0) return undefined;
  return {
    left: roundTraceNumber(left),
    top: roundTraceNumber(top),
    right: roundTraceNumber(right),
    bottom: roundTraceNumber(bottom),
    width: roundTraceNumber(width),
    height: roundTraceNumber(height),
    centerX: roundTraceNumber(left + width / 2),
    centerY: roundTraceNumber(top + height / 2),
    areaFraction: roundTraceNumber(width * height),
    coordinateSpace,
  };
}

function mergeProjectionOccupancies(
  occupancies: Array<ProjectionOccupancyTrace | undefined>,
): ProjectionOccupancyTrace | undefined {
  const present = occupancies.filter((occupancy): occupancy is ProjectionOccupancyTrace =>
    Boolean(occupancy),
  );
  const first = present[0];
  if (!first) return undefined;
  const compatible = present.filter(
    (occupancy) =>
      occupancy.columns === first.columns &&
      occupancy.rows === first.rows &&
      occupancy.densities.length === first.densities.length,
  );
  return {
    columns: first.columns,
    rows: first.rows,
    densities: first.densities.map((_, index) =>
      roundTraceNumber(Math.max(...compatible.map((occupancy) => occupancy.densities[index] ?? 0))),
    ),
    source: first.source,
  };
}

function markBounds(mark: AnyMark): PixelBounds | undefined {
  switch (mark.type) {
    case 'path':
      return pathBounds(mark.path, mark.x, mark.y);
    case 'rect':
      return pixelBoundsFromEdges(mark.x, mark.y, mark.x + mark.width, mark.y + mark.height);
    case 'arc':
      return pixelBoundsFromEdges(
        mark.x - mark.outerRadius,
        mark.y - mark.outerRadius,
        mark.x + mark.outerRadius,
        mark.y + mark.outerRadius,
      );
    case 'symbol': {
      const radius = Math.sqrt(Math.max(0, mark.size)) / 2;
      return pixelBoundsFromEdges(
        mark.x - radius,
        mark.y - radius,
        mark.x + radius,
        mark.y + radius,
      );
    }
    default:
      return undefined;
  }
}

function pathBounds(path: string, offsetX: number, offsetY: number): PixelBounds | undefined {
  const values = path.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
  if (values.length < 2) return undefined;

  const points: Array<{ x: number; y: number }> = [];
  for (let index = 0; index + 1 < values.length; index += 2) {
    const rawX = values[index];
    const rawY = values[index + 1];
    if (rawX === undefined || rawY === undefined) continue;
    const x = rawX + offsetX;
    const y = rawY + offsetY;
    if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
  }
  if (points.length === 0) return undefined;
  return pixelBoundsFromEdges(
    Math.min(...points.map((point) => point.x)),
    Math.min(...points.map((point) => point.y)),
    Math.max(...points.map((point) => point.x)),
    Math.max(...points.map((point) => point.y)),
  );
}

function pixelBoundsFromEdges(
  left: number,
  top: number,
  right: number,
  bottom: number,
): PixelBounds | undefined {
  if (![left, top, right, bottom].every(Number.isFinite)) return undefined;
  const normalizedLeft = Math.min(left, right);
  const normalizedRight = Math.max(left, right);
  const normalizedTop = Math.min(top, bottom);
  const normalizedBottom = Math.max(top, bottom);
  if (normalizedRight <= normalizedLeft || normalizedBottom <= normalizedTop) return undefined;
  return {
    left: normalizedLeft,
    top: normalizedTop,
    right: normalizedRight,
    bottom: normalizedBottom,
  };
}

function unionPixelBounds(boundsList: PixelBounds[]): PixelBounds | undefined {
  if (boundsList.length === 0) return undefined;
  return {
    left: Math.min(...boundsList.map((bounds) => bounds.left)),
    top: Math.min(...boundsList.map((bounds) => bounds.top)),
    right: Math.max(...boundsList.map((bounds) => bounds.right)),
    bottom: Math.max(...boundsList.map((bounds) => bounds.bottom)),
  };
}

function normalizePixelBounds(
  bounds: PixelBounds,
  rect: ProjectionSpaceRect,
): ProjectionBoundsTrace | undefined {
  if (rect.width <= 0 || rect.height <= 0) return undefined;
  const left = clamp01((bounds.left - rect.x) / rect.width);
  const top = clamp01((bounds.top - rect.y) / rect.height);
  const right = clamp01((bounds.right - rect.x) / rect.width);
  const bottom = clamp01((bounds.bottom - rect.y) / rect.height);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  if (width <= 0 || height <= 0) return undefined;
  return {
    left: roundTraceNumber(left),
    top: roundTraceNumber(top),
    right: roundTraceNumber(right),
    bottom: roundTraceNumber(bottom),
    width: roundTraceNumber(width),
    height: roundTraceNumber(height),
    centerX: roundTraceNumber(left + width / 2),
    centerY: roundTraceNumber(top + height / 2),
    areaFraction: roundTraceNumber(width * height),
    coordinateSpace: 'plotAreaNormalized',
  };
}

function squarePlotArea(plotArea: ProjectionSpaceRect): PixelBounds {
  const side = Math.min(plotArea.width, plotArea.height);
  const left = plotArea.x + (plotArea.width - side) / 2;
  const top = plotArea.y + (plotArea.height - side) / 2;
  return {
    left,
    top,
    right: left + side,
    bottom: top + side,
  };
}

function isPixelBounds(bounds: PixelBounds | undefined): bounds is PixelBounds {
  return Boolean(bounds);
}

function isSurfaceFrameMark(mark: AnyMark): boolean {
  return typeof markDatum(mark)?.surfaceFrame === 'string';
}

function isSurfaceDataMark(mark: AnyMark): boolean {
  const datum = markDatum(mark);
  if (!datum || typeof datum.surfaceFrame === 'string') return false;
  return (
    typeof datum.surfaceValue === 'number' ||
    typeof datum.surfaceBandIndex === 'number' ||
    typeof datum.contourThreshold === 'number' ||
    typeof datum.contourBand === 'string'
  );
}

function surfaceGridMetrics(data: DataRow[]) {
  const cols = distinctFiniteNumbers(data, POINT_INDEX_FIELD);
  const rows = distinctFiniteNumbers(data, SERIES_INDEX_FIELD);
  const points = new Set<string>();
  for (const datum of data) {
    const col = finiteField(datum, POINT_INDEX_FIELD);
    const row = finiteField(datum, SERIES_INDEX_FIELD);
    const z = finiteField(datum, VALUE_FIELD);
    if (col === undefined || row === undefined || z === undefined) continue;
    points.add(key(col, row));
  }

  let completeCellCount = 0;
  for (let rowIndex = 0; rowIndex < rows.length - 1; rowIndex += 1) {
    for (let colIndex = 0; colIndex < cols.length - 1; colIndex += 1) {
      const left = cols[colIndex];
      const right = cols[colIndex + 1];
      const bottom = rows[rowIndex];
      const top = rows[rowIndex + 1];
      if (
        points.has(key(left, bottom)) &&
        points.has(key(right, bottom)) &&
        points.has(key(right, top)) &&
        points.has(key(left, top))
      ) {
        completeCellCount += 1;
      }
    }
  }

  let validGridEdgeCount = 0;
  for (const row of rows) {
    for (let colIndex = 0; colIndex < cols.length - 1; colIndex += 1) {
      if (points.has(key(cols[colIndex], row)) && points.has(key(cols[colIndex + 1], row))) {
        validGridEdgeCount += 1;
      }
    }
  }
  for (const col of cols) {
    for (let rowIndex = 0; rowIndex < rows.length - 1; rowIndex += 1) {
      if (points.has(key(col, rows[rowIndex])) && points.has(key(col, rows[rowIndex + 1]))) {
        validGridEdgeCount += 1;
      }
    }
  }

  const totalGridPointCount = rows.length * cols.length;
  return {
    totalGridPointCount,
    finiteValueCount: points.size,
    missingCellCount: Math.max(0, totalGridPointCount - points.size),
    completeCellCount,
    validGridEdgeCount,
  };
}

function surfaceGridTrace(data: DataRow[]) {
  const cols = distinctFiniteNumbers(data, POINT_INDEX_FIELD);
  const rows = distinctFiniteNumbers(data, SERIES_INDEX_FIELD);
  const points = new Set<string>();
  for (const datum of data) {
    const col = finiteField(datum, POINT_INDEX_FIELD);
    const row = finiteField(datum, SERIES_INDEX_FIELD);
    const z = finiteField(datum, VALUE_FIELD);
    if (col === undefined || row === undefined || z === undefined) continue;
    points.add(`${col}:${row}`);
  }

  const cellCount = rows.length * cols.length;
  return {
    rows: rows.length,
    columns: cols.length,
    finiteValueCount: points.size,
    missingCellCount: Math.max(0, cellCount - points.size),
    source: rows.length >= 2 && cols.length >= 2 ? 'seriesPointIndexGrid' : 'unavailable',
  } as const;
}

function surfaceValueDomain(data: DataRow[]) {
  const values = data
    .map((datum) => finiteField(datum, VALUE_FIELD))
    .filter((value): value is number => value !== undefined);
  if (values.length === 0) return {};
  return {
    dataMin: Math.min(...values),
    dataMax: Math.max(...values),
  };
}

function surfaceBandsTrace(markSpec: MarkSpec, data: DataRow[]) {
  const entries = markSpec.contourBands?.length
    ? markSpec.contourBands.map(
        (band, index): SurfaceApproximationBandTrace => ({
          index,
          min: band.min,
          max: band.max,
          label: band.label,
          color: band.color,
        }),
      )
    : fallbackSurfaceBands(data);
  const sourceBandFormats = sourceSurfaceBandFormatsTrace(markSpec);

  return {
    count: entries.length,
    entries,
    legendOrder: entries.map((entry) => entry.label),
    authority: markSpec.contourBands?.length
      ? 'generatedFromAxisAndData'
      : sourceBandFormats.length > 0
        ? 'sourceBandFmtPreservedOnly'
        : 'fallback',
    ...(sourceBandFormats.length > 0 ? { sourceBandFormats } : {}),
  } as const;
}

function sourceSurfaceBandFormatsTrace(
  markSpec: MarkSpec,
): SurfaceApproximationSourceBandFormatTrace[] {
  return (markSpec.sourceSurfaceBandFormats ?? []).flatMap((format) => {
    const index = finiteNumber(format.index);
    if (index === undefined) return [];
    const fillColor =
      typeof format.fillColor === 'string' && format.fillColor.length > 0
        ? format.fillColor
        : undefined;
    return [
      {
        index,
        ...(fillColor ? { fillColor } : {}),
        hasFormatting: format.hasFormatting === true || fillColor !== undefined,
        ...(format.source === 'ooxmlBandFmt' ? { source: 'ooxmlBandFmt' as const } : {}),
      },
    ];
  });
}

function fallbackSurfaceBands(data: DataRow[]): SurfaceApproximationBandTrace[] {
  const domain = surfaceValueDomain(data);
  const min = domain.dataMin ?? 0;
  const max = domain.dataMax !== undefined && domain.dataMax > min ? domain.dataMax : min + 1;
  return [
    {
      index: 0,
      min,
      max,
      label: `${formatBandValue(min)}-${formatBandValue(max)}`,
      color: '#4f81bd',
    },
  ];
}

function surfaceMarkCounts(marks: AnyMark[]): SurfaceApproximationMarkCountsTrace {
  const counts = emptySurfaceMarkCounts();
  for (const mark of marks) {
    const datum = markDatum(mark);
    if (!datum) continue;
    if (typeof datum.surfaceFrame === 'string') {
      counts.frameMarks += 1;
    } else if (typeof datum.surfaceValue === 'number') {
      counts.wireSegments += 1;
      counts.totalDataMarks += 1;
    } else if (typeof datum.surfaceBandIndex === 'number') {
      counts.filledPatches += 1;
      counts.totalDataMarks += 1;
    } else if (typeof datum.contourThreshold === 'number') {
      counts.isolineSegments += 1;
      counts.totalDataMarks += 1;
    } else if (typeof datum.contourBand === 'string') {
      counts.filledPatches += 1;
      counts.totalDataMarks += 1;
    }
  }
  return counts;
}

function emptySurfaceMarkCounts(): SurfaceApproximationMarkCountsTrace {
  return {
    filledPatches: 0,
    isolineSegments: 0,
    wireSegments: 0,
    frameMarks: 0,
    totalDataMarks: 0,
  };
}

function mergeSurfaceMarkCounts(
  left: SurfaceApproximationMarkCountsTrace,
  right: SurfaceApproximationMarkCountsTrace,
): SurfaceApproximationMarkCountsTrace {
  return {
    filledPatches: left.filledPatches + right.filledPatches,
    isolineSegments: left.isolineSegments + right.isolineSegments,
    wireSegments: left.wireSegments + right.wireSegments,
    frameMarks: left.frameMarks + right.frameMarks,
    totalDataMarks: left.totalDataMarks + right.totalDataMarks,
  };
}

function distinctFiniteNumbers(data: DataRow[], field: string): number[] {
  return Array.from(
    new Set(
      data
        .map((datum) => finiteField(datum, field))
        .filter((value): value is number => value !== undefined),
    ),
  ).sort((a, b) => a - b);
}

function finiteField(datum: DataRow | undefined, field: string): number | undefined {
  if (!datum) return undefined;
  return finiteNumber(datum[field]);
}

function stringField(datum: DataRow | undefined, field: string): string | undefined {
  if (!datum) return undefined;
  const value = datum[field];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function key(col: number | undefined, row: number | undefined): string {
  return `${col}:${row}`;
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? roundTraceNumber(numerator / denominator) : 0;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function roundTraceNumber(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function barShape(value: unknown): ThreeDBarShape | undefined {
  return typeof value === 'string' && BAR_SHAPES.has(value) ? (value as ThreeDBarShape) : undefined;
}

function markDatum(mark: AnyMark): Record<string, unknown> | undefined {
  const datum = mark.datum;
  return datum && typeof datum === 'object' && !Array.isArray(datum)
    ? (datum as Record<string, unknown>)
    : undefined;
}

function formatBandValue(value: number): string {
  return value.toFixed(2);
}
