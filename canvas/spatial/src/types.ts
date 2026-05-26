import type { BoundingBox, Point2D } from '@mog-sdk/contracts/geometry';

export interface SpatialEntry<T> {
  id: string;
  data: T;
  bounds: BoundingBox;
}

export interface SpatialIndex<T> {
  insert(id: string, bounds: BoundingBox, data: T): void;
  remove(id: string): void;
  updateBounds(id: string, bounds: BoundingBox): void;
  query(bounds: BoundingBox): SpatialEntry<T>[];
  queryPoint(point: Point2D): SpatialEntry<T>[];
  all(): SpatialEntry<T>[];
  clear(): void;
  size(): number;
}

export interface NarrowPhaseTest<T> {
  test(entry: SpatialEntry<T>, point: Point2D): boolean;
}
