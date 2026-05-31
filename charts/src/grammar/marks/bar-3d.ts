import type { PathMark, RectMark } from '../../primitives/types';
import type { ScaleMap } from '../encoding-resolver';
import { resolveEncodings } from '../encoding-resolver';
import type { ConfigSpec, DataRow, EncodingSpec, Layout, MarkSpec } from '../spec';
import { generateBarMarks } from './bar';
import {
  depthOptionsFor3DPlot,
  format3DCoord,
  polygonPath,
  shadeColor,
  with3DMetadata,
} from './plot-3d';

type Point = {
  x: number;
  y: number;
};

type Depth = {
  x: number;
  y: number;
};

type FaceSpec = {
  points: Point[];
  face: 'front' | 'top' | 'side' | 'back';
  shade: number;
};

type PathFaceSpec = {
  path: string;
  face: FaceSpec['face'];
  shade: number;
};

type PyramidExtent = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

/**
 * Generate projected 3-D bar/column marks as path faces.
 */
export function generateBar3DMarks(
  markSpec: MarkSpec,
  data: DataRow[],
  scales: ScaleMap,
  encodings: ReturnType<typeof resolveEncodings>,
  layout: Layout,
  encoding?: EncodingSpec,
  config?: ConfigSpec,
): PathMark[] {
  const rects = generateBarMarks(
    { ...markSpec, type: 'bar' },
    data,
    scales,
    encodings,
    layout,
    encoding,
    config,
  );
  const options = depthOptionsFor3DPlot(markSpec, layout);
  const depth = {
    x: options.depthX ?? 10,
    y: options.depthY ?? -6,
  };
  const extents = stackedPyramidExtents(rects, markSpec, config);

  return rects.flatMap((rect, index) =>
    bar3DFaces(rect, markSpec, depth, index, extents.get(rect)),
  );
}

function bar3DFaces(
  rect: RectMark,
  markSpec: MarkSpec,
  depth: Depth,
  index: number,
  pyramidExtent?: PyramidExtent,
): PathMark[] {
  if (rect.width <= 0 || rect.height <= 0) return [];
  if (markSpec.chart3d?.barShape === 'cylinder') {
    return cylinder3DFaces(rect, markSpec, depth, index);
  }

  const front = frontFace(rect, markSpec, pyramidExtent);
  const topEdge = topFaceEdge(front);
  const sideEdge = sideFaceEdge(front, markSpec);
  const faces: FaceSpec[] = [
    { points: front, face: 'front', shade: 0 },
    { points: extrudedFace(topEdge, depth), face: 'top', shade: 0.1 },
    { points: extrudedFace(sideEdge, depth), face: 'side', shade: -0.18 },
  ];

  return faces.map((face) =>
    with3DMetadata(
      {
        type: 'path',
        x: 0,
        y: 0,
        path: polygonPath(face.points),
        datum: rect.datum,
        style: faceStyle(rect, face.shade, face.face),
      },
      markSpec.chart3d,
      face.face,
      { index },
    ),
  );
}

function cylinder3DFaces(
  rect: RectMark,
  markSpec: MarkSpec,
  depth: Depth,
  index: number,
): PathMark[] {
  const orientation = markSpec.chart3d?.orientation ?? 'vertical';
  const faces =
    orientation === 'horizontal'
      ? horizontalCylinderFaces(rect, depth)
      : verticalCylinderFaces(rect, depth);

  return faces.map((face) =>
    with3DMetadata(
      {
        type: 'path',
        x: 0,
        y: 0,
        path: face.path,
        datum: rect.datum,
        style: faceStyle(rect, face.shade, face.face),
      },
      markSpec.chart3d,
      face.face,
      { index },
    ),
  );
}

function verticalCylinderFaces(rect: RectMark, depth: Depth): PathFaceSpec[] {
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  const cap = Math.max(2, Math.min(rect.width * 0.24, rect.height * 0.16, 16));
  return [
    {
      face: 'side',
      shade: -0.2,
      path: polygonPath([
        { x: right, y: top },
        offsetPoint({ x: right, y: top }, depth),
        offsetPoint({ x: right, y: bottom }, depth),
        { x: right, y: bottom },
      ]),
    },
    {
      face: 'front',
      shade: 0,
      path: [
        `M${coord(left)},${coord(top)}`,
        `C${coord(left)},${coord(top + cap)} ${coord(right)},${coord(top + cap)} ${coord(right)},${coord(top)}`,
        `L${coord(right)},${coord(bottom)}`,
        `C${coord(right)},${coord(bottom + cap)} ${coord(left)},${coord(bottom + cap)} ${coord(left)},${coord(bottom)}`,
        'Z',
      ].join(' '),
    },
    {
      face: 'top',
      shade: 0.12,
      path: [
        `M${coord(left)},${coord(top)}`,
        `C${coord(left)},${coord(top - cap)} ${coord(right)},${coord(top - cap)} ${coord(right)},${coord(top)}`,
        `L${coord(right + depth.x)},${coord(top + depth.y)}`,
        `C${coord(right + depth.x)},${coord(top + depth.y - cap)} ${coord(left + depth.x)},${coord(
          top + depth.y - cap,
        )} ${coord(left + depth.x)},${coord(top + depth.y)}`,
        'Z',
      ].join(' '),
    },
  ];
}

