/**
 * @mog/geometry
 *
 * Pure 2D geometry primitives used by all floating object engines.
 * Zero dependencies beyond contracts. No Yjs, React, Canvas, or DOM.
 */

// Re-export types from contracts
export type {
  AffineTransform,
  BoundingBox,
  ClosePath,
  CurveTo,
  LineTo,
  MoveTo,
  Path,
  PathSegment,
  Point2D,
  QuadraticTo,
  SubPath,
  Vector2D,
} from '@mog-sdk/contracts/geometry';

// Matrix operations
export * as Matrix from './matrix';

// High-level transform builders
export * as Transform from './transform';

// Path operations (namespace named PathOps to avoid conflict with Path type)
export * as PathOps from './path';

// Diagnostics
export * as Diagnostics from './diagnostics';
export type { ValidationIssue, ValidationResult } from './diagnostics';

// Connector routing (pure geometry for connection lines between shapes)
export * as ConnectorRouting from './connector-routing';
export type {
  BendPosition,
  ConnectionPointType,
  RouteConnectorOptions,
  RoutingStyle,
} from './connector-routing';

// Connection point resolution and snapping
export * as ConnectionPoints from './connection-points';
export type {
  ConnectionPointDef,
  ConnectionPointInfo,
  GuideDef,
  ShapeConnectionData,
  SnapResult,
} from './connection-points';

// Rect operations (union, intersection, overlaps, etc.)
export * as Rect from './rect';

// Geometry primitives (point-in-shape, rect-rect, distance)
export {
  distanceToCircle,
  distanceToRect,
  pointInArc,
  pointInCircle,
  pointInDiamond,
  pointInRect,
  rectContains,
  rectIntersects,
} from './primitives';

// Bounded LRU cache
export { BoundedCache } from './bounded-cache';
