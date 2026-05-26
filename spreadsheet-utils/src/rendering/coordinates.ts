/**
 * Coordinate Factory/Unwrap Runtime Functions
 *
 * Extracted from @mog-sdk/contracts/rendering/coordinates.
 */

import type {
  DocumentPoint,
  DocumentRect,
  LayerPoint,
  LayerRect,
  ViewportPoint,
  ViewportRect,
} from '@mog-sdk/contracts/rendering/coordinates';
import type { Point, Rect } from '@mog-sdk/contracts/viewport';

export function documentPoint(x: number, y: number): DocumentPoint {
  return { x, y } as DocumentPoint;
}

export function viewportPoint(x: number, y: number): ViewportPoint {
  return { x, y } as ViewportPoint;
}

export function layerPoint(x: number, y: number): LayerPoint {
  return { x, y } as LayerPoint;
}

export function documentRect(x: number, y: number, width: number, height: number): DocumentRect {
  return { x, y, width, height } as DocumentRect;
}

export function viewportRect(x: number, y: number, width: number, height: number): ViewportRect {
  return { x, y, width, height } as ViewportRect;
}

export function layerRect(x: number, y: number, width: number, height: number): LayerRect {
  return { x, y, width, height } as LayerRect;
}

export function toPlainPoint(p: DocumentPoint | ViewportPoint | LayerPoint): Point {
  return { x: p.x, y: p.y };
}

export function toPlainRect(r: DocumentRect | ViewportRect | LayerRect): Rect {
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}