function horizontalCylinderFaces(rect: RectMark, depth: Depth): PathFaceSpec[] {
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  const cap = Math.max(2, Math.min(rect.height * 0.24, rect.width * 0.16, 16));
  return [
    {
      face: 'side',
      shade: -0.2,
      path: polygonPath([
        { x: right, y: top },
        offsetPoint({ x: right, y: top }, depth),
        offsetPoint({ x: right, y: bottom }, depth),
        { x: right, y: bottom },
      ]),
    },
    {
      face: 'front',
      shade: 0,
      path: [
        `M${coord(left)},${coord(top)}`,
        `C${coord(left + cap)},${coord(top)} ${coord(left + cap)},${coord(bottom)} ${coord(left)},${coord(
          bottom,
        )}`,
        `L${coord(right)},${coord(bottom)}`,
        `C${coord(right + cap)},${coord(bottom)} ${coord(right + cap)},${coord(top)} ${coord(right)},${coord(
          top,
        )}`,
        'Z',
      ].join(' '),
    },
    {
      face: 'top',
      shade: 0.12,
      path: [
        `M${coord(left)},${coord(top)}`,
        `L${coord(right)},${coord(top)}`,
        `C${coord(right + cap)},${coord(top)} ${coord(right + cap)},${coord(bottom)} ${coord(right)},${coord(
          bottom,
        )}`,
        `L${coord(right + depth.x)},${coord(bottom + depth.y)}`,
        `C${coord(right + depth.x + cap)},${coord(bottom + depth.y)} ${coord(right + depth.x + cap)},${coord(
          top + depth.y,
        )} ${coord(right + depth.x)},${coord(top + depth.y)}`,
        `L${coord(left + depth.x)},${coord(top + depth.y)}`,
        'Z',
      ].join(' '),
    },
  ];
}

function frontFace(rect: RectMark, markSpec: MarkSpec, pyramidExtent?: PyramidExtent): Point[] {
  const shape = markSpec.chart3d?.barShape ?? 'box';
  const orientation = markSpec.chart3d?.orientation ?? 'vertical';
  const tapered = shape === 'cone' || shape === 'coneToMax' || shape === 'pyramid' || shape === 'pyramidToMax';
  if (!tapered) {
    return [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height },
      { x: rect.x, y: rect.y + rect.height },
    ];
  }

  if (orientation === 'horizontal') {
    if (pyramidExtent) {
      return horizontalPyramidSlice(rect, pyramidExtent);
    }
    const inset = Math.min(rect.height * 0.28, rect.width * 0.22);
    return [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + inset },
      { x: rect.x + rect.width, y: rect.y + rect.height - inset },
      { x: rect.x, y: rect.y + rect.height },
    ];
  }

  if (pyramidExtent) {
    return verticalPyramidSlice(rect, pyramidExtent);
  }

  const inset = Math.min(rect.width * 0.28, rect.height * 0.22);
  return [
    { x: rect.x + inset, y: rect.y },
    { x: rect.x + rect.width - inset, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
}

function stackedPyramidExtents(
  rects: RectMark[],
  markSpec: MarkSpec,
  config: ConfigSpec | undefined,
): Map<RectMark, PyramidExtent> {
  const result = new Map<RectMark, PyramidExtent>();
  const shape = markSpec.chart3d?.barShape;
  if (shape !== 'cone' && shape !== 'coneToMax' && shape !== 'pyramid' && shape !== 'pyramidToMax') {
    return result;
  }
  if (!isStacked(config)) return result;

  const grouped = new Map<string, RectMark[]>();
  for (const rect of rects) {
    const key = categoryKey(rect);
    const group = grouped.get(key);
    if (group) {
      group.push(rect);
    } else {
      grouped.set(key, [rect]);
    }
  }

  for (const group of grouped.values()) {
    if (group.length <= 1) continue;
    const extent: PyramidExtent = {
      left: Math.min(...group.map((rect) => rect.x)),
      right: Math.max(...group.map((rect) => rect.x + rect.width)),
      top: Math.min(...group.map((rect) => rect.y)),
      bottom: Math.max(...group.map((rect) => rect.y + rect.height)),
    };
    for (const rect of group) {
      result.set(rect, extent);
    }
  }

  return result;
}

function verticalPyramidSlice(rect: RectMark, extent: PyramidExtent): Point[] {
  const topLeft = verticalPyramidPoint(extent, rect.y, 'left');
  const topRight = verticalPyramidPoint(extent, rect.y, 'right');
  const bottomRight = verticalPyramidPoint(extent, rect.y + rect.height, 'right');
  const bottomLeft = verticalPyramidPoint(extent, rect.y + rect.height, 'left');
  return [topLeft, topRight, bottomRight, bottomLeft];
}

function horizontalPyramidSlice(rect: RectMark, extent: PyramidExtent): Point[] {
  const leftTop = horizontalPyramidPoint(extent, rect.x, 'top');
  const rightTop = horizontalPyramidPoint(extent, rect.x + rect.width, 'top');
  const rightBottom = horizontalPyramidPoint(extent, rect.x + rect.width, 'bottom');
  const leftBottom = horizontalPyramidPoint(extent, rect.x, 'bottom');
  return [leftTop, rightTop, rightBottom, leftBottom];
}

function verticalPyramidPoint(extent: PyramidExtent, y: number, side: 'left' | 'right'): Point {
  const center = (extent.left + extent.right) / 2;
  const span = Math.max(1, extent.bottom - extent.top);
  const t = Math.max(0, Math.min(1, (y - extent.top) / span));
  return {
    x: side === 'left' ? center + (extent.left - center) * t : center + (extent.right - center) * t,
    y,
  };
}

function horizontalPyramidPoint(extent: PyramidExtent, x: number, side: 'top' | 'bottom'): Point {
  const center = (extent.top + extent.bottom) / 2;
  const span = Math.max(1, extent.right - extent.left);
  const t = Math.max(0, Math.min(1, 1 - (x - extent.left) / span));
  return {
    x,
    y: side === 'top' ? center + (extent.top - center) * t : center + (extent.bottom - center) * t,
  };
}

function categoryKey(rect: RectMark): string {
  const datum = rect.datum;
  if (datum && typeof datum === 'object' && !Array.isArray(datum)) {
    const record = datum as Record<string, unknown>;
    return String(record.category ?? `${Math.round(rect.x)}:${Math.round(rect.y)}`);
  }
  return `${Math.round(rect.x)}:${Math.round(rect.y)}`;
}

function isStacked(config: ConfigSpec | undefined): boolean {
  return (
    config?.stack === 'zero' ||
    config?.stack === 'normalize' ||
    config?.stack === 'center' ||
    config?.barGeometry?.grouping === 'stacked' ||
    config?.barGeometry?.grouping === 'percentStacked'
  );
}

function topFaceEdge(points: Point[]): [Point, Point] {
  return [points[0], points[1]];
}

function sideFaceEdge(points: Point[], markSpec: MarkSpec): [Point, Point] {
  return markSpec.chart3d?.orientation === 'horizontal'
    ? [points[1], points[2]]
    : [points[1], points[2]];
}

function extrudedFace(edge: [Point, Point], depth: Depth): Point[] {
  const [a, b] = edge;
  return [a, b, offsetPoint(b, depth), offsetPoint(a, depth)];
}

function offsetPoint(point: Point, depth: Depth): Point {
  return {
    x: point.x + depth.x,
    y: point.y + depth.y,
  };
}

function faceStyle(rect: RectMark, shade: number, face: FaceSpec['face']): RectMark['style'] {
  if (face === 'front') {
    return {
      ...rect.style,
      strokeWidth: rect.style.strokeWidth ?? 0.75,
    };
  }
  const fill = shadeColor(rect.style.fill, shade) ?? rect.style.fill;
  const stroke = shadeColor(rect.style.stroke ?? rect.style.fill, shade - 0.08) ?? rect.style.stroke;
  return {
    ...rect.style,
    fill,
    stroke,
    fillPaint: undefined,
    strokePaint: undefined,
    opacity: rect.style.opacity,
    strokeWidth: rect.style.strokeWidth ?? 0.75,
  };
}

function coord(value: number): string {
  return format3DCoord(value);
}
